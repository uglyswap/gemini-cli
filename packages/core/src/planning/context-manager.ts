/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Context Manager
 * Handles context-aware operations for the planning system
 * Manages context window usage, summarization, and preservation
 */

import type { AgenticTodo, CompactionConfig } from './types.js';
import type { TodoManager } from './todo-manager.js';

/**
 * Context snapshot for preservation during compaction
 */
export interface ContextSnapshot {
  /** Snapshot timestamp */
  timestamp: string;
  /** Active task summary */
  activeTaskSummary: string;
  /** Pending tasks overview */
  pendingTasksOverview: string;
  /** Critical decisions */
  criticalDecisions: string[];
  /** Files currently being worked on */
  activeFiles: string[];
  /** Important values to preserve */
  importantValues: Record<string, string>;
  /** Blockers summary */
  blockersSummary: string;
}

/**
 * Context injection payload for LLM prompts
 */
export interface ContextInjection {
  /** XML-formatted context for system prompt injection */
  systemContext: string;
  /** Markdown-formatted context for human-readable display */
  humanReadable: string;
  /** Token estimate for the context */
  estimatedTokens: number;
}

/**
 * Context importance levels for prioritization
 */
export enum ContextImportance {
  CRITICAL = 'critical', // Must always be preserved
  HIGH = 'high', // Preserve unless compaction is urgent
  MEDIUM = 'medium', // Can be summarized
  LOW = 'low', // Can be dropped
}

/**
 * Context item with importance rating
 */
export interface RatedContextItem {
  type: 'todo' | 'decision' | 'file' | 'value';
  id: string;
  content: string;
  importance: ContextImportance;
  tokens: number;
}

/**
 * Context Manager
 * Orchestrates context preservation, summarization, and injection
 */
export class ContextManager {
  private readonly todoManager: TodoManager;
  private readonly compactionConfig: CompactionConfig;

  constructor(todoManager: TodoManager, compactionConfig: CompactionConfig) {
    this.todoManager = todoManager;
    this.compactionConfig = compactionConfig;
  }

  // ==========================================================================
  // Context Generation
  // ==========================================================================

  /**
   * Generate context injection for LLM prompts
   */
  generateContextInjection(maxTokens: number = 4000): ContextInjection {
    const items = this.gatherRatedContextItems();
    const selected = this.selectItemsWithinBudget(items, maxTokens);

    const systemContext = this.formatAsXml(selected);
    const humanReadable = this.formatAsMarkdown(selected);
    const estimatedTokens = selected.reduce(
      (sum, item) => sum + item.tokens,
      0,
    );

    return {
      systemContext,
      humanReadable,
      estimatedTokens,
    };
  }

  /**
   * Generate a minimal context reminder
   */
  generateMinimalReminder(): string {
    const active = this.todoManager.getActiveTodo();
    const summary = this.todoManager.getSummary();

    let reminder = '<planning-context>\n';

    if (active) {
      reminder += `<current-task>${active.activeForm}</current-task>\n`;
    }

    reminder += `<progress total="${summary.total}" completed="${summary.completed}" pending="${summary.pending}" blocked="${summary.blocked}" />\n`;

    const next = this.todoManager.getNextTodo();
    if (next && !active) {
      reminder += `<next-task>${next.content}</next-task>\n`;
    }

    reminder += '</planning-context>';

    return reminder;
  }

