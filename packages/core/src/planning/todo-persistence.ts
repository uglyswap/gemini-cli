/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Todo Persistence Layer
 * Handles file-based storage for the planning system
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  TodoSession,
  TodoMetrics,
  TaskPattern,
  TodoManagerConfig,
  SessionDecision,
  AgenticTodo,
} from './types.js';

/**
 * File names for persistence
 */
const FILES = {
  ACTIVE_SESSION: 'active-session.json',
  METRICS: 'metrics.json',
  PATTERNS: 'patterns.json',
  CONTEXT_SUMMARY: 'context/summary.md',
  CONTEXT_DECISIONS: 'context/decisions.md',
  CONTEXT_SCRATCHPAD: 'context/scratchpad.md',
} as const;

/**
 * Todo Persistence Manager
 * Handles all file I/O for the planning system
 */
export class TodoPersistence {
  private readonly baseDir: string;
  private readonly historyDir: string;
  private readonly contextDir: string;

  constructor(
    projectRoot: string,
    config: Pick<TodoManagerConfig, 'storageDir'>,
  ) {
    this.baseDir = path.isAbsolute(config.storageDir)
      ? config.storageDir
      : path.join(projectRoot, config.storageDir);
    this.historyDir = path.join(this.baseDir, 'history');
    this.contextDir = path.join(this.baseDir, 'context');
    this.ensureDirectories();
  }

  // ==========================================================================
  // Directory Management
  // ==========================================================================

