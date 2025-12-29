/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Context Service
 * Fetches and caches context window limits for different providers and models
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Model info with context limit
 */
export interface ModelInfo {
  /** Model ID */
  id: string;
  /** Context window size in tokens */
  contextLength: number;
  /** Max completion tokens (optional) */
  maxCompletionTokens?: number;
}

/**
 * Cached model context info
 */
interface ModelContextCache {
  /** Model info keyed by model ID */
  models: Record<string, ModelInfo>;
  /** When the cache was fetched */
  fetchedAt: string;
  /** TTL in hours */
  ttlHours: number;
}

/**
 * Complete cache file structure
 */
interface ModelContextCacheFile {
  /** Cache per provider ID */
  providers: Record<string, ModelContextCache>;
}

/**
 * Default token limit when not found
 */
export const DEFAULT_TOKEN_LIMIT = 1_048_576;

/**
 * Cache TTL in hours
 */
const CACHE_TTL_HOURS = 24;

/**
 * In-memory cache for faster access
 */
let memoryCache: ModelContextCacheFile | null = null;

/**
 * Get cache file path
 */
function getCacheFilePath(): string {
  return path.join(os.homedir(), '.gemini', 'model-context-cache.json');
}

/**
 * Load cache from disk
 */
function loadCache(): ModelContextCacheFile {
  if (memoryCache) return memoryCache;

  try {
    const cachePath = getCacheFilePath();
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8');
      memoryCache = JSON.parse(content);
      return memoryCache!;
    }
  } catch {
    // Ignore cache read errors
  }

  memoryCache = { providers: {} };
  return memoryCache;
}

/**
 * Save cache to disk
 */
function saveCache(cache: ModelContextCacheFile): void {
  try {
    const cachePath = getCacheFilePath();
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    memoryCache = cache;
  } catch (error) {
    console.warn('[ModelContextService] Failed to save cache:', error);
  }
}

/**
 * Check if cache is valid (not expired)
 */
function isCacheValid(cache: ModelContextCache | undefined): boolean {
  if (!cache) return false;

  const fetchedAt = new Date(cache.fetchedAt);
  const now = new Date();
  const hoursSinceFetch =
    (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);

  return hoursSinceFetch < cache.ttlHours;
}

/**
 * Fetch models from OpenRouter API
 */
async function fetchOpenRouterModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  const models: Record<string, ModelInfo> = {};

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
    });

    if (!response.ok) {
      console.warn(
        `[ModelContextService] OpenRouter API returned ${response.status}`,
      );
      return models;
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        context_length?: number;
        top_provider?: {
          context_length?: number;
          max_completion_tokens?: number;
        };
      }>;
    };

    for (const model of data.data || []) {
      const contextLength =
        model.top_provider?.context_length || model.context_length;
      if (contextLength) {
        models[model.id] = {
          id: model.id,
          contextLength,
          maxCompletionTokens: model.top_provider?.max_completion_tokens,
        };
      }
    }
  } catch (error) {
    console.warn(
      '[ModelContextService] Failed to fetch OpenRouter models:',
      error,
    );
  }

  return models;
}

/**
 * Fetch models from OpenAI-compatible API (generic)
 * Works with: OpenAI, Groq, Together, Mistral, DeepSeek, LM Studio, etc.
 */
async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey?: string,
  knownLimits?: Record<string, number>,
): Promise<Record<string, ModelInfo>> {
  const models: Record<string, ModelInfo> = {};

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers,
    });

    if (!response.ok) {
      return models;
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        context_length?: number;
        context_window?: number; // Mistral uses this
        max_context_length?: number; // Some providers use this
      }>;
      // Together AI returns array directly
      object?: string;
    };

    const modelList = data.data || (Array.isArray(data) ? data : []);

    for (const model of modelList) {
      if (!model.id) continue;

      // Try to get context length from various fields
      const contextLength =
        model.context_length ||
        model.context_window ||
        model.max_context_length ||
        knownLimits?.[model.id] ||
        KNOWN_CONTEXT_LIMITS[model.id];

      if (contextLength) {
        models[model.id] = {
          id: model.id,
          contextLength,
        };
      }
    }
  } catch {
    // API might not be reachable
  }

  return models;
}

