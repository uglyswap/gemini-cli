/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from './contentGenerator.js';
import type {
  CountTokensResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  Candidate,
  ContentUnion,
  ToolListUnion,
  Tool as GenaiTool,
} from '@google/genai';
import {
  GenerateContentResponse,
  FinishReason,
  GenerateContentResponsePromptFeedback,
  BlockedReason,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';

interface OpenAIUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface OpenAICompatibleConfig extends ContentGeneratorConfig {
  openAICompatibleBaseUrl: string;
  openAICompatibleModel?: string;
}

/**
 * Maps Gemini model names to provider-specific model IDs
 */
function mapModelName(model: string, baseUrl: string): string {
  // Z.AI specific mapping
  if (baseUrl.includes('z.ai')) {
    const zaiModels: Record<string, string> = {
      'gemini-2.5-pro': 'glm-4.7',
      'gemini-2.5-flash': 'glm-4.7',
      'gemini-pro': 'glm-4.7',
      pro: 'glm-4.7',
      flash: 'glm-4.7',
    };
    return zaiModels[model] || 'glm-4.7';
  }

  // OpenRouter specific mapping
  if (baseUrl.includes('openrouter.ai')) {
    const openRouterModels: Record<string, string> = {
      'gemini-2.5-pro': 'google/gemini-2.5-pro',
      'gemini-2.5-flash': 'google/gemini-2.5-flash',
      'gemini-2.5-pro-preview': 'google/gemini-2.5-pro-preview',
      'gemini-2.5-flash-preview': 'google/gemini-2.5-flash-preview',
      'gemini-2.0-flash-thinking-exp': 'google/gemini-2.0-flash-thinking-exp',
      'gemini-pro': 'google/gemini-pro',
      'gemini-1.5-pro': 'google/gemini-pro-1.5',
      'gemini-1.5-flash': 'google/gemini-flash-1.5',
    };
    // If model already has a provider prefix (contains '/'), use as-is
    // Otherwise, check mapping or add 'google/' prefix for Gemini models
    if (model.includes('/')) {
      return model;
    }
    return openRouterModels[model] || `google/${model}`;
  }

  // For Ollama, LM Studio, and other local providers, use model as-is
  return model;
}

export function createOpenAICompatibleContentGenerator(
  config: OpenAICompatibleConfig,
  httpOptions: { headers: Record<string, string> },
): ContentGenerator {
  const baseUrl = config.openAICompatibleBaseUrl;
  const modelName =
    config.openAICompatibleModel ||
    mapModelName(config.model || 'gemini-2.5-pro', baseUrl);

  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey: config.apiKey || 'not-required', // Some local providers don't need a key
    defaultHeaders: {
      ...httpOptions.headers,
      'HTTP-Referer': 'https://github.com/google-gemini/gemini-cli',
      'X-Title': 'Gemini CLI (OpenAI Compatible)',
    },
  });

  // Debug logging for OpenAI-compatible providers (set DEBUG_OPENAI_COMPAT=true)
  const DEBUG = process.env['DEBUG_OPENAI_COMPAT'] === 'true';

  async function* doGenerateContentStream(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    try {
      const messages = convertToOpenAIFormat(request);
      const systemInstruction = extractSystemInstruction(request);
      const requestModel = request.model || modelName;

      // Build request options
      // Z.AI/GLM requires tool_stream=true for streaming function calls
      // This parameter is specific to z.ai and not part of OpenAI standard
      const isZAI = baseUrl.includes('z.ai');

      // Detect Anthropic models (via OpenRouter or direct)
      const isAnthropicModel =
        requestModel.toLowerCase().includes('anthropic') ||
        requestModel.toLowerCase().includes('claude');

      // Use a safer max_tokens default that works across providers
      const maxTokens = request.config?.maxOutputTokens || 8192;

      const tools = convertTools(request.config?.tools);

      if (DEBUG) {
        console.error('[DEBUG STREAM] Starting request:', {
          model: requestModel,
          isZAI,
          isAnthropicModel,
          messageCount: messages.length,
          hasSystemInstruction: !!systemInstruction,
          toolCount: tools?.length || 0,
          tools: tools?.map((t) => t.function?.name),
          maxTokens,
        });
      }

      const stream = await client.chat.completions.create({
        model: requestModel,
        messages: systemInstruction
          ? [{ role: 'system', content: systemInstruction }, ...messages]
          : messages,
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
        max_tokens: maxTokens,
        tools: tools?.length ? tools : undefined, // Don't send empty tools array
        stream: true,
        stream_options: { include_usage: true },
        ...(isZAI ? { tool_stream: true } : {}),
      });

      // Accumulate tool calls across chunks (they come in pieces during streaming)
      const accumulatedToolCalls: Map<
        number,
        { name: string; arguments: string }
      > = new Map();
      let lastUsage: OpenAIUsage | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;

        if (DEBUG) {
          console.error(
            '[DEBUG STREAM] Chunk:',
            JSON.stringify({
              finish_reason: choice?.finish_reason,
              delta_content: delta?.content?.substring(0, 100),
              delta_tool_calls: delta?.tool_calls,
            }),
          );
        }

        // Accumulate tool call data
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            const existing = accumulatedToolCalls.get(index) || {
              name: '',
              arguments: '',
            };

            if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              existing.arguments += toolCall.function.arguments;
            }

            accumulatedToolCalls.set(index, existing);
          }
        }

        // Track usage for final response
        if (chunk.usage) {
          lastUsage = chunk.usage as OpenAIUsage;
        }

        // Yield text content immediately (streaming text)
        if (delta?.content) {
          yield convertChunkToGeminiResponse(chunk);
        }

        // When finish_reason is set, emit accumulated tool calls
        // Support both 'tool_calls' (OpenAI) and 'end_turn' (Anthropic via OpenRouter)
        const finishReason = choice?.finish_reason as string | null | undefined;
        const isToolCallFinish =
          finishReason === 'tool_calls' ||
          (finishReason === 'end_turn' && accumulatedToolCalls.size > 0) ||
          (finishReason === 'stop' && accumulatedToolCalls.size > 0);

        if (DEBUG && choice?.finish_reason) {
          console.error(
            '[DEBUG STREAM] Finish reason:',
            choice.finish_reason,
            'Accumulated tools:',
            accumulatedToolCalls.size,
          );
        }

        if (isToolCallFinish && accumulatedToolCalls.size > 0) {
          const parts: Part[] = [];

          for (const [, toolCall] of accumulatedToolCalls) {
            // Skip tool calls without a name or with invalid arguments
            if (
              !toolCall.name ||
              !toolCall.arguments.trim() ||
              toolCall.arguments === 'undefined'
            ) {
              continue;
            }

            try {
              const parsedArgs = JSON.parse(toolCall.arguments);
              // Skip if parsed args is empty object (indicates incomplete streaming)
              if (
                typeof parsedArgs === 'object' &&
                parsedArgs !== null &&
                Object.keys(parsedArgs).length === 0
              ) {
                continue;
              }

              parts.push({
                functionCall: {
                  name: toolCall.name,
                  args: parsedArgs,
                },
              });
            } catch (e) {
              // Log parsing error for debugging
              console.error(
                `Failed to parse tool call arguments: ${toolCall.arguments}`,
                e,
              );
            }
          }

          if (parts.length > 0) {
            const candidates: Candidate[] = [
              {
                content: { role: 'model', parts },
                finishReason: FinishReason.STOP,
                avgLogprobs: 0,
              },
            ];

            const response = new GenerateContentResponse();
            response.candidates = candidates;

            if (lastUsage) {
              const usageMetadata = new GenerateContentResponseUsageMetadata();
              usageMetadata.promptTokenCount = lastUsage.prompt_tokens || 0;
              usageMetadata.candidatesTokenCount =
                lastUsage.completion_tokens || 0;
              usageMetadata.totalTokenCount = lastUsage.total_tokens || 0;
              response.usageMetadata = usageMetadata;
            }

            yield response;
          }
        }
      }

      // Emit final response with usage metadata for non-tool-call responses
      // This ensures the UI can track context usage even when the model only returns text
      if (lastUsage) {
        const finalResponse = new GenerateContentResponse();
        finalResponse.candidates = [];
        const usageMetadata = new GenerateContentResponseUsageMetadata();
        usageMetadata.promptTokenCount = lastUsage.prompt_tokens || 0;
        usageMetadata.candidatesTokenCount = lastUsage.completion_tokens || 0;
        usageMetadata.totalTokenCount = lastUsage.total_tokens || 0;
        finalResponse.usageMetadata = usageMetadata;
        yield finalResponse;
      }
    } catch (error) {
      throw convertError(error);
    }
  }

  const generator: ContentGenerator = {
    async generateContent(
      request: GenerateContentParameters,
      _userPromptId: string,
    ): Promise<GenerateContentResponse> {
      try {
        const messages = convertToOpenAIFormat(request);
        const systemInstruction = extractSystemInstruction(request);
        const requestModel = request.model || modelName;
        const wantsJson =
          request.config?.responseMimeType === 'application/json';

        const tools = convertTools(request.config?.tools);

        // Determine if provider supports response_format (OpenAI-native feature)
        // OpenRouter with Anthropic models doesn't support response_format
        const isAnthropicModel =
          requestModel.toLowerCase().includes('anthropic') ||
          requestModel.toLowerCase().includes('claude');
        const supportsResponseFormat =
          !isAnthropicModel && !baseUrl.includes('openrouter');

        // Use a safer max_tokens default that works across providers
        const maxTokens = request.config?.maxOutputTokens || 8192;

        if (DEBUG) {
          console.error('[DEBUG NON-STREAM] Request:', {
            model: requestModel,
            wantsJson,
            supportsResponseFormat,
            isAnthropicModel,
            messageCount: messages.length,
            hasSystemInstruction: !!systemInstruction,
            toolCount: tools?.length || 0,
            tools: tools?.map((t) => t.function?.name),
            maxTokens,
          });
        }

        const completion = await client.chat.completions.create({
          model: requestModel,
          messages: systemInstruction
            ? [
                { role: 'system' as const, content: systemInstruction },
                ...messages,
              ]
            : messages,
          temperature: request.config?.temperature,
          top_p: request.config?.topP,
          max_tokens: maxTokens,
          tools: tools?.length ? tools : undefined,
          // Only include response_format for providers that support it
          response_format:
            wantsJson && supportsResponseFormat
              ? { type: 'json_object' }
              : undefined,
          stream: false,
        });

        const choice = completion.choices[0];

        if (DEBUG) {
          console.error('[DEBUG NON-STREAM] Response:', {
            finishReason: choice?.finish_reason,
            hasContent: !!choice?.message?.content,
            contentLength: choice?.message?.content?.length || 0,
            contentPreview: choice?.message?.content?.slice(0, 200),
            hasToolCalls: !!choice?.message?.tool_calls?.length,
            refusal: choice?.message?.refusal,
          });
        }

        // Handle empty content - some providers return null/undefined content
        if (!choice?.message?.content && !choice?.message?.tool_calls?.length) {
          // Check if model refused the request
          if (choice?.message?.refusal) {
            throw new Error(`Model refused request: ${choice.message.refusal}`);
          }
          // For JSON requests with empty content, return empty JSON object
          if (wantsJson) {
            if (DEBUG) {
              console.error(
                '[DEBUG NON-STREAM] Empty content for JSON request, returning {}',
              );
            }
            // Create a response with empty JSON
            const emptyResponse = new GenerateContentResponse();
            emptyResponse.candidates = [
              {
                content: {
                  role: 'model',
                  parts: [{ text: '{}' }],
                },
                finishReason: mapFinishReason(choice?.finish_reason),
                avgLogprobs: 0,
              },
            ];
            return emptyResponse;
          }
        }

        return convertToGeminiResponse(
          completion as OpenAI.Chat.ChatCompletion,
        );
      } catch (error) {
        throw convertError(error);
      }
    },

    async generateContentStream(
      request: GenerateContentParameters,
      _userPromptId: string,
    ): Promise<AsyncGenerator<GenerateContentResponse>> {
      return doGenerateContentStream(request);
    },

    async countTokens(
      request: CountTokensParameters,
    ): Promise<CountTokensResponse> {
      // OpenAI-compatible APIs typically don't have a dedicated token counting endpoint
      // Estimate based on content length (rough: ~4 chars per token)
      const contents = normalizeContents(request.contents);
      const totalText = contents
        .map(
          (content: Content) =>
            content.parts
              ?.map((part: Part) => {
                if ('text' in part && part.text) return part.text;
                return '';
              })
              .join(' ') || '',
        )
        .join(' ');

      const estimatedTokens = Math.ceil(totalText.length / 4);

      return {
        totalTokens: estimatedTokens,
        cachedContentTokenCount: 0,
      };
    },

    async embedContent(
      _request: EmbedContentParameters,
    ): Promise<EmbedContentResponse> {
      // Most OpenAI-compatible providers don't support embeddings via this endpoint
      throw new Error(
        'Embeddings are not supported through this OpenAI-compatible provider',
      );
    },
  };

  return generator;
}

