/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Planning Module
 * 3-Layer TODO and Context Management System
 *
 * Layer 1: Active Context (In-Memory) - TodoManager
 * Layer 2: Session Persistence (File-Based) - TodoPersistence
 * Layer 3: Long-Term Memory (Metrics & Patterns) - TodoMetrics, TaskPattern
 *
 * Inspired by Claude Code's TodoWrite system with multi-agent extensions
 * for the Gemini CLI's Enhanced Agent Orchestrator.
 */

// Types
export type {
  // Core todo types
  TodoStatus,
  TodoPriority,
  AgenticTodo,
  TodoContext,
  CodeReference,
  TodoTimestamps,
  TodoResult,
  // Session types
  TodoSession,
  SessionContext,
  SessionDecision,
  CompactionInfo,
  ArchivedTodoSummary,
  // Metrics & patterns (Layer 3)
  TodoMetrics,
  TaskPattern,
  // Configuration
  TodoManagerConfig,
  CompactionConfig,
  // Events
  TodoEvent,
  TodoEventHandler,
  // Utility types
  CreateTodoOptions,
  UpdateTodoOptions,
  TodoFilter,
  TodoSort,
  TodoSummary,
} from './types.js';

// Default configuration
export { DEFAULT_TODO_CONFIG } from './types.js';

// TodoManager (Layer 1 + coordination)
export {
  TodoManager,
  createTodoManager,
  type CompactionStatus,
} from './todo-manager.js';

// Persistence (Layer 2)
export {
  TodoPersistence,
  createDefaultMetrics,
  updateMetricsWithTodo,
} from './todo-persistence.js';

// Context Manager
export {
  ContextManager,
  createContextManager,
  ContextImportance,
  type ContextSnapshot,
  type ContextInjection,
  type RatedContextItem,
} from './context-manager.js';

// Compaction Hooks
export {
  CompactionHooksManager,
  createCompactionHooksManager,
  // Hook factories
  createNotificationHook,
  createExportHook,
  createMinTaskPreservationHook,
  createCriticalTaskGuardHook,
  // Hook types
  type HookResult,
  type PreCompactHook,
  type PostCompactHook,
  type PreCompactContext,
  type PostCompactContext,
} from './hooks/compaction-hooks.js';

// Orchestrator Integration
export {
  OrchestratorPlanningBridge,
  createOrchestratorPlanningBridge,
  buildPlanningEnhancedPrompt,
  extractTodoOperationsFromOutput,
  type PlanningExecutionOptions,
  type PlanningExecutionReport,
} from './orchestrator-integration.js';

// ==========================================================================
// Convenience Factory
// ==========================================================================

import { TodoManager } from './todo-manager.js';
import { ContextManager } from './context-manager.js';
import { CompactionHooksManager } from './hooks/compaction-hooks.js';
import type { TodoManagerConfig } from './types.js';
import { DEFAULT_TODO_CONFIG } from './types.js';

/**
 * Complete planning system instance
 */
export interface PlanningSystem {
  /** Todo manager for task management */
  todoManager: TodoManager;
  /** Context manager for LLM context handling */
  contextManager: ContextManager;
  /** Compaction hooks manager for lifecycle events */
  hooksManager: CompactionHooksManager;
  /** Cleanup function */
  dispose: () => void;
}

/**
 * Create a complete planning system with all components
 */
export function createPlanningSystem(
  projectRoot: string,
  config: Partial<TodoManagerConfig> = {},
): PlanningSystem {
  const mergedConfig = { ...DEFAULT_TODO_CONFIG, ...config };

  const todoManager = new TodoManager(projectRoot, mergedConfig);
  const contextManager = new ContextManager(
    todoManager,
    mergedConfig.compaction,
  );
  const hooksManager = new CompactionHooksManager(
    todoManager,
    contextManager,
    mergedConfig.compaction,
  );

  return {
    todoManager,
    contextManager,
    hooksManager,
    dispose: () => {
      todoManager.dispose();
    },
  };
}
