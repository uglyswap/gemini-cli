/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Planning System Types
 * Types for the 3-layer TODO and context management system
 */

import type { TrustLevel } from '../trust/types.js';

// =============================================================================
// LAYER 1: Active Context (In-Memory)
// =============================================================================

/**
 * Todo item status
 * Use as enum for iteration: Object.values(TodoStatus)
 */
export enum TodoStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
}

/**
 * Helper to get all TodoStatus values for iteration
 */
export const TODO_STATUS_VALUES = Object.values(TodoStatus) as TodoStatus[];

/**
 * Type guard to check if a string is a valid TodoStatus
 */
export function isValidTodoStatus(value: unknown): value is TodoStatus {
  return (
    typeof value === 'string' &&
    (TODO_STATUS_VALUES as string[]).includes(value)
  );
}

/**
 * Todo priority levels (1-10, higher = more important)
 */
export type TodoPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Core todo item structure
 * Inspired by Claude Code's TodoWrite system with multi-agent extensions
 */
export interface AgenticTodo {
  /** Unique identifier */
  id: string;

  /** Task description in imperative form: "Fix authentication bug" */
  content: string;

  /** Task description in present continuous: "Fixing authentication bug" */
  activeForm: string;

  /** Current status */
  status: TodoStatus;

  /** Priority level (1-10) */
  priority: TodoPriority;

  // Multi-agent extensions
  /** Agent assigned to this task */
  assignedAgentId?: string;

  /** Minimum trust level required to execute */
  trustLevelRequired?: TrustLevel;

  /** Quality gates that must pass */
  qualityGatesRequired?: string[];

  /** Snapshot created before task execution */
  snapshotIdBefore?: string;

  /** Snapshot created after task completion */
  snapshotIdAfter?: string;

  // Dependencies & hierarchy
  /** IDs of tasks that must complete before this one */
  dependencies: string[];

  /** Subtasks for complex operations */
  subtasks?: AgenticTodo[];

  /** Parent task ID if this is a subtask */
  parentTaskId?: string;

  // Context preservation
  /** Contextual information for resumption */
  context: TodoContext;

  // Timestamps
  /** Timestamp information */
  timestamps: TodoTimestamps;

  // Execution metadata
  /** Execution result if completed */
  result?: TodoResult;
}

/**
 * Contextual information preserved with each todo
 */
export interface TodoContext {
  /** Files involved in this task */
  filesInvolved: string[];

  /** Key decisions made during execution */
  decisionsMade: string[];

  /** Current blockers if status is 'blocked' */
  blockers?: string[];

  /** Relevant code snippets or references */
  codeReferences?: CodeReference[];

  /** User-provided notes */
  notes?: string;

  /** Tags for categorization */
  tags?: string[];
}

/**
 * Code reference for context preservation
 */
export interface CodeReference {
  /** File path */
  filePath: string;

  /** Line number or range */
  lineNumber?: number;

  /** End line for ranges */
  lineEnd?: number;

  /** Brief description */
  description?: string;
}

/**
 * Timestamps for todo lifecycle tracking
 */
export interface TodoTimestamps {
  /** When the todo was created */
  created: string;

  /** When work started (status changed to in_progress) */
  started?: string;

  /** When the todo was completed */
  completed?: string;

  /** Last update timestamp */
  lastUpdated: string;

  /** Estimated completion time (ISO duration) */
  estimatedDuration?: string;
}

/**
 * Result of todo execution
 */
export interface TodoResult {
  /** Whether the task succeeded */
  success: boolean;

  /** Output or summary */
  output?: string;

  /** Error message if failed */
  error?: string;

  /** Quality score (0-100) */
  qualityScore?: number;

  /**
   * Files that were modified
   * @deprecated Use a consistent naming convention. Prefer `modifiedFiles` in new code.
   */
  filesModified?: string[];

  /** Duration in milliseconds */
  durationMs?: number;
}

// =============================================================================
// LAYER 2: Session Persistence (File-Based)
// =============================================================================

/**
 * Session state persisted to disk
 */
export interface TodoSession {
  /** Session identifier */
  sessionId: string;

  /** Session version for migrations */
  version: string;

  /** When the session started */
  startedAt: string;

  /** Last activity timestamp */
  lastActivityAt: string;

  /** Active todos in this session */
  todos: AgenticTodo[];

  /** Session-level context */
  sessionContext: SessionContext;

  /** Compaction metadata */
  compactionInfo?: CompactionInfo;
}

/**
 * Session-level context information
 */
export interface SessionContext {
  /** High-level task description */
  taskDescription: string;

  /** Project root directory */
  projectRoot: string;

  /** Key decisions made during session */
  keyDecisions: SessionDecision[];

  /** Summary of completed work */
  completedWorkSummary?: string;

  /** Current focus area */
  currentFocus?: string;

  /** Important variables or values to remember */
  importantValues?: Record<string, string>;
}

/**
 * A decision recorded during the session
 */
export interface SessionDecision {
  /** When the decision was made */
  timestamp: string;

  /** What was decided */
  decision: string;

  /** Why this decision was made */
  rationale: string;

  /** Alternatives that were considered */
  alternatives?: string[];

  /** Related todo ID */
  relatedTodoId?: string;
}

/**
 * Information about context compaction
 */
export interface CompactionInfo {
  /** Number of compactions performed */
  compactionCount: number;

  /** Last compaction timestamp */
  lastCompactionAt?: string;

  /** Tokens before last compaction */
  tokensBeforeLastCompaction?: number;

  /** Tokens after last compaction */
  tokensAfterLastCompaction?: number;