function normalizeContents(contents: ContentUnion | ContentUnion[]): Content[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }

  if (Array.isArray(contents)) {
    return contents.map((content) => {
      if (typeof content === 'string') {
        return { role: 'user', parts: [{ text: content }] };
      }
      if (Array.isArray(content)) {
        const parts: Part[] = content.map((part) => {
          if (typeof part === 'string') {
            return { text: part };
          }
          return part;
        });
        return { role: 'user', parts };
      }
      return content as Content;
    });
  }

  return [contents as Content];
}

function extractSystemInstruction(
  request: GenerateContentParameters,
): string | undefined {
  const instruction = request.config?.systemInstruction;
  if (!instruction) return undefined;

  if (typeof instruction === 'string') {
    return instruction;
  }

  if ('parts' in instruction && instruction.parts) {
    return instruction.parts
      .map((part: Part) => ('text' in part && part.text ? part.text : ''))
      .join('\n');
  }

  return undefined;
}

function convertToOpenAIFormat(
  request: GenerateContentParameters,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const contents = normalizeContents(request.contents);

  return contents
    .map((content: Content) => {
      const role: 'user' | 'assistant' | 'system' | 'tool' =
        content.role === 'model'
          ? 'assistant'
          : content.role === 'user'
            ? 'user'
            : content.role === 'system'
              ? 'system'
              : content.role === 'tool'
                ? 'tool'
                : 'user';
      const parts = content.parts || [];

      // Handle single text part
      if (parts.length === 1 && parts[0] && 'text' in parts[0]) {
        return {
          role: role as 'user' | 'assistant',
          content: parts[0].text || '',
        };
      }

      // Handle function calls
      const functionCalls = parts.filter(
        (part: Part) => part && 'functionCall' in part,
      );

      if (functionCalls.length > 0 && role === 'assistant') {
        const toolCalls = functionCalls
          .map((part: Part, index: number) => {
            const functionCall = part.functionCall as {
              name?: string;
              args?: unknown;
              id?: string;
            };
            if (!functionCall) return null;

            // Use id if available, otherwise generate a unique ID
            // This ID must match the tool_call_id in the corresponding tool response
            const callId = functionCall.id || `call_${index}`;

            return {
              id: callId,
              type: 'function' as const,
              function: {
                name: functionCall.name || '',
                arguments: JSON.stringify(functionCall.args || {}),
              },
            };
          })
          .filter(Boolean);

        return {
          role: 'assistant' as const,
          content: null,
          tool_calls: toolCalls as OpenAI.Chat.ChatCompletionMessageToolCall[],
        };
      }

      // Handle function responses
      const functionResponses = parts.filter(
        (part: Part) => part && 'functionResponse' in part,
      );

      if (functionResponses.length > 0 && role === 'tool') {
        return functionResponses.map((part: Part, index: number) => {
          const funcResponse = part.functionResponse as {
            name?: string;
            response?: unknown;
            id?: string;
          };
          // Use id if available, otherwise fall back to name-based ID for compatibility
          // Anthropic requires tool_call_id to match the id from the tool_calls message
          const toolCallId =
            funcResponse?.id || funcResponse?.name || `call_${index}`;
          return {
            role: 'tool' as const,
            tool_call_id: toolCallId,
            content: JSON.stringify(funcResponse?.response || {}),
          };
        });
      }

      // Handle text parts
      const textParts = parts.filter((part: Part) => part && 'text' in part);
      const text = textParts
        .map((part: Part) => ('text' in part ? part.text || '' : ''))
        .join('\n');

      return {
        role: role === 'user' ? 'user' : 'assistant',
        content: text,
      };
    })
    .flat() as OpenAI.Chat.ChatCompletionMessageParam[];
}

