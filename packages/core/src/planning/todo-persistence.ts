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
 * Validates that an object has required session properties
 */
function isValidSession(obj: unknown): obj is TodoSession {
  if (typeof obj !== 'object' || obj === null) return false;
  const session = obj as Record<string, unknown>;
  return (
    typeof session['sessionId'] === 'string' &&
    typeof session['version'] === 'string' &&
    typeof session['startedAt'] === 'string' &&
    Array.isArray(session['todos']) &&
    typeof session['sessionContext'] === 'object' &&
    session['sessionContext'] !== null
  );
}

/**
 * Validates that an object has required metrics properties
 */
function isValidMetrics(obj: unknown): obj is TodoMetrics {
  if (typeof obj !== 'object' || obj === null) return false;
  const metrics = obj as Record<string, unknown>;
  return (
    typeof metrics['totalCreated'] === 'number' &&
    typeof metrics['totalCompleted'] === 'number' &&
    typeof metrics['totalFailed'] === 'number' &&
    typeof metrics['completionRate'] === 'number'
  );
}

/**
 * Validates that an array contains valid patterns
 */
function isValidPatterns(arr: unknown): arr is TaskPattern[] {
  if (!Array.isArray(arr)) return false;
  return arr.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const pattern = item as Record<string, unknown>;
    // Field is 'id' according to TaskPattern interface, not 'patternId'
    return typeof pattern['id'] === 'string';
  });
}

/**
 * Result type for operations that can fail with detailed errors
 */
export interface PersistenceResult<T> {
  success: boolean;
  data: T | null;
  error?: {
    type: 'file_not_found' | 'parse_error' | 'validation_error' | 'io_error';
    message: string;
    originalError?: Error;
  };
}

/**
 * Parse JSON with detailed error information
 */
function parseJsonSafe<T>(
  content: string,
  filePath: string,
): PersistenceResult<T> {
  try {
    const parsed = JSON.parse(content) as T;
    return { success: true, data: parsed };
  } catch (error) {
    const parseError =
      error instanceof Error ? error : new Error(String(error));
    return {
      success: false,
      data: null,
      error: {
        type: 'parse_error',
        message: `Failed to parse JSON in ${filePath}: ${parseError.message}`,
        originalError: parseError,
      },
    };
  }
}

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
 * Content size limits to prevent DoS attacks (in bytes)
 */
const SIZE_LIMITS = {
  /** Maximum session file size (10MB) */
  SESSION: 10 * 1024 * 1024,
  /** Maximum metrics file size (1MB) */
  METRICS: 1 * 1024 * 1024,
  /** Maximum patterns file size (5MB) */
  PATTERNS: 5 * 1024 * 1024,
  /** Maximum scratchpad size (100KB) - already enforced in HIGH-13 */
  SCRATCHPAD: 100 * 1024,
  /** Maximum single todo content length (10KB) */
  TODO_CONTENT: 10 * 1024,
  /** Maximum export file size (50MB) */
  EXPORT: 50 * 1024 * 1024,
} as const;

/**
 * Validates content size against a limit
 * @throws Error if content exceeds the limit
 */
function validateContentSize(
  content: string,
  limit: number,
  description: string,
): void {
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  if (sizeBytes > limit) {
    throw new Error(
      `Content size (${sizeBytes} bytes) exceeds limit for ${description} (${limit} bytes)`,
    );
  }
}

/**
 * Sanitize storage directory path to prevent path traversal attacks
 * @throws Error if path contains dangerous sequences
 */
