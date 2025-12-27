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
 * Model tier configurations
 */
export const MODEL_TIER_CONFIGS: Record<ModelTier, ModelConfig> = {
  flash: {
    modelName: 'gemini-2.0-flash',
    maxOutputTokens: 8192,
    temperature: 0.7,
    thinkingEnabled: false,
  },
  pro: {
    modelName: 'gemini-2.5-pro-preview-06-05',
    maxOutputTokens: 16384,
    temperature: 0.7,
    thinkingEnabled: true,
  },
  ultra: {
    modelName: 'gemini-2.5-pro-preview-06-05',
    maxOutputTokens: 32768,
    temperature: 0.5,
    thinkingEnabled: true,
  },
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