  /** Items archived during compaction */
  archivedItems: ArchivedTodoSummary[];
}

/**
 * Summary of an archived todo
 */
export interface ArchivedTodoSummary {
  /** Original todo ID */
  todoId: string;

  /** Brief content summary */
  contentSummary: string;

  /** Final status */
  finalStatus: TodoStatus;

  /** When it was archived */
  archivedAt: string;
}

// =============================================================================
// LAYER 3: Long-Term Memory (Optional)
// =============================================================================

/**
 * Cross-session metrics
 */
export interface TodoMetrics {
  /** Total todos created across all sessions */
  totalCreated: number;

  /** Total todos completed */
  totalCompleted: number;

  /** Total todos that failed or were blocked */
  totalFailed: number;

  /** Average completion time in ms */
  averageCompletionTimeMs: number;

  /** Completion rate (0-1) */
  completionRate: number;

  /** Most common tags */
  topTags: Array<{ tag: string; count: number }>;

  /** Agent performance summary */
  agentPerformance: Record<
    string,
    {
      assigned: number;
      completed: number;
      avgQualityScore: number;
    }
  >;

  /** Last updated */
  lastUpdated: string;
}

/**
 * Historical pattern for learning
 */
export interface TaskPattern {
  /** Pattern identifier */
  id: string;

  /** Pattern description */
  description: string;

  /** Keywords that trigger this pattern */
  triggerKeywords: string[];

  /** Suggested subtask breakdown */
  suggestedSubtasks: string[];

  /** Recommended agents */
  recommendedAgents: string[];

  /** Average duration for similar tasks */
  avgDurationMs: number;

  /** Success rate for this pattern */
  successRate: number;

  /** Number of times this pattern was observed */
  occurrences: number;
}

// =============================================================================
// Manager Configuration & Events
// =============================================================================

/**
 * Configuration for TodoManager
 */
export interface TodoManagerConfig {
  /** Directory for persistence (relative to project root) */
  storageDir: string;

  /** Maximum todos per session before warning */
  maxTodosPerSession: number;

  /** Maximum history sessions to keep */
  maxHistorySessions: number;

  /** Auto-save interval in milliseconds */
  autoSaveIntervalMs: number;

  /** Enable metrics collection */
  enableMetrics: boolean;

  /** Enable pattern learning */
  enablePatternLearning: boolean;

  /** Maximum tokens allocated for planning context (~20% of typical 100k context window) */
  maxPlanningTokens: number;

  /** Context compaction settings */
  compaction: CompactionConfig;
}

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /** Enable auto-compaction */
  enabled: boolean;

  /** Threshold for warning (percentage of context used) */
  warningThreshold: number;

  /** Threshold for compaction trigger */
  compactionThreshold: number;

  /** Maximum completed todos before auto-archive */
  maxCompletedBeforeArchive: number;

  /** Preserve last N decisions */
  preserveLastNDecisions: number;
}

/**
 * Events emitted by TodoManager
 */
export type TodoEvent =
  | { type: 'todo_created'; todo: AgenticTodo }
  | { type: 'todo_updated'; todo: AgenticTodo; previousStatus: TodoStatus }
  | { type: 'todo_completed'; todo: AgenticTodo }
  | { type: 'todo_blocked'; todo: AgenticTodo; blockers: string[] }
  | { type: 'session_saved'; sessionId: string }
  | { type: 'session_loaded'; sessionId: string }
  | { type: 'compaction_triggered'; reason: string }
  | { type: 'compaction_completed'; archivedCount: number }
  | { type: 'decision_recorded'; decision: SessionDecision };

/**
 * Event handler type
 */
export type TodoEventHandler = (event: TodoEvent) => void;

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Options for creating a new todo
 */
export interface CreateTodoOptions {
  content: string;
  activeForm?: string;
  priority?: TodoPriority;
  assignedAgentId?: string;
  trustLevelRequired?: TrustLevel;
  qualityGatesRequired?: string[];
  dependencies?: string[];
  parentTaskId?: string;
  tags?: string[];
  notes?: string;
}

/**
 * Options for updating a todo
 */
export interface UpdateTodoOptions {
  status?: TodoStatus;
  priority?: TodoPriority;
  assignedAgentId?: string;
  blockers?: string[];
  notes?: string;
  result?: TodoResult;
}

/**
 * Filter options for querying todos
 */
export interface TodoFilter {
  status?: TodoStatus | TodoStatus[];
  assignedAgentId?: string;
  priority?: TodoPriority | { min?: TodoPriority; max?: TodoPriority };
  tags?: string[];
  hasBlockers?: boolean;
  parentTaskId?: string | null;
}

/**
 * Sort options for todos
 */
export interface TodoSort {
  field: 'priority' | 'created' | 'lastUpdated' | 'status';
  direction: 'asc' | 'desc';
}

/**
 * Summary statistics for current session
 */
export interface TodoSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  completionRate: number;
  averagePriority: number;
  topAgents: Array<{ agentId: string; count: number }>;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_TODO_CONFIG: TodoManagerConfig = {
  storageDir: '.gemini/planning',
  maxTodosPerSession: 100,
  maxHistorySessions: 50,
  autoSaveIntervalMs: 30000, // 30 seconds
  enableMetrics: true,
  enablePatternLearning: false, // Disabled by default, can be resource intensive
  maxPlanningTokens: 20000, // ~20% of typical 100k context window
  compaction: {
    enabled: true,
    warningThreshold: 0.8, // 80%
    compactionThreshold: 0.95, // 95%
    maxCompletedBeforeArchive: 20,
    preserveLastNDecisions: 10,
  },
};