function sanitizeStorageDir(storageDir: string, projectRoot: string): string {
  // Normalize the path to resolve any . or .. segments
  const normalizedDir = path.normalize(storageDir);

  // Check for path traversal sequences that could escape intended directory
  // These checks are done after normalization to catch encoded or indirect traversals
  if (
    normalizedDir.includes('..') ||
    normalizedDir.includes('\0') || // Null byte injection
    (normalizedDir.startsWith('/') && !path.isAbsolute(storageDir)) // Unix root escape
  ) {
    throw new Error(
      `Invalid storage directory path: "${storageDir}" contains path traversal sequences`,
    );
  }

  // Compute the resolved path
  const resolvedPath = path.isAbsolute(normalizedDir)
    ? normalizedDir
    : path.join(projectRoot, normalizedDir);

  // Verify the resolved path is under projectRoot (unless it's an absolute path)
  if (!path.isAbsolute(storageDir)) {
    const normalizedProjectRoot = path.normalize(projectRoot);
    const normalizedResolved = path.normalize(resolvedPath);

    if (!normalizedResolved.startsWith(normalizedProjectRoot)) {
      throw new Error(
        `Invalid storage directory: "${storageDir}" resolves outside project root`,
      );
    }
  }

  return resolvedPath;
}

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
    // Sanitize the storage directory to prevent path traversal attacks
    this.baseDir = sanitizeStorageDir(config.storageDir, projectRoot);
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
   * @throws Error if session exceeds size limit
   */
  saveSession(session: TodoSession): void {
    const filePath = path.join(this.baseDir, FILES.ACTIVE_SESSION);
    const content = JSON.stringify(session, null, 2);
    validateContentSize(content, SIZE_LIMITS.SESSION, 'session');
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load the active session from disk with detailed error information
   */
  loadSessionWithResult(): PersistenceResult<TodoSession> {
    const filePath = path.join(this.baseDir, FILES.ACTIVE_SESSION);
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'file_not_found',
          message: `Session file not found: ${filePath}`,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const ioError = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: {
          type: 'io_error',
          message: `Failed to read session file: ${ioError.message}`,
          originalError: ioError,
        },
      };
    }

    const parseResult = parseJsonSafe<unknown>(content, filePath);
    if (!parseResult.success) {
      return {
        success: false,
        data: null,
        error: parseResult.error,
      };
    }

    if (!isValidSession(parseResult.data)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'validation_error',
          message: `Invalid session format in file: ${filePath}`,
        },
      };
    }

    return { success: true, data: parseResult.data };
  }

  /**
   * Load the active session from disk
   * @deprecated Use loadSessionWithResult() for better error handling
   */
  loadSession(): TodoSession | null {
    const result = this.loadSessionWithResult();
    if (!result.success) {
      if (result.error?.type !== 'file_not_found') {
        console.error(
          `[TodoPersistence] ${result.error?.type}: ${result.error?.message}`,
        );
      }
      return null;
    }
    return result.data;
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
   * Optimized to extract info from filenames and file stats instead of reading each file
   */
  listArchivedSessions(): Array<{ sessionId: string; startedAt: string }> {
    if (!fs.existsSync(this.historyDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.historyDir)
      .filter((f) => f.endsWith('.json'));

    return files.map((file) => {
      const sessionId = file.replace('.json', '');
      const filePath = path.join(this.historyDir, file);

      // Try to extract timestamp from session ID (format: session-{timestamp}-{uuid})
      // This avoids reading the file content for every archived session
      const timestampMatch = sessionId.match(/^session-(\d+)-/);
      if (timestampMatch) {
        const timestamp = parseInt(timestampMatch[1], 10);
        if (!isNaN(timestamp)) {
          return {
            sessionId,
            startedAt: new Date(timestamp).toISOString(),
          };
        }
      }

      // Fallback: use file mtime (still faster than reading/parsing JSON)
      try {
        const stats = fs.statSync(filePath);
        return {
          sessionId,
          startedAt: stats.mtime.toISOString(),
        };
      } catch {
        return {
          sessionId,
          startedAt: 'unknown',
        };
      }
    });
  }

  /**
   * Load an archived session with detailed error information
   */
  loadArchivedSessionWithResult(
    sessionId: string,
  ): PersistenceResult<TodoSession> {
    const filePath = path.join(this.historyDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'file_not_found',
          message: `Archived session file not found: ${filePath}`,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const ioError = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: {
          type: 'io_error',
          message: `Failed to read archived session file: ${ioError.message}`,
          originalError: ioError,
        },
      };
    }

    const parseResult = parseJsonSafe<unknown>(content, filePath);
    if (!parseResult.success) {
      return {
        success: false,
        data: null,
        error: parseResult.error,
      };
    }

    if (!isValidSession(parseResult.data)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'validation_error',
          message: `Invalid archived session format in file: ${filePath}`,
        },
      };
    }

    return { success: true, data: parseResult.data };
  }

  /**
   * Load an archived session
   * @deprecated Use loadArchivedSessionWithResult() for better error handling
   */
  loadArchivedSession(sessionId: string): TodoSession | null {
    const result = this.loadArchivedSessionWithResult(sessionId);
    if (!result.success) {
      if (result.error?.type !== 'file_not_found') {
        console.error(
          `[TodoPersistence] ${result.error?.type}: ${result.error?.message}`,
        );
      }
      return null;
    }
    return result.data;
  }

  /**
   * Delete old sessions beyond the limit
   */
  cleanupOldSessions(maxSessions: number): number {
    const sessions = this.listArchivedSessions();
    if (sessions.length <= maxSessions) {
      return 0;
    }

    // Sort by date (oldest first), handling 'unknown' dates
    sessions.sort((a, b) => {
      const dateA = new Date(a.startedAt);
      const dateB = new Date(b.startedAt);
      const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
      const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
      return timeA - timeB;
    });

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
   * @throws Error if metrics exceed size limit
   */
  saveMetrics(metrics: TodoMetrics): void {
    const filePath = path.join(this.baseDir, FILES.METRICS);
    const content = JSON.stringify(metrics, null, 2);
    validateContentSize(content, SIZE_LIMITS.METRICS, 'metrics');
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load metrics from disk with detailed error information
   */
  loadMetricsWithResult(): PersistenceResult<TodoMetrics> {
    const filePath = path.join(this.baseDir, FILES.METRICS);
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'file_not_found',
          message: `Metrics file not found: ${filePath}`,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const ioError = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: {
          type: 'io_error',
          message: `Failed to read metrics file: ${ioError.message}`,
          originalError: ioError,
        },
      };
    }

    const parseResult = parseJsonSafe<unknown>(content, filePath);
    if (!parseResult.success) {
      return {
        success: false,
        data: null,
        error: parseResult.error,
      };
    }

    if (!isValidMetrics(parseResult.data)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'validation_error',
          message: `Invalid metrics format in file: ${filePath}`,
        },
      };
    }

    return { success: true, data: parseResult.data };
  }

  /**
   * Load metrics from disk
   * @deprecated Use loadMetricsWithResult() for better error handling
   */
  loadMetrics(): TodoMetrics | null {
    const result = this.loadMetricsWithResult();
    if (!result.success) {
      if (result.error?.type !== 'file_not_found') {
        console.error(
          `[TodoPersistence] ${result.error?.type}: ${result.error?.message}`,
        );
      }
      return null;
    }
    return result.data;
  }

  // ==========================================================================
  // Pattern Persistence (Layer 3)
  // ==========================================================================

  /**
   * Save patterns to disk
   * @throws Error if patterns exceed size limit
   */
  savePatterns(patterns: TaskPattern[]): void {
    const filePath = path.join(this.baseDir, FILES.PATTERNS);
    const content = JSON.stringify(patterns, null, 2);
    validateContentSize(content, SIZE_LIMITS.PATTERNS, 'patterns');
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Load patterns from disk with detailed error information
   */
  loadPatternsWithResult(): PersistenceResult<TaskPattern[]> {
    const filePath = path.join(this.baseDir, FILES.PATTERNS);
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'file_not_found',
          message: `Patterns file not found: ${filePath}`,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const ioError = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: {
          type: 'io_error',
          message: `Failed to read patterns file: ${ioError.message}`,
          originalError: ioError,
        },
      };
    }

    const parseResult = parseJsonSafe<unknown>(content, filePath);
    if (!parseResult.success) {
      return {
        success: false,
        data: null,
        error: parseResult.error,
      };
    }

    if (!isValidPatterns(parseResult.data)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'validation_error',
          message: `Invalid patterns format in file: ${filePath}`,
        },
      };
    }

    return { success: true, data: parseResult.data };
  }

  /**
   * Load patterns from disk
   * @deprecated Use loadPatternsWithResult() for better error handling
   */
  loadPatterns(): TaskPattern[] {
    const result = this.loadPatternsWithResult();
    if (!result.success) {
      if (result.error?.type !== 'file_not_found') {
        console.error(
          `[TodoPersistence] ${result.error?.type}: ${result.error?.message}`,
        );
      }
      return [];
    }
    return result.data ?? [];
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
   * Maximum scratchpad size in bytes (1MB)
   */
  private static readonly MAX_SCRATCHPAD_SIZE = 1024 * 1024;

  /**
   * Append to the scratchpad with size limit enforcement
   */
  appendToScratchpad(note: string): void {
    const current = this.getScratchpad();
    const timestamp = new Date().toISOString();
    let updated = `${current}\n## ${timestamp}\n\n${note}\n`;

    // Enforce size limit by truncating oldest entries if needed
    if (
      Buffer.byteLength(updated, 'utf-8') > TodoPersistence.MAX_SCRATCHPAD_SIZE
    ) {
      // Find and remove oldest entries until we're under the limit
      const lines = updated.split('\n');
      while (
        Buffer.byteLength(lines.join('\n'), 'utf-8') >
          TodoPersistence.MAX_SCRATCHPAD_SIZE &&
        lines.length > 10 // Keep at least the header and latest entry
      ) {
        // Remove lines after the header section (first 6 lines)
        const headerEndIndex = lines.findIndex(
          (line, idx) => idx > 5 && line.startsWith('## '),
        );
        if (headerEndIndex > 5) {
          // Find the next section start
          const nextSectionIndex = lines.findIndex(
            (line, idx) => idx > headerEndIndex && line.startsWith('## '),
          );
          if (nextSectionIndex > headerEndIndex) {
            lines.splice(headerEndIndex, nextSectionIndex - headerEndIndex);
          } else {
            break; // Can't find more sections to remove
          }
        } else {
          break; // No more sections to remove
        }
      }
      updated = lines.join('\n');
      console.warn(
        '[TodoPersistence] Scratchpad size limit reached, oldest entries removed',
      );
    }

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
   * Import a session from a JSON file with detailed error information
   */
  importSessionWithResult(inputPath: string): PersistenceResult<TodoSession> {
    if (!fs.existsSync(inputPath)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'file_not_found',
          message: `Import file not found: ${inputPath}`,
        },
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(inputPath, 'utf-8');
    } catch (error) {
      const ioError = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        data: null,
        error: {
          type: 'io_error',
          message: `Failed to read import file: ${ioError.message}`,
          originalError: ioError,
        },
      };
    }

    const parseResult = parseJsonSafe<unknown>(content, inputPath);
    if (!parseResult.success) {
      return {
        success: false,
        data: null,
        error: parseResult.error,
      };
    }

    if (!isValidSession(parseResult.data)) {
      return {
        success: false,
        data: null,
        error: {
          type: 'validation_error',
          message: `Invalid session format in import file: ${inputPath}`,
        },
      };
    }

    return { success: true, data: parseResult.data };
  }

  /**
   * Import a session from a JSON file
   * @deprecated Use importSessionWithResult() for better error handling
   */
  importSession(inputPath: string): TodoSession | null {
    const result = this.importSessionWithResult(inputPath);
    if (!result.success) {
      if (result.error?.type !== 'file_not_found') {
        console.error(
          `[TodoPersistence] ${result.error?.type}: ${result.error?.message}`,
        );
      }
      return null;
    }
    return result.data;
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
 * Update metrics when a todo is completed or blocked
 * Note: totalCreated should be incremented separately at todo creation time
 */
export function updateMetricsWithTodo(
  metrics: TodoMetrics,
  todo: AgenticTodo,
): TodoMetrics {
  const updated = { ...metrics };
  // Note: totalCreated is NOT incremented here - it should be tracked at creation time

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