function convertTools(
  tools?: ToolListUnion,
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!tools) return undefined;

  const toolsArray = Array.isArray(tools) ? tools : [tools];
  if (toolsArray.length === 0) return undefined;

  const firstTool = toolsArray[0];
  if (!firstTool || typeof firstTool === 'string') return undefined;

  const functionDeclarations = (firstTool as GenaiTool).functionDeclarations;
  if (!functionDeclarations) return undefined;

  return functionDeclarations.map((func) => {
    // Ensure parameters is a valid JSON Schema object
    // OpenRouter/Anthropic require at minimum { type: "object", properties: {} }
    let parameters = func.parameters as Record<string, unknown> | undefined;
    if (!parameters || Object.keys(parameters).length === 0) {
      parameters = { type: 'object', properties: {} };
    } else if (!parameters['type']) {
      // If parameters exist but no type, wrap in object schema
      parameters = { type: 'object', properties: parameters };
    }

    return {
      type: 'function' as const,
      function: {
        name: func.name || '',
        description: func.description,
        parameters,
      },
    };
  });
}

function convertToGeminiResponse(
  completion: OpenAI.Chat.ChatCompletion,
): GenerateContentResponse {
  const choice = completion.choices[0];
  const message = choice?.message;

  const parts: Part[] = [];

  if (message?.content) {
    parts.push({ text: message.content });
  }

  if (message?.tool_calls) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.function) {
        // Safely parse tool call arguments - handle undefined, empty, or invalid JSON
        let args: Record<string, unknown> = {};
        const rawArgs = toolCall.function.arguments;
        if (rawArgs && rawArgs !== 'undefined' && rawArgs.trim()) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            // If parsing fails, try to use as-is or empty object
            console.error(
              `[OpenAI Compat] Failed to parse tool call arguments: ${rawArgs}`,
            );
            args = {};
          }
        }
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args,
          },
        });
      }
    }
  }

  const candidates: Candidate[] = [
    {
      content: {
        role: 'model',
        parts,
      },
      finishReason: mapFinishReason(choice?.finish_reason),
      avgLogprobs: 0,
    },
  ];

  const promptFeedback = new GenerateContentResponsePromptFeedback();
  promptFeedback.blockReason = BlockedReason.BLOCKED_REASON_UNSPECIFIED;
  promptFeedback.safetyRatings = [];

  const usage = completion.usage as OpenAIUsage | undefined;

  const usageMetadata = new GenerateContentResponseUsageMetadata();
  usageMetadata.promptTokenCount = usage?.prompt_tokens || 0;
  usageMetadata.candidatesTokenCount = usage?.completion_tokens || 0;
  usageMetadata.totalTokenCount = usage?.total_tokens || 0;
  usageMetadata.cachedContentTokenCount = 0;

  const response = new GenerateContentResponse();
  response.candidates = candidates;
  response.promptFeedback = promptFeedback;
  response.usageMetadata = usageMetadata;

  return response;
}

