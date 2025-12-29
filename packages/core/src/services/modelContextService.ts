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

    // For other providers, we don't have API access to fetch limits
    // They will use KNOWN_CONTEXT_LIMITS fallback
    default:
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
