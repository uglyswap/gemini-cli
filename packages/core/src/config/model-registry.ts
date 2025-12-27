/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Registry
 * Fetches available models from provider APIs with caching
 */

import {
  getProviderById,
  type ProviderDefinition,
} from './provider-registry.js';
import { getConfigManager } from './config-manager.js';

/**
 * Model information
 */
export interface ModelInfo {
  /** Model ID */
  id: string;
  /** Display name */
  name?: string;
  /** Description */
  description?: string;
  /** Context window size */
  contextLength?: number;
  /** Pricing info */
  pricing?: {
    prompt: number;
    completion: number;
  };
  /** Whether model supports vision */
  supportsVision?: boolean;
  /** Whether model supports function calling */
  supportsFunctionCalling?: boolean;
}

/**
 * Result of fetching models
 */
export interface FetchModelsResult {
  success: boolean;
  models: ModelInfo[];
  error?: string;
  fromCache: boolean;
}

/**
 * OpenAI-style models response
 */
interface OpenAIModelsResponse {
  data: Array<{
    id: string;
    object: string;
    created?: number;
    owned_by?: string;
  }>;
}

/**
 * OpenRouter-style models response (extended)
 */
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    description?: string;
    context_length?: number;
    pricing?: {
      prompt: string;
      completion: string;
    };
    top_provider?: {
      context_length?: number;
    };
  }>;
}

/**
 * Ollama tags response
 */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
  }>;
}

/**
 * Fetch timeout in milliseconds
 */
const FETCH_TIMEOUT_MS = 10000;

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Maximum number of models to return (prevents UI overload)
 */
const MAX_MODELS_LIMIT = 100;

/**
 * Sleep helper for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (network errors, 5xx, 429)
 */
function isRetryableError(error: unknown, response?: Response): boolean {
  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  // Timeout errors are retryable
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  // 5xx server errors and 429 rate limit are retryable
  if (response && (response.status >= 500 || response.status === 429)) {
    return true;
  }
  return false;
}

/**
 * Type guard for OpenAI-style response
 */
function isOpenAIResponse(data: unknown): data is OpenAIModelsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'data' in data &&
    Array.isArray((data as OpenAIModelsResponse).data)
  );
}

/**
 * Type guard for Ollama response
 */
function isOllamaResponse(data: unknown): data is OllamaTagsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'models' in data &&
    Array.isArray((data as OllamaTagsResponse).models)
  );
}

/**
 * Model Registry class
 */
