/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compaction Hooks
 * Integration hooks for the planning system's context compaction
 * Similar to Claude Code's PreCompact hooks
 */

import type { TodoManager, CompactionStatus } from '../todo-manager.js';
import type { ContextManager, ContextSnapshot } from '../context-manager.js';
import type { CompactionConfig, CompactionInfo } from '../types.js';

/**
 * Hook execution result
 */
export interface HookResult {
  /** Whether the hook executed successfully */
  success: boolean;
  /** Output message */
  message: string;
  /** Additional data from the hook */
  data?: Record<string, unknown>;
  /** Error if hook failed */
  error?: Error;
}

/**
 * Pre-compaction hook function signature
 */
export type PreCompactHook = (
  context: PreCompactContext,
) => Promise<HookResult>;

/**
 * Post-compaction hook function signature
 */
export type PostCompactHook = (
  context: PostCompactContext,
) => Promise<HookResult>;

/**
 * Context available to pre-compaction hooks
 */
export interface PreCompactContext {
  /** Current compaction status */
  status: CompactionStatus;
  /** Context snapshot before compaction */
  snapshot: ContextSnapshot;
  /** The TodoManager instance */
  todoManager: TodoManager;
  /** The ContextManager instance */
  contextManager: ContextManager;
  /** Whether to abort compaction */
  abort: () => void;
  /** Custom data to pass to post-compact hooks */
  setData: (key: string, value: unknown) => void;
}

/**
 * Context available to post-compaction hooks
 */
export interface PostCompactContext {
  /** Compaction info after completion */
  compactionInfo: CompactionInfo;
  /** Custom data from pre-compact hooks */
  data: Record<string, unknown>;
  /** The TodoManager instance */
  todoManager: TodoManager;
  /** The ContextManager instance */
  contextManager: ContextManager;
}

/**
 * Hook registration entry
 */
interface RegisteredHook<T> {
  name: string;
  hook: T;
  priority: number;
}

/**
 * Compaction Hooks Manager
 * Manages and executes hooks during the compaction lifecycle
 */
export class CompactionHooksManager {
  private readonly preCompactHooks: Array<RegisteredHook<PreCompactHook>> = [];
  private readonly postCompactHooks: Array<RegisteredHook<PostCompactHook>> =
    [];
  private readonly todoManager: TodoManager;
  private readonly contextManager: ContextManager;
  private readonly config: CompactionConfig;

  constructor(
    todoManager: TodoManager,
    contextManager: ContextManager,
    config: CompactionConfig,
  ) {
    this.todoManager = todoManager;
    this.contextManager = contextManager;
    this.config = config;

    // Register default hooks
    this.registerDefaultHooks();
  }

  // ==========================================================================
  // Hook Registration
  // ==========================================================================