function convertChunkToGeminiResponse(
  chunk: OpenAI.Chat.ChatCompletionChunk,
): GenerateContentResponse {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;

  const parts: Part[] = [];

  // Only handle text content in streaming chunks
  // Tool calls are accumulated separately and emitted when finish_reason is set
  if (delta?.content) {
    parts.push({ text: delta.content });
  }

  const candidates: Candidate[] =
    parts.length > 0
      ? [
          {
            content: {
              role: 'model',
              parts,
            },
            finishReason: choice?.finish_reason
              ? mapFinishReason(choice.finish_reason)
              : FinishReason.STOP,
            avgLogprobs: 0,
          },
        ]
      : [];

  const response = new GenerateContentResponse();
  response.candidates = candidates;

  const promptFeedback = new GenerateContentResponsePromptFeedback();
  promptFeedback.blockReason = BlockedReason.BLOCKED_REASON_UNSPECIFIED;
  promptFeedback.safetyRatings = [];
  response.promptFeedback = promptFeedback;

  const usage = chunk.usage as OpenAIUsage | undefined;
  if (usage) {
    const usageMetadata = new GenerateContentResponseUsageMetadata();
    usageMetadata.promptTokenCount = usage.prompt_tokens || 0;
    usageMetadata.candidatesTokenCount = usage.completion_tokens || 0;
    usageMetadata.totalTokenCount = usage.total_tokens || 0;
    usageMetadata.cachedContentTokenCount = 0;
    response.usageMetadata = usageMetadata;
  }

  return response;
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return FinishReason.STOP;
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'tool_calls':
    case 'function_call':
      return FinishReason.STOP;
    case 'content_filter':
      return FinishReason.SAFETY;
    default:
      return FinishReason.OTHER;
  }
}