/**
 * Fetch models from Mistral API (has context_window field)
 */
async function fetchMistralModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  const models: Record<string, ModelInfo> = {};

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://api.mistral.ai/v1/models', {
      headers,
    });

    if (!response.ok) {
      return models;
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        max_context_length?: number;
      }>;
    };

    // Mistral known limits
    const MISTRAL_LIMITS: Record<string, number> = {
      'mistral-large-latest': 128_000,
      'mistral-large-2411': 128_000,
      'mistral-medium-latest': 32_000,
      'mistral-small-latest': 32_000,
      'codestral-latest': 32_000,
      'open-mistral-7b': 32_000,
      'open-mixtral-8x7b': 32_000,
      'open-mixtral-8x22b': 64_000,
      'pixtral-12b-2409': 128_000,
      'ministral-8b-latest': 128_000,
      'ministral-3b-latest': 128_000,
    };

    for (const model of data.data || []) {
      const contextLength =
        model.max_context_length || MISTRAL_LIMITS[model.id] || 32_000;
      models[model.id] = {
        id: model.id,
        contextLength,
      };
    }
  } catch {
    // API not reachable
  }

  return models;
}

/**
 * Fetch models from Together AI (has context_length field)
 */
async function fetchTogetherModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  const models: Record<string, ModelInfo> = {};

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://api.together.xyz/v1/models', {
      headers,
    });

    if (!response.ok) {
      return models;
    }

    const data = (await response.json()) as Array<{
      id: string;
      context_length?: number;
    }>;

    for (const model of data || []) {
      if (model.context_length) {
        models[model.id] = {
          id: model.id,
          contextLength: model.context_length,
        };
      }
    }
  } catch {
    // API not reachable
  }

  return models;
}

/**
 * Fetch models from Groq API
 */
async function fetchGroqModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  // Groq known context limits
  const GROQ_LIMITS: Record<string, number> = {
    'llama-3.3-70b-versatile': 128_000,
    'llama-3.3-70b-specdec': 8_192,
    'llama-3.1-70b-versatile': 128_000,
    'llama-3.1-8b-instant': 128_000,
    'llama-3.2-1b-preview': 128_000,
    'llama-3.2-3b-preview': 128_000,
    'llama-3.2-11b-vision-preview': 128_000,
    'llama-3.2-90b-vision-preview': 128_000,
    'mixtral-8x7b-32768': 32_768,
    'gemma2-9b-it': 8_192,
    'gemma-7b-it': 8_192,
  };

  return fetchOpenAICompatibleModels(
    'https://api.groq.com/openai/v1',
    apiKey,
    GROQ_LIMITS,
  );
}

/**
 * Fetch models from DeepSeek API
 */
async function fetchDeepSeekModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  const DEEPSEEK_LIMITS: Record<string, number> = {
    'deepseek-chat': 64_000,
    'deepseek-coder': 16_384,
    'deepseek-reasoner': 64_000,
  };

  return fetchOpenAICompatibleModels(
    'https://api.deepseek.com/v1',
    apiKey,
    DEEPSEEK_LIMITS,
  );
}

/**
 * Fetch models from OpenAI API
 */
async function fetchOpenAIModels(
  apiKey?: string,
): Promise<Record<string, ModelInfo>> {
  const OPENAI_LIMITS: Record<string, number> = {
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4-turbo': 128_000,
    'gpt-4-turbo-preview': 128_000,
    'gpt-4': 8_192,
    'gpt-4-32k': 32_768,
    'gpt-3.5-turbo': 16_385,
    'gpt-3.5-turbo-16k': 16_385,
    'o1-preview': 128_000,
    'o1-mini': 128_000,
  };

  return fetchOpenAICompatibleModels(
    'https://api.openai.com/v1',
    apiKey,
    OPENAI_LIMITS,
  );
}

/**
 * Fetch models from Ollama API
 */