  /**
   * Ensure all required directories exist
   */
  private ensureDirectories(): void {
    const dirs = [this.baseDir, this.historyDir, this.contextDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Get the base storage directory
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  // ==========================================================================
  // Session Persistence (Layer 2)
  // ==========================================================================

  /**
   * Save the active session to disk
   */
  saveSession(session: TodoSession): void {
    const filePath = path.join(this.baseDir, FILES.ACTIVE_SESSION);
    const content = JSON.stringify(session, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load the active session from disk
   */
  loadSession(): TodoSession | null {
    const filePath = path.join(this.baseDir, FILES.ACTIVE_SESSION);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TodoSession;
    } catch (error) {
      console.error('[TodoPersistence] Failed to load session:', error);
      return null;
    }
  }

  /**
   * Archive the current session to history
   */
  archiveSession(session: TodoSession): string {
    const fileName = `${session.sessionId}.json`;
    const filePath = path.join(this.historyDir, fileName);
    const content = JSON.stringify(session, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * List all archived sessions
   */
  listArchivedSessions(): Array<{ sessionId: string; startedAt: string }> {
    if (!fs.existsSync(this.historyDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.historyDir)
      .filter((f) => f.endsWith('.json'));

    return files.map((file) => {
      const filePath = path.join(this.historyDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(content) as TodoSession;
        return {
          sessionId: session.sessionId,
          startedAt: session.startedAt,
        };
      } catch {
        return {
          sessionId: file.replace('.json', ''),
          startedAt: 'unknown',
        };
      }
    });
  }

  /**
   * Load an archived session
   */
  loadArchivedSession(sessionId: string): TodoSession | null {
    const filePath = path.join(this.historyDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TodoSession;
    } catch (error) {
      console.error(
        '[TodoPersistence] Failed to load archived session:',
        error,
      );
      return null;
    }
  }

  /**
   * Delete old sessions beyond the limit
   */
  cleanupOldSessions(maxSessions: number): number {
    const sessions = this.listArchivedSessions();
    if (sessions.length <= maxSessions) {
      return 0;
    }

    // Sort by date (oldest first)
    sessions.sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );

    const toDelete = sessions.slice(0, sessions.length - maxSessions);
    let deleted = 0;

    for (const session of toDelete) {
      const filePath = path.join(this.historyDir, `${session.sessionId}.json`);
      try {
        fs.unlinkSync(filePath);
        deleted++;
      } catch (error) {
        console.error(
          `[TodoPersistence] Failed to delete ${session.sessionId}:`,
          error,
        );
      }
    }

    return deleted;
  }

  // ==========================================================================
  // Metrics Persistence (Layer 3)
  // ==========================================================================

  /**
   * Save metrics to disk
   */
  saveMetrics(metrics: TodoMetrics): void {
    const filePath = path.join(this.baseDir, FILES.METRICS);
    const content = JSON.stringify(metrics, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load metrics from disk
   */
  loadMetrics(): TodoMetrics | null {
    const filePath = path.join(this.baseDir, FILES.METRICS);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TodoMetrics;
    } catch (error) {
      console.error('[TodoPersistence] Failed to load metrics:', error);
      return null;
    }
  }

  // ==========================================================================
  // Pattern Persistence (Layer 3)
  // ==========================================================================

  /**
   * Save patterns to disk
   */
  savePatterns(patterns: TaskPattern[]): void {
    const filePath = path.join(this.baseDir, FILES.PATTERNS);
    const content = JSON.stringify(patterns, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load patterns from disk
   */
  loadPatterns(): TaskPattern[] {
    const filePath = path.join(this.baseDir, FILES.PATTERNS);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TaskPattern[];
    } catch (error) {
      console.error('[TodoPersistence] Failed to load patterns:', error);
      return [];
    }
  }

  // ==========================================================================
  // Context Files (Human-Readable Markdown)
  // ==========================================================================

  /**
   * Update the context summary markdown file
   */
  updateContextSummary(session: TodoSession): void {
    const filePath = path.join(this.baseDir, FILES.CONTEXT_SUMMARY);
    const content = this.generateSummaryMarkdown(session);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Update the decisions markdown file
   */
  updateDecisionsLog(decisions: SessionDecision[]): void {
    const filePath = path.join(this.baseDir, FILES.CONTEXT_DECISIONS);
    const content = this.generateDecisionsMarkdown(decisions);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Read or create the scratchpad
   */
  getScratchpad(): string {
    const filePath = path.join(this.baseDir, FILES.CONTEXT_SCRATCHPAD);
    if (!fs.existsSync(filePath)) {
      const initial = `# Scratchpad\n\nUse this file for working notes during the session.\n\n---\n\n`;
      fs.writeFileSync(filePath, initial, 'utf-8');
      return initial;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Update the scratchpad
   */
  updateScratchpad(content: string): void {
    const filePath = path.join(this.baseDir, FILES.CONTEXT_SCRATCHPAD);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Append to the scratchpad
   */
  appendToScratchpad(note: string): void {
    const current = this.getScratchpad();
    const timestamp = new Date().toISOString();
    const updated = `${current}\n## ${timestamp}\n\n${note}\n`;
    this.updateScratchpad(updated);
  }

  // ==========================================================================
  // Markdown Generators
  // ==========================================================================

  /**
   * Generate summary markdown from session
   */
  private generateSummaryMarkdown(session: TodoSession): string {
    const { todos, sessionContext } = session;
    const now = new Date().toISOString();

    const pending = todos.filter((t) => t.status === 'pending');
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const completed = todos.filter((t) => t.status === 'completed');
    const blocked = todos.filter((t) => t.status === 'blocked');

    let md = `# Session Summary

**Generated:** ${now}
**Session ID:** ${session.sessionId}
**Started:** ${session.startedAt}

## Overview

${sessionContext.taskDescription || 'No task description provided.'}

## Progress

| Status | Count |
|--------|-------|
| Pending | ${pending.length} |
| In Progress | ${inProgress.length} |
| Completed | ${completed.length} |
| Blocked | ${blocked.length} |
| **Total** | **${todos.length}** |

`;

    if (inProgress.length > 0) {
      md += `## Currently Working On

`;
      for (const todo of inProgress) {
        md += `- **${todo.content}**`;
        if (todo.assignedAgentId) {
          md += ` (Agent: ${todo.assignedAgentId})`;
        }
        md += '\n';
      }
      md += '\n';
    }

    if (blocked.length > 0) {
      md += `## Blocked Items

`;
      for (const todo of blocked) {
        md += `- **${todo.content}**\n`;
        if (todo.context.blockers && todo.context.blockers.length > 0) {
          for (const blocker of todo.context.blockers) {
            md += `  - Blocker: ${blocker}\n`;
          }
        }
      }
      md += '\n';
    }

    if (pending.length > 0) {
      md += `## Pending Tasks

`;
      // Sort by priority
      const sorted = [...pending].sort((a, b) => b.priority - a.priority);
      for (const todo of sorted) {
        md += `- [P${todo.priority}] ${todo.content}\n`;
      }
      md += '\n';
    }

    if (completed.length > 0) {
      md += `## Completed

`;
      for (const todo of completed) {
        const completedAt = todo.timestamps.completed || 'unknown';
        md += `- ~~${todo.content}~~ (${completedAt})\n`;
      }
      md += '\n';
    }

    if (sessionContext.completedWorkSummary) {
      md += `## Work Summary

${sessionContext.completedWorkSummary}

`;
    }

    return md;
  }

  /**
   * Generate decisions markdown
   */
  private generateDecisionsMarkdown(decisions: SessionDecision[]): string {
    const now = new Date().toISOString();

    let md = `# Session Decisions

**Last Updated:** ${now}

`;

    if (decisions.length === 0) {
      md += `_No decisions recorded yet._\n`;
      return md;
    }

    // Most recent first
    const sorted = [...decisions].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    for (const decision of sorted) {
      md += `## ${decision.timestamp}

**Decision:** ${decision.decision}

**Rationale:** ${decision.rationale}

`;
      if (decision.alternatives && decision.alternatives.length > 0) {
        md += `**Alternatives Considered:**
`;
        for (const alt of decision.alternatives) {
          md += `- ${alt}\n`;
        }
        md += '\n';
      }

      if (decision.relatedTodoId) {
        md += `**Related Task:** ${decision.relatedTodoId}\n\n`;
      }

      md += '---\n\n';
    }

    return md;
  }

  // ==========================================================================
  // Export Utilities
  // ==========================================================================

  /**
   * Export session to a standalone JSON file
   */
  exportSession(session: TodoSession, outputPath: string): void {
    const content = JSON.stringify(session, null, 2);
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  /**
   * Import a session from a JSON file
   */
  importSession(inputPath: string): TodoSession | null {
    if (!fs.existsSync(inputPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(inputPath, 'utf-8');
      return JSON.parse(content) as TodoSession;
    } catch (error) {
      console.error('[TodoPersistence] Failed to import session:', error);
      return null;
    }
  }

  /**
   * Generate a portable context dump for LLM consumption
   */
  generateContextDump(session: TodoSession): string {
    const { todos, sessionContext } = session;

    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const pending = todos.filter((t) => t.status === 'pending');
    const blocked = todos.filter((t) => t.status === 'blocked');

    let dump = `<session-context>
<task>${sessionContext.taskDescription}</task>
<focus>${sessionContext.currentFocus || 'None specified'}</focus>

<todos>
`;

    if (inProgress.length > 0) {
      dump += `<in-progress>\n`;
      for (const todo of inProgress) {
        dump += `  <todo id="${todo.id}" agent="${todo.assignedAgentId || 'unassigned'}">${todo.content}</todo>\n`;
      }
      dump += `</in-progress>\n`;
    }

    if (pending.length > 0) {
      dump += `<pending>\n`;
      for (const todo of pending.slice(0, 10)) {
        // Limit to 10 for context
        dump += `  <todo id="${todo.id}" priority="${todo.priority}">${todo.content}</todo>\n`;
      }
      if (pending.length > 10) {
        dump += `  <note>...and ${pending.length - 10} more pending tasks</note>\n`;
      }
      dump += `</pending>\n`;
    }

    if (blocked.length > 0) {
      dump += `<blocked>\n`;
      for (const todo of blocked) {
        const blockers = todo.context.blockers?.join(', ') || 'Unknown';
        dump += `  <todo id="${todo.id}" blockers="${blockers}">${todo.content}</todo>\n`;
      }
      dump += `</blocked>\n`;
    }

    dump += `</todos>

<recent-decisions>
`;

    const recentDecisions = sessionContext.keyDecisions.slice(-5);
    for (const decision of recentDecisions) {
      dump += `  <decision timestamp="${decision.timestamp}">${decision.decision}</decision>\n`;
    }

    dump += `</recent-decisions>
</session-context>`;

    return dump;
  }
}

/**
 * Create default initial metrics
 */
export function createDefaultMetrics(): TodoMetrics {
  return {
    totalCreated: 0,
    totalCompleted: 0,
    totalFailed: 0,
    averageCompletionTimeMs: 0,
    completionRate: 0,
    topTags: [],
    agentPerformance: {},
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update metrics with a completed todo
 */
export function updateMetricsWithTodo(
  metrics: TodoMetrics,
  todo: AgenticTodo,
): TodoMetrics {
  const updated = { ...metrics };
  updated.totalCreated++;

  if (todo.status === 'completed') {
    updated.totalCompleted++;

    // Update completion time
    if (todo.timestamps.started && todo.timestamps.completed) {
      const duration =
        new Date(todo.timestamps.completed).getTime() -
        new Date(todo.timestamps.started).getTime();
      const prevTotal =
        updated.averageCompletionTimeMs * (updated.totalCompleted - 1);
      updated.averageCompletionTimeMs =
        (prevTotal + duration) / updated.totalCompleted;
    }

    // Update agent performance
    if (todo.assignedAgentId) {
      const agentStats = updated.agentPerformance[todo.assignedAgentId] || {
        assigned: 0,
        completed: 0,
        avgQualityScore: 0,
      };
      agentStats.assigned++;
      agentStats.completed++;
      if (todo.result?.qualityScore) {
        const prevScoreTotal =
          agentStats.avgQualityScore * (agentStats.completed - 1);
        agentStats.avgQualityScore =
          (prevScoreTotal + todo.result.qualityScore) / agentStats.completed;
      }
      updated.agentPerformance[todo.assignedAgentId] = agentStats;
    }
  } else if (todo.status === 'blocked') {
    updated.totalFailed++;
  }

  // Update completion rate
  updated.completionRate =
    updated.totalCreated > 0
      ? updated.totalCompleted / updated.totalCreated
      : 0;

  // Update tags
  if (todo.context.tags) {
    for (const tag of todo.context.tags) {
      const existing = updated.topTags.find((t) => t.tag === tag);
      if (existing) {
        existing.count++;
      } else {
        updated.topTags.push({ tag, count: 1 });
      }
    }
    // Keep top 20 tags
    updated.topTags.sort((a, b) => b.count - a.count);
    updated.topTags = updated.topTags.slice(0, 20);
  }

  updated.lastUpdated = new Date().toISOString();
  return updated;
}
