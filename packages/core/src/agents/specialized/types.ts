/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Specialized Agent Types
 * Defines agent specializations for the multi-agent orchestration system
 */

/**
 * Domain categories for agent specialization
 */
export type AgentDomain =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'security'
  | 'testing'
  | 'devops'
  | 'ai-ml'
  | 'documentation'
  | 'general';

/**
 * Model tier for cost/capability tradeoffs
 */
export type ModelTier = 'flash' | 'pro' | 'ultra';

/**
 * Task complexity levels
 */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

/**
 * Quality check types
 */
export type QualityCheck =
  | 'typescript'
  | 'eslint'
  | 'prettier'
  | 'accessibility'
  | 'visual-regression'
  | 'responsive'
  | 'api-contract'
  | 'security-scan'
  | 'secrets-detection'
  | 'dependency-audit'
  | 'migration-safety'
  | 'rls-coverage'
  | 'index-analysis'
  | 'test-coverage'
  | 'test-quality'
  | 'complexity-analysis'
  | 'duplication-detection'
  | 'performance-audit'
  | 'bundle-analysis'
  | 'documentation-coverage';

/**
 * Tool identifiers available to agents
 * These must match the actual tool names registered in tool-registry
 * @see packages/core/src/tools/tool-names.ts for authoritative list
 */
export type ToolId =
  | 'read_file'
  | 'write_file'
  | 'replace'
  | 'glob'
  | 'search_file_content'
  | 'run_shell_command'
  | 'web_fetch'
  | 'google_web_search'
  | 'save_memory'
  | 'list_directory';

/**
 * Specialized agent definition
 */
export interface AgentSpecialization {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Domain category */
  domain: AgentDomain;
  /** Model tier for cost/capability tradeoff */
  modelTier: ModelTier;
  /** Keywords that trigger this agent */
  triggerKeywords: string[];
  /** System prompt for this agent */
  systemPrompt: string;
  /** Tools this agent can use */
  tools: ToolId[];
  /** Quality checks specific to this agent */
  qualityChecks: QualityCheck[];
  /** Maximum files this agent should modify per task */
  maxFilesPerTask: number;
  /** Whether this agent can spawn sub-agents */
  canSpawnSubAgents: boolean;
  /** Priority weight for agent selection (higher = more likely) */
  priority: number;
  /** Agent IDs that must run before this agent (optional dependencies) */
  dependencies?: string[];
}

/**
 * Alias for AgentSpecialization (for backward compatibility)
 */
export type SpecializedAgent = AgentSpecialization;

/**
 * Agent selection result
 */
export interface AgentSelectionResult {
  /** Selected agents in execution order */
  agents: AgentSpecialization[];
  /** Task complexity assessment */
  complexity: TaskComplexity;
  /** Selection scores for each agent */
  scores: Map<string, number>;
  /** Reasoning for selection */
  reasoning: string;
}

/**
 * Agent execution context passed between agents
 */
export interface AgentContext {
  /** Original task description */
  originalTask: string;
  /** Current subtask (if decomposed) */
  currentSubtask?: string;
  /** Context from previous agent */
  previousContext?: string;
  /** Files modified so far */
  modifiedFiles: string[];
  /** Files read so far */
  readFiles: string[];
  /** Errors encountered */
  errors: string[];
  /** Warnings */
  warnings: string[];
  /** Custom metadata */
  metadata: Record<string, unknown>;
}