async function fetchOllamaModels(
  baseUrl: string,
): Promise<Record<string, ModelInfo>> {
  const models: Record<string, ModelInfo> = {};

  try {
    const response = await fetch(`${baseUrl}/api/tags`);

    if (!response.ok) {
      return models;
    }

    const data = (await response.json()) as {
      models: Array<{
        name: string;
        details?: {
          parameter_size?: string;
        };
      }>;
    };

    // Ollama doesn't provide context_length directly, use common defaults
    const OLLAMA_CONTEXT_DEFAULTS: Record<string, number> = {
      'llama3.2': 128_000,
      'llama3.1': 128_000,
      llama3: 8_192,
      mistral: 32_768,
      mixtral: 32_768,
      phi3: 128_000,
      'qwen2.5': 32_768,
      'deepseek-coder': 16_384,
      codellama: 16_384,
    };

    for (const model of data.models || []) {
      const baseName = model.name.split(':')[0];
      const contextLength =
        OLLAMA_CONTEXT_DEFAULTS[baseName] || DEFAULT_TOKEN_LIMIT;
      models[model.name] = {
        id: model.name,
        contextLength,
      };
    }
  } catch {
    // Ollama might not be running
  }

  return models;
}

/**
 * Known context limits for common models (fallback when API not available)
 */
const KNOWN_CONTEXT_LIMITS: Record<string, number> = {
  // Gemini models
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-flash-lite': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-preview-image-generation': 32_000,

  // OpenRouter / Anthropic
  'anthropic/claude-3.5-sonnet': 200_000,
  'anthropic/claude-3-opus': 200_000,
  'anthropic/claude-3-sonnet': 200_000,
  'anthropic/claude-3-haiku': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'openai/gpt-4o': 128_000,
  'openai/gpt-4-turbo': 128_000,

  // Google via OpenRouter
  'google/gemini-2.5-pro': 1_048_576,
  'google/gemini-2.5-flash': 1_048_576,
  'google/gemini-pro-1.5': 2_097_152,

  // Mistral
  'mistral-large-latest': 128_000,
  'mistral-medium': 32_000,
  'mistral-small': 32_000,
  'mistralai/mistral-large': 128_000,

  // Llama via OpenRouter
  'meta-llama/llama-3.3-70b-instruct': 128_000,
  'meta-llama/llama-3.1-70b-instruct': 128_000,
  'meta-llama/llama-3.1-8b-instruct': 128_000,

  // DeepSeek
  'deepseek-chat': 64_000,
  'deepseek-coder': 16_384,
  'deepseek/deepseek-chat': 64_000,

  // Groq
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-70b-versatile': 128_000,
  'mixtral-8x7b-32768': 32_768,

  // GLM / Z.AI
  'glm-4.7': 128_000,
  'glm-4-flash': 128_000,
  'glm-4-plus': 128_000,
  'glm-4-air': 128_000,
};

/**
 * Fetch and cache model context limits for a provider
 */