  /**
   * Generate full context snapshot for preservation
   */
  generateContextSnapshot(): ContextSnapshot {
    const active = this.todoManager.getActiveTodo();
    const pending = this.todoManager.getTodos({ status: 'pending' });
    const blocked = this.todoManager.getTodos({ status: 'blocked' });
    const decisions = this.todoManager.getRecentDecisions(5);

    // Gather active files
    const activeFiles: string[] = [];
    if (active) {
      activeFiles.push(...active.context.filesInvolved);
    }
    for (const todo of pending.slice(0, 3)) {
      activeFiles.push(...todo.context.filesInvolved);
    }

    // Gather blockers
    const blockers: string[] = [];
    for (const todo of blocked) {
      if (todo.context.blockers) {
        blockers.push(`${todo.content}: ${todo.context.blockers.join(', ')}`);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      activeTaskSummary: active
        ? `${active.activeForm} (Priority: ${active.priority})`
        : 'No active task',
      pendingTasksOverview: pending
        .slice(0, 5)
        .map((t) => `[P${t.priority}] ${t.content}`)
        .join('; '),
      criticalDecisions: decisions.map((d) => d.decision),
      activeFiles: [...new Set(activeFiles)],
      importantValues:
        this.todoManager.getImportantValue('all') !== undefined
          ? { all: this.todoManager.getImportantValue('all')! }
          : {},
      blockersSummary:
        blockers.length > 0 ? blockers.join('\n') : 'No blockers',
    };
  }

  // ==========================================================================
  // Context Rating & Selection
  // ==========================================================================

  /**
   * Gather all context items with importance ratings
   */
  private gatherRatedContextItems(): RatedContextItem[] {
    const items: RatedContextItem[] = [];
    const todos = this.todoManager.getAllTodos();
    const decisions = this.todoManager.getRecentDecisions(20);

    // Rate todos
    for (const todo of todos) {
      const importance = this.rateTodoImportance(todo);
      const content = this.summarizeTodo(todo);
      const tokens = this.estimateTokens(content);

      items.push({
        type: 'todo',
        id: todo.id,
        content,
        importance,
        tokens,
      });
    }

    // Rate decisions
    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];
      // More recent decisions are more important
      const recency = i / decisions.length;
      const importance =
        recency > 0.7
          ? ContextImportance.CRITICAL
          : recency > 0.4
            ? ContextImportance.HIGH
            : ContextImportance.MEDIUM;

      const content = `Decision: ${decision.decision}\nRationale: ${decision.rationale}`;
      const tokens = this.estimateTokens(content);

      items.push({
        type: 'decision',
        id: `decision-${i}`,
        content,
        importance,
        tokens,
      });
    }

