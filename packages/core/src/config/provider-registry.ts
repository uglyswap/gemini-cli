/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider Registry
 * Defines all supported LLM providers with their configurations
 */

export interface ProviderDefinition {
  /** Unique provider ID */
  id: string;
  /** Display name */
  name: string;
  /** Provider description */
  description: string;
  /** Base URL for API (can be overridden) */
  defaultBaseUrl?: string;
  /** Whether API key is required */
  requiresApiKey: boolean;
  /** Placeholder for API key input */
  apiKeyPlaceholder?: string;
  /** URL to get API key */
  apiKeyUrl?: string;
  /** Endpoint to fetch available models (relative to base URL) */
  modelsEndpoint?: string;
  /** How to parse the models response */
  modelsParser?: 'openai' | 'ollama' | 'gemini' | 'custom';
  /** Default model for this provider */
  defaultModel: string;
  /** Hardcoded models (for providers without model list API) */
  hardcodedModels?: string[];
  /** Whether this is a local provider */
  isLocal: boolean;
  /** Icon/emoji for display */
  icon: string;
}

/**
 * All supported providers
 */
export const PROVIDER_REGISTRY: ProviderDefinition[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: "Google's Gemini models with free tier (60 req/min)",
    requiresApiKey: true,
    apiKeyPlaceholder: 'AIza...',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    modelsParser: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    hardcodedModels: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    isLocal: false,
    icon: '🔷',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description:
      '100+ models from multiple providers (Claude, GPT-4, Llama, etc.)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-or-v1-...',
    apiKeyUrl: 'https://openrouter.ai/keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    isLocal: false,
    icon: '🌐',
  },
  {
    id: 'zai',
    name: 'Z.AI (GLM)',
    description: 'Z.AI with GLM-4 models',
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    requiresApiKey: true,
    apiKeyPlaceholder: 'your-zai-api-key',
    apiKeyUrl: 'https://docs.z.ai',
    modelsParser: 'openai',
    defaultModel: 'glm-4.7',
    hardcodedModels: ['glm-4.7', 'glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    isLocal: false,
    icon: '🇨🇳',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Run models locally with Ollama (free, private)',
    defaultBaseUrl: 'http://localhost:11434',
    requiresApiKey: false,
    modelsEndpoint: '/api/tags',
    modelsParser: 'ollama',
    defaultModel: 'llama3.2',
    isLocal: true,
    icon: '🦙',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    description: 'Run models locally with LM Studio',
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresApiKey: false,
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'local-model',
    isLocal: true,
    icon: '💻',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT models (GPT-4, GPT-4o, etc.)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'gpt-4o',
    isLocal: false,
    icon: '🤖',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Direct)',
    description: 'Claude models directly from Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    modelsParser: 'custom',
    defaultModel: 'claude-3-5-sonnet-20241022',
    hardcodedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ],
    isLocal: false,
    icon: '🟠',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with Groq LPU',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'gsk_...',
    apiKeyUrl: 'https://console.groq.com/keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'llama-3.3-70b-versatile',
    isLocal: false,
    icon: '⚡',
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Open-source models with Together AI',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'your-together-api-key',
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    isLocal: false,
    icon: '🤝',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral models (Mixtral, Mistral Large, etc.)',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'your-mistral-api-key',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'mistral-large-latest',
    isLocal: false,
    icon: '🌀',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek coding and reasoning models',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    apiKeyPlaceholder: 'your-deepseek-api-key',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'deepseek-chat',
    hardcodedModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    isLocal: false,
    icon: '🔮',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    description: 'Any OpenAI-compatible API endpoint',
    requiresApiKey: true,
    apiKeyPlaceholder: 'your-api-key',
    modelsEndpoint: '/models',
    modelsParser: 'openai',
    defaultModel: 'default',
    isLocal: false,
    icon: '🔧',
  },
];

/**
 * Get provider by ID
 */
export function getProviderById(id: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

/**
 * Get all provider IDs
 */
export function getAllProviderIds(): string[] {
  return PROVIDER_REGISTRY.map((p) => p.id);
}

/**
 * Get providers grouped by type (cloud vs local)
 */
export function getProvidersByType(): {
  cloud: ProviderDefinition[];
  local: ProviderDefinition[];
} {
  return {
    cloud: PROVIDER_REGISTRY.filter((p) => !p.isLocal),
    local: PROVIDER_REGISTRY.filter((p) => p.isLocal),
  };
}
