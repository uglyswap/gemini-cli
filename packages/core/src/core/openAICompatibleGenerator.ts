/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenAI-Compatible Content Generator
 * Supports Z.AI (GLM4.7), OpenRouter, Ollama, LM Studio, and other OpenAI-compatible APIs
 */

import OpenAI from 'openai';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from './contentGenerator.js';
import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  Candidate,
  FinishReason,
  GenerateContentResponsePromptFeedback,
  BlockedReason,
  GenerateContentResponseUsageMetadata,
  ContentUnion,
} from '@google/genai';
import type { ToolListUnion, Tool as GenaiTool } from '@google/genai';

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
      'pro': 'glm-4.7',
      'flash': 'glm-4.7',
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
  const modelName = config.openAICompatibleModel || mapModelName(config.model, baseUrl);

  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey: config.apiKey || 'not-required', // Some local providers don't need a key
    defaultHeaders: {
      ...httpOptions.headers,
      'HTTP-Referer': 'https://github.com/google-gemini/gemini-cli',
      'X-Title': 'Gemini CLI (OpenAI Compatible)',
    },
  });

  async function* doGenerateContentStream(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    try {
      const messages = convertToOpenAIFormat(request);
      const systemInstruction = extractSystemInstruction(request);

      const stream = await client.chat.completions.create({
        model: request.model || modelName,
        messages: systemInstruction
          ? [{ role: 'system', content: systemInstruction }, ...messages]
          : messages,
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
        max_tokens: request.config?.maxOutputTokens || 20000,
        tools: convertTools(request.config?.tools),
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        yield convertChunkToGeminiResponse(chunk);
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

        const completion = await client.chat.completions.create({
          model: request.model || modelName,
          messages: systemInstruction
            ? [{ role: 'system', content: systemInstruction }, ...messages]
            : messages,
          temperature: request.config?.temperature,
          top_p: request.config?.topP,
          max_tokens: request.config?.maxOutputTokens || 20000,
          tools: convertTools(request.config?.tools),
          response_format:
            request.config?.responseMimeType === 'application/json'
              ? { type: 'json_object' }
              : undefined,
          stream: false,
        });

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
      const role =
        content.role === 'model' ? 'assistant' : (content.role as string);
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
            const functionCall = part.functionCall;
            if (!functionCall) return null;

            return {
              id: functionCall.id || `call_${index}`,
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

      if (functionResponses.length > 0 && role === 'function') {
        return functionResponses.map((part: Part, index: number) => ({
          role: 'tool' as const,
          tool_call_id: part.functionResponse?.name || `call_${index}`,
          content: JSON.stringify(part.functionResponse?.response || {}),
        }));
      }

      // Handle text parts
      const textParts = parts.filter((part: Part) => part && 'text' in part);
      const text = textParts
        .map((part: Part) => ('text' in part ? part.text || '' : ''))
        .join('\n');

      return {
        role: (role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: text,
      };
    })
    .flat();
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

  return functionDeclarations.map((func) => ({
    type: 'function' as const,
    function: {
      name: func.name || '',
      description: func.description,
      parameters: (func.parameters || {}) as Record<string, unknown>,
    },
  }));
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
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments),
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

  if (delta?.content) {
    parts.push({ text: delta.content });
  }

  if (delta?.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.function) {
        try {
          parts.push({
            functionCall: {
              name: toolCall.function.name || '',
              args: toolCall.function.arguments
                ? JSON.parse(toolCall.function.arguments)
                : {},
            },
          });
        } catch {
          // Partial JSON in streaming, skip
        }
      }
    }
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
    const message = `OpenAI-Compatible API Error: ${error.status} - ${error.message}`;
    const newError = new Error(message);
    (newError as Error & { status?: number }).status = error.status;
    return newError;
  }
  return error instanceof Error ? error : new Error(String(error));
}