export class ModelRegistry {
  /**
   * Fetch available models for a provider
   */
  async fetchModels(
    providerId: string,
    options?: {
      apiKey?: string;
      baseUrl?: string;
      forceRefresh?: boolean;
    },
  ): Promise<FetchModelsResult> {
    const provider = getProviderById(providerId);
    if (!provider) {
      return {
        success: false,
        models: [],
        error: `Unknown provider: ${providerId}`,
        fromCache: false,
      };
    }

    const configManager = getConfigManager();

    // Check cache first (unless force refresh)
    if (!options?.forceRefresh) {
      const cached = configManager.getCachedModels(providerId);
      if (cached && cached.length > 0) {
        return {
          success: true,
          models: cached.map((id) => ({ id })),
          fromCache: true,
        };
      }
    }

    // Use hardcoded models if no API endpoint
    if (provider.hardcodedModels && !provider.modelsEndpoint) {
      const models = provider.hardcodedModels.map((id) => ({ id }));
      configManager.setCachedModels(providerId, provider.hardcodedModels);
      return {
        success: true,
        models,
        fromCache: false,
      };
    }

    // Fetch from API
    try {
      const models = await this.fetchFromApi(provider, options);

      // Cache the results
      if (models.length > 0) {
        configManager.setCachedModels(
          providerId,
          models.map((m) => m.id),
        );
      }

      return {
        success: true,
        models,
        fromCache: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Fallback to hardcoded models on error
      if (provider.hardcodedModels) {
        return {
          success: true,
          models: provider.hardcodedModels.map((id) => ({ id })),
          error: `API fetch failed, using hardcoded models: ${errorMessage}`,
          fromCache: false,
        };
      }

      return {
        success: false,
        models: [],
        error: errorMessage,
        fromCache: false,
      };
    }
  }

  /**
   * Fetch models from provider API with retry logic
   */
  private async fetchFromApi(
    provider: ProviderDefinition,
    options?: {
      apiKey?: string;
      baseUrl?: string;
    },
  ): Promise<ModelInfo[]> {
    const baseUrl = options?.baseUrl || provider.defaultBaseUrl;
    if (!baseUrl || !provider.modelsEndpoint) {
      throw new Error('Provider does not have a models endpoint');
    }

    const url = `${baseUrl}${provider.modelsEndpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    // Add authorization if API key provided
    if (options?.apiKey) {
      headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

    let lastError: Error | null = null;
    let delayMs = RETRY_CONFIG.initialDelayMs;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = new Error(
            `HTTP ${response.status}: ${response.statusText}`,
          );
          if (
            isRetryableError(error, response) &&
            attempt < RETRY_CONFIG.maxRetries
          ) {
            lastError = error;
            await sleep(delayMs);
            delayMs = Math.min(
              delayMs * RETRY_CONFIG.backoffMultiplier,
              RETRY_CONFIG.maxDelayMs,
            );
            continue;
          }
          throw error;
        }

        const data = await response.json();
        return this.parseModelsResponse(
          data,
          provider.modelsParser || 'openai',
        );
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error('Request timeout');
        } else if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }

        // Check if we should retry
        if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
          await sleep(delayMs);
          delayMs = Math.min(
            delayMs * RETRY_CONFIG.backoffMultiplier,
            RETRY_CONFIG.maxDelayMs,
          );
          continue;
        }

        throw lastError;
      }
    }

    // Should not reach here, but TypeScript needs this
    throw lastError || new Error('Unknown error during fetch');
  }

  /**
   * Parse models response based on provider type
   * @throws Error if response format is invalid
   */
  private parseModelsResponse(
    data: unknown,
    parser: 'openai' | 'ollama' | 'gemini' | 'custom',
  ): ModelInfo[] {
    switch (parser) {
      case 'openai':
        if (!isOpenAIResponse(data)) {
          throw new Error(
            'Invalid response format from API. Expected OpenAI-compatible models list.',
          );
        }
        return this.parseOpenAIResponse(data);
      case 'ollama':
        if (!isOllamaResponse(data)) {
          throw new Error(
            'Invalid response format from Ollama. Expected models list with "models" array.',
          );
        }
        return this.parseOllamaResponse(data);
      case 'gemini':
        // Gemini uses hardcoded models
        return [];
      default:
        if (!isOpenAIResponse(data)) {
          throw new Error(
            'Invalid response format. Expected OpenAI-compatible models list with "data" array.',
          );
        }
        return this.parseOpenAIResponse(data);
    }
  }

  /**
   * Parse OpenAI-style response
   */
  private parseOpenAIResponse(
    data: OpenAIModelsResponse | OpenRouterModelsResponse,
  ): ModelInfo[] {
    // Type guard already validated data.data is an array

    return data.data
      .filter((model) => {
        // Filter out models without ID
        if (!model.id) return false;
        // Only filter OpenRouter's free-tier variants (ending with :free)
        // This is more specific than includes() to avoid false positives
        if (model.id.endsWith(':free')) return false;
        return true;
      })
      .map((model) => {
        const info: ModelInfo = {
          id: model.id,
        };

        // OpenRouter extended fields
        if ('name' in model && model.name) {
          info.name = model.name;
        }
        if ('description' in model && model.description) {
          info.description = model.description;
        }
        if ('context_length' in model && model.context_length) {
          info.contextLength = model.context_length;
        }
        if ('top_provider' in model && model.top_provider?.context_length) {
          info.contextLength = model.top_provider.context_length;
        }
        if ('pricing' in model && model.pricing) {
          info.pricing = {
            prompt: parseFloat(model.pricing.prompt) || 0,
            completion: parseFloat(model.pricing.completion) || 0,
          };
        }

        return info;
      })
      .sort((a, b) => {
        // Sort by popularity/relevance (put common models first)
        const priorityModels = [
          'claude',
          'gpt-4',
          'gemini',
          'llama',
          'mixtral',
          'mistral',
        ];
        const aScore = priorityModels.findIndex((p) =>
          a.id.toLowerCase().includes(p),
        );
        const bScore = priorityModels.findIndex((p) =>
          b.id.toLowerCase().includes(p),
        );
        if (aScore !== -1 && bScore !== -1) return aScore - bScore;
        if (aScore !== -1) return -1;
        if (bScore !== -1) return 1;
        return a.id.localeCompare(b.id);
      })
      .slice(0, MAX_MODELS_LIMIT);
  }

  /**
   * Parse Ollama response
   */
  private parseOllamaResponse(data: OllamaTagsResponse): ModelInfo[] {
    // Type guard already validated data.models is an array
    return data.models
      .filter((model) => model.name || model.model) // Skip models without any identifier
      .map((model) => ({
        id: model.name || model.model,
        name: model.name || model.model,
      }));
  }

  /**
   * Get popular/recommended models for a provider
   */
  getRecommendedModels(providerId: string): string[] {
    switch (providerId) {
      case 'openrouter':
        return [
          'anthropic/claude-3.5-sonnet',
          'anthropic/claude-3-opus',
          'openai/gpt-4o',
          'google/gemini-2.5-pro',
          'meta-llama/llama-3.3-70b-instruct',
          'mistralai/mixtral-8x22b-instruct',
        ];
      case 'gemini':
        return ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
      case 'openai':
        return [
          'gpt-4o',
          'gpt-4o-mini',
          'gpt-4-turbo',
          'o1-preview',
          'o1-mini',
        ];
      case 'anthropic':
        return [
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
        ];
      case 'ollama':
        return [
          'llama3.2',
          'llama3.1',
          'mistral',
          'mixtral',
          'codellama',
          'qwen2.5',
        ];
      case 'groq':
        return [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'mixtral-8x7b-32768',
        ];
      default:
        return [];
    }
  }

  /**
   * Check if Ollama is running locally
   */
  async isOllamaRunning(baseUrl = 'http://localhost:11434'): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${baseUrl}/api/version`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if LM Studio is running locally
   */
  async isLMStudioRunning(
    baseUrl = 'http://localhost:1234/v1',
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${baseUrl}/models`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
let modelRegistryInstance: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!modelRegistryInstance) {
    modelRegistryInstance = new ModelRegistry();
  }
  return modelRegistryInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetModelRegistry(): void {
  modelRegistryInstance = null;
}
