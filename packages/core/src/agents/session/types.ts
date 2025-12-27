/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Tool } from '@google/genai';
import type { SpecializedAgent, ModelTier } from '../specialized/types.js';

/**
 * Configuration for creating an agent session
 */
export interface AgentSessionConfig {
  /** The specialized agent definition */
  agent: SpecializedAgent;
  /** Working directory for file operations */
  workingDirectory: string;
  /** Optional initial context/history */
  initialContext?: Content[];
  /** Optional tools override (defaults to agent's tools) */
  tools?: Tool[];
  /** Maximum tokens for this session */
  maxTokens?: number;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * Result from an agent task execution
 */
export interface AgentTaskResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** The agent's response/output */
  output: string;
  /** Any files that were modified */
  modifiedFiles?: string[];
  /** Any files that were created */
  createdFiles?: string[];
  /** Any files that were deleted */
  deletedFiles?: string[];
  /** Error message if failed */
  error?: string;
  /** Token usage statistics */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Tool calls made during execution */
  toolCalls?: AgentToolCall[];
}

/**
 * Record of a tool call made by an agent
 */
export interface AgentToolCall {
  /** Tool name */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Tool result */
  result?: unknown;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Session state for tracking
 */
export interface AgentSessionState {
  /** Unique session ID */
  sessionId: string;
  /** Agent ID */
  agentId: string;
  /** When the session was created */
  createdAt: Date;
  /** When the session was last active */
  lastActiveAt: Date;
  /** Number of tasks executed */
  taskCount: number;
  /** Total tokens used */
  totalTokens: number;
  /** Whether the session is active */
  isActive: boolean;
}

/**
 * Model configuration based on tier
 */
export interface ModelConfig {
  /** Model name/ID */
  modelName: string;
  /** Max output tokens */
  maxOutputTokens: number;
  /** Default temperature */
  temperature: number;
  /** Whether thinking/reasoning is enabled */
  thinkingEnabled: boolean;
}

/**
 * Provider type for model resolution
 */
export type ProviderType = 'gemini' | 'openai-compatible' | 'ollama' | 'openrouter';

/**
 * Provider-specific model mappings
 */
export const PROVIDER_MODEL_MAPPINGS: Record<ProviderType, Record<ModelTier, string>> = {
  gemini: {
    flash: 'gemini-2.5-flash',
    pro: 'gemini-2.5-pro',
    ultra: 'gemini-2.5-pro',
  },
  'openai-compatible': {
    flash: 'glm-4-flash',
    pro: 'glm-4.7',
    ultra: 'glm-4.7',
  },
  ollama: {
    flash: 'llama3.2',
    pro: 'llama3.1',
    ultra: 'mixtral',
  },
  openrouter: {
    flash: 'google/gemini-2.5-flash',
    pro: 'anthropic/claude-3.5-sonnet',
    ultra: 'anthropic/claude-3.5-sonnet',
  },
};

/**
 * Default model tier configurations (without hardcoded model names)
 */
export const DEFAULT_TIER_SETTINGS: Record<ModelTier, Omit<ModelConfig, 'modelName'>> = {
  flash: {
    maxOutputTokens: 8192,
    temperature: 0.7,
    thinkingEnabled: false,
  },
  pro: {
    maxOutputTokens: 16384,
    temperature: 0.7,
    thinkingEnabled: true,
  },
  ultra: {
    maxOutputTokens: 32768,
    temperature: 0.5,
    thinkingEnabled: true,
  },
};

/**
 * Detect provider type from environment variables
 */
export function detectProviderType(): ProviderType {
  const baseUrl = process.env['OPENAI_COMPATIBLE_BASE_URL'] || process.env['OPENROUTER_BASE_URL'] || '';

  if (baseUrl.includes('openrouter.ai')) {
    return 'openrouter';
  }
  if (baseUrl.includes('localhost:11434') || baseUrl.includes('ollama')) {
    return 'ollama';
  }
  if (baseUrl) {
    return 'openai-compatible';
  }
  return 'gemini';
}

/**
 * Get model configuration for a specific tier, respecting the current provider
 */
export function getModelConfigForTier(
  tier: ModelTier,
  providerOverride?: ProviderType,
  modelOverride?: string,
): ModelConfig {
  const provider = providerOverride ?? detectProviderType();
  const tierSettings = DEFAULT_TIER_SETTINGS[tier];

  // Allow explicit model override from environment or config
  const envModel = process.env['OPENAI_COMPATIBLE_MODEL'];
  const modelName = modelOverride ?? envModel ?? PROVIDER_MODEL_MAPPINGS[provider][tier];

  return {
    modelName,
    ...tierSettings,
  };
}

/**
 * Legacy: Model tier configurations (for backward compatibility)
 * @deprecated Use getModelConfigForTier() instead for multi-provider support
 */
export const MODEL_TIER_CONFIGS: Record<ModelTier, ModelConfig> = {
  flash: getModelConfigForTier('flash'),
  pro: getModelConfigForTier('pro'),
  ultra: getModelConfigForTier('ultra'),
};

/**
 * Events emitted by agent sessions
 */
export type AgentSessionEvent =
  | { type: 'session_created'; sessionId: string; agentId: string }
  | { type: 'task_started'; sessionId: string; task: string }
  | { type: 'task_completed'; sessionId: string; result: AgentTaskResult }
  | { type: 'tool_called'; sessionId: string; toolCall: AgentToolCall }
  | { type: 'session_closed'; sessionId: string };

/**
 * Callback for session events
 */
export type AgentSessionEventCallback = (event: AgentSessionEvent) => void;
