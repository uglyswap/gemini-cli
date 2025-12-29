/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../policy/types.js';
import { AuthType } from '../core/contentGenerator.js';
import { getResponseText } from '../utils/partUtils.js';
import { fetchWithTimeout, isPrivateIp } from '../utils/fetch.js';
import { convert } from 'html-to-text';
import {
  logWebFetchFallbackAttempt,
  WebFetchFallbackAttemptEvent,
} from '../telemetry/index.js';
import { WEB_FETCH_TOOL_NAME } from './tool-names.js';
import { debugLogger } from '../utils/debugLogger.js';
import { retryWithBackoff } from '../utils/retry.js';

const URL_FETCH_TIMEOUT_MS = 10000;
const MAX_CONTENT_LENGTH = 100000;

/**
 * Parses a prompt to extract valid URLs and identify malformed ones.
 */
export function parsePrompt(text: string): {
  validUrls: string[];
  errors: string[];
} {
  const tokens = text.split(/\s+/);
  const validUrls: string[] = [];
  const errors: string[] = [];

  for (const token of tokens) {
    if (!token) continue;

    // Heuristic to check if the url appears to contain URL-like chars.
    if (token.includes('://')) {
      try {
        // Validate with new URL()
        const url = new URL(token);

        // Allowlist protocols
        if (['http:', 'https:'].includes(url.protocol)) {
          validUrls.push(url.href);
        } else {
          errors.push(
            `Unsupported protocol in URL: "${token}". Only http and https are supported.`,
          );
        }
      } catch (_) {
        // new URL() threw, so it's malformed according to WHATWG standard
        errors.push(`Malformed URL detected: "${token}".`);
      }
    }
  }

  return { validUrls, errors };
}

// Interfaces for grounding metadata (similar to web-search.ts)
interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
}

/**
 * Parameters for the WebFetch tool
 */
export interface WebFetchToolParams {
  /**
   * The prompt containing URL(s) (up to 20) and instructions for processing their content.
   */
  prompt: string;
  /**
   * Optional: URL to fetch (for backwards compatibility with LLMs that provide url separately)
   * If provided and prompt doesn't contain a URL, this will be prepended to the prompt.
   */
  url?: string;
}

interface ErrorWithStatus extends Error {
  status?: number;
}