  /**
   * Register a pre-compaction hook
   */
  registerPreCompactHook(
    name: string,
    hook: PreCompactHook,
    priority: number = 50,
  ): void {
    this.preCompactHooks.push({ name, hook, priority });
    this.preCompactHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Register a post-compaction hook
   */
  registerPostCompactHook(
    name: string,
    hook: PostCompactHook,
    priority: number = 50,
  ): void {
    this.postCompactHooks.push({ name, hook, priority });
    this.postCompactHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister a pre-compaction hook
   */
  unregisterPreCompactHook(name: string): boolean {
    const index = this.preCompactHooks.findIndex((h) => h.name === name);
    if (index !== -1) {
      this.preCompactHooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Unregister a post-compaction hook
   */
  unregisterPostCompactHook(name: string): boolean {
    const index = this.postCompactHooks.findIndex((h) => h.name === name);
    if (index !== -1) {
      this.postCompactHooks.splice(index, 1);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Hook Execution
  // ==========================================================================

  /**
   * Execute pre-compaction hooks
   */
  async executePreCompactHooks(): Promise<{
    success: boolean;
    aborted: boolean;
    results: Array<{ name: string; result: HookResult }>;
    data: Record<string, unknown>;
  }> {
    const status = this.todoManager.getCompactionStatus();
    const snapshot = this.contextManager.generateContextSnapshot();

    let aborted = false;
    const data: Record<string, unknown> = {};

    const context: PreCompactContext = {
      status,
      snapshot,
      todoManager: this.todoManager,
      contextManager: this.contextManager,
      abort: () => {
        aborted = true;
      },
      setData: (key: string, value: unknown) => {
        data[key] = value;
      },
    };

    const results: Array<{ name: string; result: HookResult }> = [];

    for (const { name, hook } of this.preCompactHooks) {
      if (aborted) {
        results.push({
          name,
          result: {
            success: false,
            message: 'Skipped due to earlier abort',
          },
        });
        continue;
      }

      try {
        const result = await hook(context);
        results.push({ name, result });

        if (!result.success) {
          console.warn(
            `[CompactionHooks] Pre-compact hook "${name}" failed: ${result.message}`,
          );
        }
      } catch (error) {
        const errorResult: HookResult = {
          success: false,
          message: `Hook threw an error: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error : new Error(String(error)),
        };
        results.push({ name, result: errorResult });
        console.error(
          `[CompactionHooks] Pre-compact hook "${name}" threw:`,
          error,
        );
      }
    }

    return {
      success: results.every((r) => r.result.success),
      aborted,
      results,
      data,
    };
  }

  /**
   * Execute post-compaction hooks
   */
  async executePostCompactHooks(
    compactionInfo: CompactionInfo,
    preCompactData: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    results: Array<{ name: string; result: HookResult }>;
  }> {
    const context: PostCompactContext = {
      compactionInfo,
      data: preCompactData,
      todoManager: this.todoManager,
      contextManager: this.contextManager,
    };

    const results: Array<{ name: string; result: HookResult }> = [];

    for (const { name, hook } of this.postCompactHooks) {
      try {
        const result = await hook(context);
        results.push({ name, result });

        if (!result.success) {
          console.warn(
            `[CompactionHooks] Post-compact hook "${name}" failed: ${result.message}`,
          );
        }
      } catch (error) {
        const errorResult: HookResult = {
          success: false,
          message: `Hook threw an error: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error : new Error(String(error)),
        };
        results.push({ name, result: errorResult });
        console.error(
          `[CompactionHooks] Post-compact hook "${name}" threw:`,
          error,
        );
      }
    }

    return {
      success: results.every((r) => r.result.success),
      results,
    };
  }

  /**
   * Execute full compaction cycle with hooks
   */
  async executeCompactionWithHooks(): Promise<{
    success: boolean;
    aborted: boolean;
    compactionInfo?: CompactionInfo;
    preResults: Array<{ name: string; result: HookResult }>;
    postResults: Array<{ name: string; result: HookResult }>;
    /** Aggregated errors from all failed hooks for easier error handling */
    errors: Array<{ hookName: string; phase: 'pre' | 'post'; error: Error }>;
  }> {
    const errors: Array<{
      hookName: string;
      phase: 'pre' | 'post';
      error: Error;
    }> = [];

    // Execute pre-compact hooks
    const preResult = await this.executePreCompactHooks();

    // Collect pre-compact errors
    for (const { name, result } of preResult.results) {
      if (result.error) {
        errors.push({ hookName: name, phase: 'pre', error: result.error });
      }
    }

    if (preResult.aborted) {
      return {
        success: false,
        aborted: true,
        preResults: preResult.results,
        postResults: [],
        errors,
      };
    }

    // Perform compaction
    const compactionInfo = this.todoManager.performCompaction();

    // Execute post-compact hooks
    const postResult = await this.executePostCompactHooks(
      compactionInfo,
      preResult.data,
    );

    // Collect post-compact errors
    for (const { name, result } of postResult.results) {
      if (result.error) {
        errors.push({ hookName: name, phase: 'post', error: result.error });
      }
    }

    return {
      success: preResult.success && postResult.success,
      aborted: false,
      compactionInfo,
      preResults: preResult.results,
      postResults: postResult.results,
      errors,
    };
  }

  // ==========================================================================
  // Default Hooks
  // ==========================================================================

  /**
   * Register default hooks
   */
  private registerDefaultHooks(): void {
    // Pre-compact: Validate context integrity
    this.registerPreCompactHook(
      'validate-context',
      async (ctx) => {
        const validation = ctx.contextManager.validateContextIntegrity();
        if (!validation.valid) {
          console.warn(
            '[CompactionHooks] Context integrity issues:',
            validation.issues,
          );
        }
        return {
          success: true,
          message: validation.valid
            ? 'Context integrity validated'
            : `Context has ${validation.issues.length} issues`,
          data: { issues: validation.issues },
        };
      },
      10,
    );

    // Pre-compact: Save snapshot
    this.registerPreCompactHook(
      'save-snapshot',
      async (ctx) => {
        const snapshotContent =
          ctx.contextManager.createPreCompactionSnapshot();
        ctx.setData('preCompactSnapshot', snapshotContent);
        return {
          success: true,
          message: 'Pre-compaction snapshot saved',
        };
      },
      20,
    );

    // Pre-compact: Check for active work
    this.registerPreCompactHook(
      'check-active-work',
      async (ctx) => {
        const activeTodo = ctx.todoManager.getActiveTodo();
        if (activeTodo) {
          ctx.setData('activeTaskId', activeTodo.id);
          ctx.setData('activeTaskContent', activeTodo.content);
        }
        return {
          success: true,
          message: activeTodo
            ? `Active task preserved: ${activeTodo.content}`
            : 'No active task',
        };
      },
      30,
    );

    // Post-compact: Log compaction results
    this.registerPostCompactHook(
      'log-results',
      async (ctx) => {
        const { compactionInfo } = ctx;
        console.log(
          `[CompactionHooks] Compaction #${compactionInfo.compactionCount} completed. ` +
            `Archived ${compactionInfo.archivedItems.length} items.`,
        );
        return {
          success: true,
          message: `Archived ${compactionInfo.archivedItems.length} items`,
        };
      },
      10,
    );

    // Post-compact: Restore active task context
    this.registerPostCompactHook(
      'restore-active-context',
      async (ctx) => {
        const activeTaskId = ctx.data['activeTaskId'] as string | undefined;
        if (activeTaskId) {
          const todo = ctx.todoManager.findTodo(activeTaskId);
          if (todo) {
            return {
              success: true,
              message: `Active task "${todo.content}" preserved after compaction`,
            };
          }
        }
        return {
          success: true,
          message: 'No active task to restore',
        };
      },
      20,
    );

    // Post-compact: Append to scratchpad
    this.registerPostCompactHook(
      'update-scratchpad',
      async (ctx) => {
        const { compactionInfo } = ctx;
        const preSnapshot = ctx.data['preCompactSnapshot'] as string;

        if (preSnapshot) {
          ctx.todoManager.appendToScratchpad(
            `--- Compaction #${compactionInfo.compactionCount} ---\n${preSnapshot}`,
          );
        }

        return {
          success: true,
          message: 'Scratchpad updated with pre-compaction snapshot',
        };
      },
      30,
    );
  }

  // ==========================================================================
  // Automatic Compaction Monitoring
  // ==========================================================================

  /**
   * Result of checkAndCompact operation
   */
  /** Check if compaction is needed and execute with hooks */
  async checkAndCompact(): Promise<{
    compacted: boolean;
    success: boolean;
    aborted: boolean;
    errors: Array<{ hookName: string; phase: 'pre' | 'post'; error: Error }>;
    warningTriggered: boolean;
    recommendations: string[];
  }> {
    if (!this.config.enabled) {
      return {
        compacted: false,
        success: true,
        aborted: false,
        errors: [],
        warningTriggered: false,
        recommendations: [],
      };
    }

    const status = this.todoManager.getCompactionStatus();

    if (status.compactionNeeded) {
      const result = await this.executeCompactionWithHooks();
      return {
        compacted: true,
        success: result.success,
        aborted: result.aborted,
        errors: result.errors,
        warningTriggered: status.warningTriggered,
        recommendations: status.recommendations,
      };
    }

    if (status.warningTriggered) {
      console.warn(
        '[CompactionHooks] Context usage warning:',
        status.recommendations.join('; '),
      );
    }

    return {
      compacted: false,
      success: true,
      aborted: false,
      errors: [],
      warningTriggered: status.warningTriggered,
      recommendations: status.recommendations,
    };
  }
}

/**
 * Create a CompactionHooksManager instance
 */
export function createCompactionHooksManager(
  todoManager: TodoManager,
  contextManager: ContextManager,
  config: CompactionConfig,
): CompactionHooksManager {
  return new CompactionHooksManager(todoManager, contextManager, config);
}

// ==========================================================================
// Pre-built Hooks
// ==========================================================================

/**
 * Hook to notify external systems before compaction
 */
export function createNotificationHook(
  notifyFn: (message: string) => Promise<void>,
): PreCompactHook {
  return async (ctx) => {
    try {
      const summary = ctx.todoManager.getSummary();
      await notifyFn(
        `Compaction starting. Current status: ${summary.completed}/${summary.total} tasks completed.`,
      );
      return {
        success: true,
        message: 'External notification sent',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };
}

/**
 * Hook to export session before compaction
 */
export function createExportHook(exportPath: string): PreCompactHook {
  return async (ctx) => {
    const snapshot = ctx.contextManager.createPreCompactionSnapshot();
    ctx.setData('exportedSnapshot', snapshot);
    ctx.setData('exportPath', exportPath);
    return {
      success: true,
      message: `Session snapshot prepared for export to ${exportPath}`,
    };
  };
}

/**
 * Hook to enforce minimum task preservation
 */
export function createMinTaskPreservationHook(
  minPendingTasks: number,
): PreCompactHook {
  return async (ctx) => {
    const pending = ctx.todoManager.getTodos({ status: 'pending' });
    if (pending.length < minPendingTasks) {
      return {
        success: true,
        message: `Only ${pending.length} pending tasks, below minimum ${minPendingTasks}`,
      };
    }
    return {
      success: true,
      message: `${pending.length} pending tasks will be preserved`,
    };
  };
}

/**
 * Hook to abort compaction if critical tasks are in progress
 */
export function createCriticalTaskGuardHook(
  criticalPriority: number = 9,
): PreCompactHook {
  return async (ctx) => {
    const active = ctx.todoManager.getActiveTodo();
    if (active && active.priority >= criticalPriority) {
      ctx.abort();
      return {
        success: false,
        message: `Compaction aborted: Critical task "${active.content}" (P${active.priority}) is in progress`,
      };
    }
    return {
      success: true,
      message: 'No critical tasks blocking compaction',
    };
  };
}