    return items;
  }

  /**
   * Rate the importance of a todo
   */
  private rateTodoImportance(todo: AgenticTodo): ContextImportance {
    // In-progress tasks are always critical
    if (todo.status === 'in_progress') {
      return ContextImportance.CRITICAL;
    }

    // Blocked tasks are high importance
    if (todo.status === 'blocked') {
      return ContextImportance.HIGH;
    }

    // High priority pending tasks
    if (todo.status === 'pending' && todo.priority >= 8) {
      return ContextImportance.HIGH;
    }

    // Medium priority pending tasks
    if (todo.status === 'pending' && todo.priority >= 5) {
      return ContextImportance.MEDIUM;
    }

    // Completed tasks are low importance (can be summarized)
    if (todo.status === 'completed') {
      return ContextImportance.LOW;
    }

    return ContextImportance.LOW;
  }

  /**
   * Select items within token budget
   */
  private selectItemsWithinBudget(
    items: RatedContextItem[],
    maxTokens: number,
  ): RatedContextItem[] {
    // Sort by importance (critical first) then by tokens (smaller first within same importance)
    const importanceOrder: Record<ContextImportance, number> = {
      [ContextImportance.CRITICAL]: 0,
      [ContextImportance.HIGH]: 1,
      [ContextImportance.MEDIUM]: 2,
      [ContextImportance.LOW]: 3,
    };

    const sorted = [...items].sort((a, b) => {
      const importanceDiff =
        importanceOrder[a.importance] - importanceOrder[b.importance];
      if (importanceDiff !== 0) return importanceDiff;
      return a.tokens - b.tokens;
    });

    const selected: RatedContextItem[] = [];
    let totalTokens = 0;

    for (const item of sorted) {
      if (totalTokens + item.tokens <= maxTokens) {
        selected.push(item);
        totalTokens += item.tokens;
      } else if (item.importance === ContextImportance.CRITICAL) {
        // Always include critical items, even if over budget
        selected.push(item);
        totalTokens += item.tokens;
      }
    }

    return selected;
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  /**
   * Format selected items as XML for system prompts
   */
  private formatAsXml(items: RatedContextItem[]): string {
    const todos = items.filter((i) => i.type === 'todo');
    const decisions = items.filter((i) => i.type === 'decision');

    let xml = '<planning-context>\n';

    if (todos.length > 0) {
      xml += '  <todos>\n';
      for (const todo of todos) {
        xml += `    <todo importance="${todo.importance}">\n`;
        xml += `      ${todo.content}\n`;
        xml += '    </todo>\n';
      }
      xml += '  </todos>\n';
    }

    if (decisions.length > 0) {
      xml += '  <recent-decisions>\n';
      for (const decision of decisions) {
        xml += `    <decision importance="${decision.importance}">\n`;
        xml += `      ${decision.content}\n`;
        xml += '    </decision>\n';
      }
      xml += '  </recent-decisions>\n';
    }

    xml += '</planning-context>';

    return xml;
  }

  /**
   * Format selected items as Markdown for human display
   */
  private formatAsMarkdown(items: RatedContextItem[]): string {
    const todos = items.filter((i) => i.type === 'todo');
    const decisions = items.filter((i) => i.type === 'decision');

    let md = '## Planning Context\n\n';

    if (todos.length > 0) {
      md += '### Tasks\n\n';
      for (const todo of todos) {
        const icon =
          todo.importance === ContextImportance.CRITICAL
            ? '🔴'
            : todo.importance === ContextImportance.HIGH
              ? '🟠'
              : todo.importance === ContextImportance.MEDIUM
                ? '🟡'
                : '⚪';
        md += `${icon} ${todo.content}\n`;
      }
      md += '\n';
    }

    if (decisions.length > 0) {
      md += '### Recent Decisions\n\n';
      for (const decision of decisions) {
        md += `- ${decision.content.split('\n')[0]}\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Summarize a todo for context inclusion
   */
  private summarizeTodo(todo: AgenticTodo): string {
    let summary = `[${todo.status.toUpperCase()}] ${todo.content}`;

    if (todo.assignedAgentId) {
      summary += ` (Agent: ${todo.assignedAgentId})`;
    }

    if (todo.status === 'blocked' && todo.context.blockers) {
      summary += ` | Blockers: ${todo.context.blockers.join(', ')}`;
    }

    if (todo.context.filesInvolved.length > 0) {
      summary += ` | Files: ${todo.context.filesInvolved.slice(0, 3).join(', ')}`;
    }

    return summary;
  }

  // ==========================================================================
  // Token Estimation
  // ==========================================================================

  /**
   * Estimate tokens for a string (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  // ==========================================================================
  // Pre-Compaction Snapshot
  // ==========================================================================

  /**
   * Create a pre-compaction snapshot that can be restored
   */
  createPreCompactionSnapshot(): string {
    const snapshot = this.generateContextSnapshot();
    const summary = this.todoManager.getSummary();

    let content = `# Pre-Compaction Snapshot\n\n`;
    content += `**Timestamp:** ${snapshot.timestamp}\n`;
    content += `**Progress:** ${summary.completed}/${summary.total} completed\n\n`;

    content += `## Active Task\n${snapshot.activeTaskSummary}\n\n`;

    content += `## Pending Tasks\n${snapshot.pendingTasksOverview || 'None'}\n\n`;

    if (snapshot.criticalDecisions.length > 0) {
      content += `## Critical Decisions\n`;
      for (const decision of snapshot.criticalDecisions) {
        content += `- ${decision}\n`;
      }
      content += '\n';
    }

    if (snapshot.activeFiles.length > 0) {
      content += `## Active Files\n`;
      for (const file of snapshot.activeFiles) {
        content += `- ${file}\n`;
      }
      content += '\n';
    }

    if (snapshot.blockersSummary !== 'No blockers') {
      content += `## Blockers\n${snapshot.blockersSummary}\n\n`;
    }

    return content;
  }

  // ==========================================================================
  // Context Validation
  // ==========================================================================

  /**
   * Validate that essential context is preserved
   */
  validateContextIntegrity(): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for orphaned dependencies
    const todos = this.todoManager.getAllTodos();
    for (const todo of todos) {
      for (const depId of todo.dependencies) {
        const dep = this.todoManager.findTodo(depId);
        if (!dep) {
          issues.push(
            `Todo "${todo.content}" has missing dependency: ${depId}`,
          );
        }
      }
    }

    // Check for stuck in-progress tasks
    const active = this.todoManager.getActiveTodo();
    if (active && active.timestamps.started) {
      const startedAt = new Date(active.timestamps.started);
      const now = new Date();
      const hoursElapsed =
        (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);

      if (hoursElapsed > 24) {
        issues.push(
          `Task "${active.content}" has been in progress for ${Math.round(hoursElapsed)} hours`,
        );
      }
    }

    // Check for too many blocked tasks
    const blocked = this.todoManager.getTodos({ status: 'blocked' });
    if (blocked.length > 5) {
      issues.push(
        `${blocked.length} tasks are blocked - consider resolving some`,
      );
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Create a ContextManager instance
 */
export function createContextManager(
  todoManager: TodoManager,
  compactionConfig: CompactionConfig,
): ContextManager {
  return new ContextManager(todoManager, compactionConfig);
}