function convertError(error: unknown): Error {
  if (error instanceof OpenAI.APIError) {
    // Extract detailed error information from the API response
    let details = '';
    if (error.error && typeof error.error === 'object') {
      const errorObj = error.error as Record<string, unknown>;
      if (errorObj['message']) {
        details = ` Details: ${errorObj['message']}`;
      }
      if (errorObj['metadata']) {
        details += ` Metadata: ${JSON.stringify(errorObj['metadata'])}`;
      }
      // OpenRouter often includes error details in nested error object
      if (errorObj['error'] && typeof errorObj['error'] === 'object') {
        const nestedError = errorObj['error'] as Record<string, unknown>;
        if (nestedError['message']) {
          details += ` Nested: ${nestedError['message']}`;
        }
      }
      // Include raw error for debugging
      if (!details) {
        details = ` Raw: ${JSON.stringify(error.error)}`;
      }
    }
    const message = `OpenAI-Compatible API Error: ${error.status} - ${error.message}${details}`;
    console.error('[OpenAI Compat] API Error:', {
      status: error.status,
      message: error.message,
      error: JSON.stringify(error.error, null, 2),
      headers: error.headers,
    });
    const newError = new Error(message);
    (newError as Error & { status?: number }).status = error.status;
    return newError;
  }
  return error instanceof Error ? error : new Error(String(error));
}
