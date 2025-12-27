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
   * Fetch models from provider API
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
      'Content-Type': 'application/json',
    };

    // Add authorization if API key provided
    if (options?.apiKey) {
      headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseModelsResponse(data, provider.modelsParser || 'openai');
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Parse models response based on provider type
   */
  private parseModelsResponse(
    data: unknown,
    parser: 'openai' | 'ollama' | 'gemini' | 'custom',
  ): ModelInfo[] {
    switch (parser) {
      case 'openai':
        return this.parseOpenAIResponse(
          data as OpenAIModelsResponse | OpenRouterModelsResponse,
        );
      case 'ollama':
        return this.parseOllamaResponse(data as OllamaTagsResponse);
      case 'gemini':
        // Gemini uses hardcoded models
        return [];
      default:
        return this.parseOpenAIResponse(data as OpenAIModelsResponse);
    }
  }

  /**
   * Parse OpenAI-style response
   */
  private parseOpenAIResponse(
    data: OpenAIModelsResponse | OpenRouterModelsResponse,
  ): ModelInfo[] {
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data
      .filter((model) => model.id && !model.id.includes(':free'))
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
      });
  }

  /**
   * Parse Ollama response
   */
  private parseOllamaResponse(data: OllamaTagsResponse): ModelInfo[] {
    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models.map((model) => ({
      id: model.name || model.model,
      name: model.name,
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