class WebFetchToolInvocation extends BaseToolInvocation<
  WebFetchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebFetchToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  private async executeFallback(signal: AbortSignal): Promise<ToolResult> {
    const { validUrls: urls } = parsePrompt(this.params.prompt);
    // For now, we only support one URL for fallback
    let url = urls[0];

    // Convert GitHub blob URL to raw URL
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetchWithTimeout(url, URL_FETCH_TIMEOUT_MS);
          if (!res.ok) {
            const error = new Error(
              `Request failed with status code ${res.status} ${res.statusText}`,
            );
            (error as ErrorWithStatus).status = res.status;
            throw error;
          }
          return res;
        },
        {
          retryFetchErrors: this.config.getRetryFetchErrors(),
        },
      );

      const rawContent = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let textContent: string;

      // Only use html-to-text if content type is HTML, or if no content type is provided (assume HTML)
      if (
        contentType.toLowerCase().includes('text/html') ||
        contentType === ''
      ) {
        textContent = convert(rawContent, {
          wordwrap: false,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } else {
        // For other content types (text/plain, application/json, etc.), use raw text
        textContent = rawContent;
      }

      textContent = textContent.substring(0, MAX_CONTENT_LENGTH);

      const geminiClient = this.config.getGeminiClient();
      const fallbackPrompt = `The user requested the following: "${this.params.prompt}".

I was unable to access the URL directly. Instead, I have fetched the raw content of the page. Please use the following content to answer the request. Do not attempt to access the URL again.

---
${textContent}
---
`;
      const result = await geminiClient.generateContent(
        { model: 'web-fetch-fallback' },
        [{ role: 'user', parts: [{ text: fallbackPrompt }] }],
        signal,
      );
      const resultText = getResponseText(result) || '';
      return {
        llmContent: resultText,
        returnDisplay: `Content for ${url} processed using fallback fetch.`,
      };
    } catch (e) {
      const error = e as Error;
      const errorMessage = `Error during fallback fetch for ${url}: ${error.message}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_FALLBACK_FAILED,
        },
      };
    }
  }

  /**
   * Fallback for OpenAI-compatible providers - fetch URL and use configured LLM
   */
  private async executeOpenAICompatibleFallback(
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const { validUrls: urls } = parsePrompt(this.params.prompt);
    let url = urls[0];

    // Convert GitHub blob URL to raw URL
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetchWithTimeout(url, URL_FETCH_TIMEOUT_MS);
          if (!res.ok) {
            const error = new Error(
              `Request failed with status code ${res.status} ${res.statusText}`,
            );
            (error as ErrorWithStatus).status = res.status;
            throw error;
          }
          return res;
        },
        {
          retryFetchErrors: this.config.getRetryFetchErrors(),
        },
      );

      const rawContent = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let textContent: string;

      // Only use html-to-text if content type is HTML
      if (
        contentType.toLowerCase().includes('text/html') ||
        contentType === ''
      ) {
        textContent = convert(rawContent, {
          wordwrap: false,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } else {
        textContent = rawContent;
      }

      textContent = textContent.substring(0, MAX_CONTENT_LENGTH);

      // Use the configured content generator instead of Gemini client
      const contentGenerator = this.config.getContentGenerator();
      const fallbackPrompt = `The user requested the following: "${this.params.prompt}".

Here is the content fetched from the URL. Please use it to answer the request:

---
${textContent}
---
`;
      const result = await contentGenerator.generateContent(
        {
          contents: [{ role: 'user', parts: [{ text: fallbackPrompt }] }],
          config: {
            temperature: 0,
            maxOutputTokens: 4000,
          },
        },
        'web-fetch-fallback',
      );
      const resultText = getResponseText(result) || '';
      return {
        llmContent: resultText,
        returnDisplay: `Content for ${url} processed.`,
      };
    } catch (e) {
      const error = e as Error;
      const errorMessage = `Error during web fetch for ${url}: ${error.message}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_FALLBACK_FAILED,
        },
      };
    }
  }

  getDescription(): string {
    const displayPrompt =
      this.params.prompt.length > 100
        ? this.params.prompt.substring(0, 97) + '...'
        : this.params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Legacy confirmation flow (no message bus OR policy decision was ASK_USER)
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    // Perform GitHub URL conversion here to differentiate between user-provided
    // URL and the actual URL to be fetched.
    const { validUrls } = parsePrompt(this.params.prompt);
    const urls = validUrls.map((url) => {
      if (url.includes('github.com') && url.includes('/blob/')) {
        return url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }
      return url;
    });

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Web Fetch`,
      prompt: this.params.prompt,
      urls,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          // No need to publish a policy update as the default policy for
          // AUTO_EDIT already reflects always approving web-fetch.
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        } else {
          await this.publishPolicyUpdate(outcome);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    // Check if using OpenAI-compatible provider - use HTTP fetch + LLM fallback
    const authType = this.config.getContentGeneratorConfig()?.authType;
    if (authType === AuthType.USE_OPENAI_COMPATIBLE) {
      return this.executeOpenAICompatibleFallback(signal);
    }

    const userPrompt = this.params.prompt;
    const { validUrls: urls } = parsePrompt(userPrompt);
    const url = urls[0];
    const isPrivate = isPrivateIp(url);

    if (isPrivate) {
      logWebFetchFallbackAttempt(
        this.config,
        new WebFetchFallbackAttemptEvent('private_ip'),
      );
      return this.executeFallback(signal);
    }

    const geminiClient = this.config.getGeminiClient();

    try {
      const response = await geminiClient.generateContent(
        { model: 'web-fetch' },
        [{ role: 'user', parts: [{ text: userPrompt }] }],
        signal, // Pass signal
      );

      debugLogger.debug(
        `[WebFetchTool] Full response for prompt "${userPrompt.substring(
          0,
          50,
        )}...":`,
        JSON.stringify(response, null, 2),
      );

      let responseText = getResponseText(response) || '';
      const urlContextMeta = response.candidates?.[0]?.urlContextMetadata;
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      // Error Handling
      let processingError = false;

      if (
        urlContextMeta?.urlMetadata &&
        urlContextMeta.urlMetadata.length > 0
      ) {
        const allStatuses = urlContextMeta.urlMetadata.map(
          (m) => m.urlRetrievalStatus,
        );
        if (allStatuses.every((s) => s !== 'URL_RETRIEVAL_STATUS_SUCCESS')) {
          processingError = true;
        }
      } else if (!responseText.trim() && !sources?.length) {
        // No URL metadata and no content/sources
        processingError = true;
      }

      if (
        !processingError &&
        !responseText.trim() &&
        (!sources || sources.length === 0)
      ) {
        // Successfully retrieved some URL (or no specific error from urlContextMeta), but no usable text or grounding data.
        processingError = true;
      }

      if (processingError) {
        logWebFetchFallbackAttempt(
          this.config,
          new WebFetchFallbackAttemptEvent('primary_failed'),
        );
        return await this.executeFallback(signal);
      }

      const sourceListFormatted: string[] = [];
      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'Unknown URI'; // Fallback if URI is missing
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
                marker: citationMarker,
              });
            }
          });

          insertions.sort((a, b) => b.index - a.index);
          const responseChars = responseText.split('');
          insertions.forEach((insertion) => {
            responseChars.splice(insertion.index, 0, insertion.marker);
          });
          responseText = responseChars.join('');
        }

        if (sourceListFormatted.length > 0) {
          responseText += `

Sources:
${sourceListFormatted.join('\n')}`;
        }
      }

      const llmContent = responseText;

      debugLogger.debug(
        `[WebFetchTool] Formatted tool response for prompt "${userPrompt}:\n\n":`,
        llmContent,
      );

      return {
        llmContent,
        returnDisplay: `Content processed from prompt.`,
      };
    } catch (error: unknown) {
      const errorMessage = `Error processing web content for prompt "${userPrompt.substring(
        0,
        50,
      )}...": ${getErrorMessage(error)}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
        },
      };
    }
  }
}

/**
 * Implementation of the WebFetch tool logic
 */
export class WebFetchTool extends BaseDeclarativeTool<
  WebFetchToolParams,
  ToolResult
> {
  static readonly Name = WEB_FETCH_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      WebFetchTool.Name,
      'WebFetch',
      "Processes content from URL(s), including local and private network addresses (e.g., localhost), embedded in a prompt. Include up to 20 URLs and instructions (e.g., summarize, extract specific data) directly in the 'prompt' parameter.",
      Kind.Fetch,
      {
        properties: {
          prompt: {
            description:
              'Instructions on how to process the URL content (e.g., "Summarize the page", "Extract key points"). If URL is not in the prompt, use the url parameter.',
            type: 'string',
          },
          url: {
            description:
              'The URL to fetch (must start with http:// or https://). Can alternatively be included directly in the prompt parameter.',
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: WebFetchToolParams,
  ): string | null {
    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty and must contain URL(s) and instructions.";
    }

    // Check if prompt contains URLs
    let { validUrls, errors } = parsePrompt(params.prompt);

    // If no URLs in prompt but url parameter is provided, combine them
    if (validUrls.length === 0 && params.url) {
      const urlResult = parsePrompt(params.url);
      if (urlResult.validUrls.length > 0) {
        // Prepend URL to prompt for processing
        params.prompt = `${params.url} ${params.prompt}`;
        validUrls = urlResult.validUrls;
        errors = urlResult.errors;
      }
    }

    if (errors.length > 0) {
      return `Error(s) in prompt URLs:\n- ${errors.join('\n- ')}`;
    }

    if (validUrls.length === 0) {
      return "The 'prompt' must contain at least one valid URL (starting with http:// or https://).";
    }

    return null;
  }

  protected createInvocation(
    params: WebFetchToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<WebFetchToolParams, ToolResult> {
    return new WebFetchToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
