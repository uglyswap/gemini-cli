/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { WEB_SEARCH_TOOL_NAME } from './tool-names.js';
import type { GroundingMetadata } from '@google/genai';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolErrorType } from './tool-error.js';

import { getErrorMessage } from '../utils/errors.js';
import { type Config } from '../config/config.js';
import { getResponseText } from '../utils/partUtils.js';
import { AuthType } from '../core/contentGenerator.js';
import { retryWithBackoff } from '../utils/retry.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
  // Other properties might exist if needed in the future
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string; // text is optional as per the example
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[]; // Optional as per example
}

/**
 * OpenRouter web search annotation format
 */
interface OpenRouterAnnotation {
  type: 'url_citation';
  url_citation: {
    url: string;
    title: string;
    start_index: number;
    end_index: number;
  };
}

interface OpenRouterMessage {
  role: string;
  content: string;
  annotations?: OpenRouterAnnotation[];
}

interface OpenRouterChoice {
  message: OpenRouterMessage;
  finish_reason: string;
}

interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */

  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

class WebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebSearchToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  override getDescription(): string {
    return `Searching the web for: "${this.params.query}"`;
  }

  /**
   * Execute web search using OpenRouter's web plugin
   */
  private async executeOpenRouterSearch(
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const contentConfig = this.config.getContentGeneratorConfig();
    const baseUrl = contentConfig?.openAICompatibleBaseUrl || '';
    const apiKey = contentConfig?.apiKey || '';
    const model = contentConfig?.openAICompatibleModel || 'openai/gpt-4o-mini';

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/google-gemini/gemini-cli',
              'X-Title': 'Devora CLI (Web Search)',
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: 'user',
                  content: `Search the web for: ${this.params.query}\n\nProvide a comprehensive answer based on the search results. Include relevant sources.`,
                },
              ],
              plugins: [{ id: 'web', max_results: 5 }],
              temperature: 0,
            }),
            signal,
          });

          if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(
              `OpenRouter API error: ${res.status} - ${errorBody}`,
            );
          }

          return res.json() as Promise<OpenRouterResponse>;
        },
        {
          retryFetchErrors: this.config.getRetryFetchErrors(),
        },
      );

      const choice = response.choices?.[0];
      const message = choice?.message;

      if (!message?.content?.trim()) {
        return {
          llmContent: `No search results found for query: "${this.params.query}"`,
          returnDisplay: 'No information found.',
        };
      }

      let responseText = message.content;
      const sources: GroundingChunkItem[] = [];
      const sourceListFormatted: string[] = [];

      // Process annotations (citations from web search)
      if (message.annotations && message.annotations.length > 0) {
        const urlCitations = message.annotations.filter(
          (a) => a.type === 'url_citation',
        );

        // Build sources list
        urlCitations.forEach((annotation, index) => {
          const citation = annotation.url_citation;
          sources.push({
            web: {
              uri: citation.url,
              title: citation.title,
            },
          });
          sourceListFormatted.push(
            `[${index + 1}] ${citation.title} (${citation.url})`,
          );
        });

        // Add sources section if we have any
        if (sourceListFormatted.length > 0) {
          responseText += '\n\nSources:\n' + sourceListFormatted.join('\n');
        }
      }

      return {
        llmContent: `Web search results for "${this.params.query}":\n\n${responseText}`,
        returnDisplay: `Search results for "${this.params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during OpenRouter web search for query "${this.params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }

  async execute(signal: AbortSignal): Promise<WebSearchToolResult> {
    // Check if using OpenAI-compatible provider
    const authType = this.config.getContentGeneratorConfig()?.authType;
    if (authType === AuthType.USE_OPENAI_COMPATIBLE) {
      const baseUrl =
        this.config.getContentGeneratorConfig()?.openAICompatibleBaseUrl || '';

      // OpenRouter supports web search via their plugin
      if (baseUrl.includes('openrouter.ai')) {
        return this.executeOpenRouterSearch(signal);
      }

      // Other OpenAI-compatible providers don't support web search
      return {
        llmContent: `Web search is not available with this OpenAI-compatible provider. This feature is currently only supported with Gemini API or OpenRouter. To use web search, please authenticate with Google, use a Gemini API key, or configure OpenRouter.`,
        returnDisplay: 'Web search not available with current provider.',
        error: {
          message:
            'Web search not available - use Gemini API or OpenRouter instead',
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }

    const geminiClient = this.config.getGeminiClient();

    try {
      const response = await geminiClient.generateContent(
        { model: 'web-search' },
        [{ role: 'user', parts: [{ text: this.params.query }] }],
        signal,
      );

      const responseText = getResponseText(response);
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      if (!responseText || !responseText.trim()) {
        return {
          llmContent: `No search results or information found for query: "${this.params.query}"`,
          returnDisplay: 'No information found.',
        };
      }

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
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

          // Sort insertions by index in descending order to avoid shifting subsequent indices
          insertions.sort((a, b) => b.index - a.index);

          // Use TextEncoder/TextDecoder since segment indices are UTF-8 byte positions
          const encoder = new TextEncoder();
          const responseBytes = encoder.encode(modifiedResponseText);
          const parts: Uint8Array[] = [];
          let lastIndex = responseBytes.length;
          for (const ins of insertions) {
            const pos = Math.min(ins.index, lastIndex);
            parts.unshift(responseBytes.subarray(pos, lastIndex));
            parts.unshift(encoder.encode(ins.marker));
            lastIndex = pos;
          }
          parts.unshift(responseBytes.subarray(0, lastIndex));

          // Concatenate all parts into a single buffer
          const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
          const finalBytes = new Uint8Array(totalLength);
          let offset = 0;
          for (const part of parts) {
            finalBytes.set(part, offset);
            offset += part.length;
          }
          modifiedResponseText = new TextDecoder().decode(finalBytes);
        }

        if (sourceListFormatted.length > 0) {
          modifiedResponseText +=
            '\n\nSources:\n' + sourceListFormatted.join('\n');
        }
      }

      return {
        llmContent: `Web search results for "${this.params.query}":\n\n${modifiedResponseText}`,
        returnDisplay: `Search results for "${this.params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${
        this.params.query
      }": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }
}

/**
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name = WEB_SEARCH_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      WebSearchTool.Name,
      'GoogleSearch',
      'Performs a web search using Google Search (via the Gemini API) and returns the results. This tool is useful for finding information on the internet based on a query.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find information on the web.',
          },
        },
        required: ['query'],
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
      messageBus,
    );
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  protected override validateToolParamValues(
    params: WebSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: WebSearchToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new WebSearchToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