export async function fetchAndCacheModelContextLimits(
  providerId: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<void> {
  const cache = loadCache();

  // Skip if cache is valid
  if (isCacheValid(cache.providers[providerId])) {
    return;
  }

  let models: Record<string, ModelInfo> = {};

  switch (providerId) {
    case 'openrouter':
      models = await fetchOpenRouterModels(apiKey);
      break;

    case 'ollama':
      models = await fetchOllamaModels(baseUrl || 'http://localhost:11434');
      break;

    case 'openai':
      models = await fetchOpenAIModels(apiKey);
      break;

    case 'groq':
      models = await fetchGroqModels(apiKey);
      break;

    case 'together':
      models = await fetchTogetherModels(apiKey);
      break;

    case 'mistral':
      models = await fetchMistralModels(apiKey);
      break;

    case 'deepseek':
      models = await fetchDeepSeekModels(apiKey);
      break;

    case 'lmstudio':
      models = await fetchOpenAICompatibleModels(
        baseUrl || 'http://localhost:1234/v1',
        apiKey,
      );
      break;

    case 'zai':
      models = await fetchOpenAICompatibleModels(
        baseUrl || 'https://api.z.ai/api/coding/paas/v4',
        apiKey,
        { 'glm-4.7': 128_000, 'glm-4-flash': 128_000, 'glm-4-plus': 128_000 },
      );
      break;

    case 'anthropic':
      // Anthropic API doesn't expose context limits, use known values
      models = {
        'claude-3-5-sonnet-20241022': {
          id: 'claude-3-5-sonnet-20241022',
          contextLength: 200_000,
        },
        'claude-3-5-haiku-20241022': {
          id: 'claude-3-5-haiku-20241022',
          contextLength: 200_000,
        },
        'claude-3-opus-20240229': {
          id: 'claude-3-opus-20240229',
          contextLength: 200_000,
        },
        'claude-3-sonnet-20240229': {
          id: 'claude-3-sonnet-20240229',
          contextLength: 200_000,
        },
        'claude-3-haiku-20240307': {
          id: 'claude-3-haiku-20240307',
          contextLength: 200_000,
        },
      };
      break;

    case 'gemini':
    case 'google':
      // Gemini/Google API - use known Gemini limits
      models = {
        'gemini-2.5-pro': { id: 'gemini-2.5-pro', contextLength: 1_048_576 },
        'gemini-2.5-flash': {
          id: 'gemini-2.5-flash',
          contextLength: 1_048_576,
        },
        'gemini-2.0-flash': {
          id: 'gemini-2.0-flash',
          contextLength: 1_048_576,
        },
        'gemini-1.5-pro': { id: 'gemini-1.5-pro', contextLength: 2_097_152 },
        'gemini-1.5-flash': {
          id: 'gemini-1.5-flash',
          contextLength: 1_048_576,
        },
      };
      break;

    case 'custom':
      // For custom OpenAI-compatible endpoints
      if (baseUrl) {
        models = await fetchOpenAICompatibleModels(baseUrl, apiKey);
      }
      break;

    default:
      // Unknown provider - try as OpenAI-compatible if baseUrl provided
      if (baseUrl) {
        models = await fetchOpenAICompatibleModels(baseUrl, apiKey);
      }
      return;
  }

  if (Object.keys(models).length > 0) {
    cache.providers[providerId] = {
      models,
      fetchedAt: new Date().toISOString(),
      ttlHours: CACHE_TTL_HOURS,
    };
    saveCache(cache);
  }
}

/**
 * Get context limit for a model
 */
export function getModelContextLimit(
  model: string,
  providerId?: string,
): number {
  const cache = loadCache();

  // Check provider-specific cache first
  if (providerId && isCacheValid(cache.providers[providerId])) {
    const modelInfo = cache.providers[providerId].models[model];
    if (modelInfo?.contextLength) {
      return modelInfo.contextLength;
    }
  }

  // Check all provider caches
  for (const providerCache of Object.values(cache.providers)) {
    if (isCacheValid(providerCache)) {
      const modelInfo = providerCache.models[model];
      if (modelInfo?.contextLength) {
        return modelInfo.contextLength;
      }
    }
  }

  // Fall back to known limits
  if (KNOWN_CONTEXT_LIMITS[model]) {
    return KNOWN_CONTEXT_LIMITS[model];
  }

  // Return default
  return DEFAULT_TOKEN_LIMIT;
}

/**
 * Clear model context cache
 */
export function clearModelContextCache(providerId?: string): void {
  const cache = loadCache();

  if (providerId) {
    delete cache.providers[providerId];
  } else {
    cache.providers = {};
  }

  saveCache(cache);
}

/**
 * Set context limit manually (for testing or overrides)
 */
export function setModelContextLimit(
  model: string,
  contextLength: number,
  providerId: string = 'manual',
): void {
  const cache = loadCache();

  if (!cache.providers[providerId]) {
    cache.providers[providerId] = {
      models: {},
      fetchedAt: new Date().toISOString(),
      ttlHours: CACHE_TTL_HOURS * 365, // Manual entries don't expire
    };
  }

  cache.providers[providerId].models[model] = {
    id: model,
    contextLength,
  };

  saveCache(cache);
}
