/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Todo Manager
 * Core orchestration layer for the 3-tier TODO planning system
 * Manages in-memory state, coordinates persistence, and handles events
 */

import { randomUUID } from 'node:crypto';
import type {
  AgenticTodo,
  TodoStatus,
  TodoSession,
  TodoMetrics,
  SessionDecision,
  TodoManagerConfig,
  TodoEvent,
  TodoEventHandler,
  CreateTodoOptions,
  UpdateTodoOptions,
  TodoFilter,
  TodoSort,
  TodoSummary,
  CompactionInfo,
  ArchivedTodoSummary,
  TodoResult,
} from './types.js';
import { DEFAULT_TODO_CONFIG } from './types.js';
import {
  TodoPersistence,
  createDefaultMetrics,
  updateMetricsWithTodo,
} from './todo-persistence.js';

/**
 * Compaction status for context management
 */
export interface CompactionStatus {
  /** Current estimated context usage (0-1) */
  contextUsage: number;
  /** Whether warning threshold is exceeded */
  warningTriggered: boolean;
  /** Whether compaction threshold is exceeded */
  compactionNeeded: boolean;
  /** Recommended actions */
  recommendations: string[];
}

/**
 * TodoManager - Central orchestrator for the planning system
 *
 * Responsibilities:
 * - Layer 1: Active context management (in-memory)
 * - Layer 2: Session persistence coordination
 * - Layer 3: Metrics aggregation
 * - Event emission for integrations
 * - Compaction detection and triggering
 */
export class TodoManager {
  private readonly config: TodoManagerConfig;
  private readonly persistence: TodoPersistence;
  private readonly eventHandlers: Set<TodoEventHandler>;

  // Layer 1: In-memory state
  private session: TodoSession;
  private metrics: TodoMetrics;

  // Auto-save management
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private isDirty: boolean = false;

  constructor(projectRoot: string, config: Partial<TodoManagerConfig> = {}) {
    this.config = { ...DEFAULT_TODO_CONFIG, ...config };
    this.persistence = new TodoPersistence(projectRoot, this.config);
    this.eventHandlers = new Set();

    // Initialize or load session
    const existingSession = this.persistence.loadSession();
    if (existingSession) {
      this.session = existingSession;
    } else {
      this.session = this.createNewSession(projectRoot);
    }

    // Initialize or load metrics
    const existingMetrics = this.persistence.loadMetrics();
    this.metrics = existingMetrics || createDefaultMetrics();

    // Start auto-save if enabled
    if (this.config.autoSaveIntervalMs > 0) {
      this.startAutoSave();
    }
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Create a new session
   */
  private createNewSession(projectRoot: string): TodoSession {
    const now = new Date().toISOString();
    return {
      sessionId: `session-${Date.now()}-${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      startedAt: now,
      lastActivityAt: now,
      todos: [],
      sessionContext: {
        taskDescription: '',
        projectRoot,
        keyDecisions: [],
        completedWorkSummary: '',
        currentFocus: '',
        importantValues: {},
      },
      compactionInfo: {
        compactionCount: 0,
        archivedItems: [],
      },
    };
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.session.sessionId;
  }

  /**
   * Set the task description for the session
   */
  setTaskDescription(description: string): void {
    this.session.sessionContext.taskDescription = description;
    this.markDirty();
  }

  /**
   * Set the current focus area
   */
  setCurrentFocus(focus: string): void {
    this.session.sessionContext.currentFocus = focus;
    this.markDirty();
  }

  /**
   * Store an important value for later reference
   */
  setImportantValue(key: string, value: string): void {
    this.session.sessionContext.importantValues =
      this.session.sessionContext.importantValues || {};
    this.session.sessionContext.importantValues[key] = value;
    this.markDirty();
  }

  /**
   * Get an important value
   */
  getImportantValue(key: string): string | undefined {
    return this.session.sessionContext.importantValues?.[key];
  }

  /**
   * Get all important values
   */
  getAllImportantValues(): Record<string, string> {
    return { ...(this.session.sessionContext.importantValues || {}) };
  }

  /**
   * Start a new session, archiving the current one
   */
  startNewSession(): void {
    // Archive current session if it has content
    if (this.session.todos.length > 0) {
      this.persistence.archiveSession(this.session);
      this.persistence.cleanupOldSessions(this.config.maxHistorySessions);
    }

    // Create new session
    this.session = this.createNewSession(
      this.session.sessionContext.projectRoot,
    );
    this.isDirty = false; // Reset dirty flag for new session
    this.persistence.saveSession(this.session);

    // Reset auto-save timer if enabled
    if (this.config.autoSaveIntervalMs > 0) {
      this.startAutoSave();
    }

    this.emit({ type: 'session_saved', sessionId: this.session.sessionId });
  }

  // ==========================================================================
  // Todo CRUD Operations
  // ==========================================================================

  /**
   * Create a new todo
   */
  createTodo(options: CreateTodoOptions): AgenticTodo {
    const now = new Date().toISOString();
    const id = `todo-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // Generate activeForm if not provided
    const activeForm =
      options.activeForm || this.generateActiveForm(options.content);

    const todo: AgenticTodo = {
      id,
      content: options.content,
      activeForm,
      status: 'pending',
      priority: options.priority || 5,
      assignedAgentId: options.assignedAgentId,
      trustLevelRequired: options.trustLevelRequired,
      qualityGatesRequired: options.qualityGatesRequired,
      dependencies: options.dependencies || [],
      parentTaskId: options.parentTaskId,
      context: {
        filesInvolved: [],
        decisionsMade: [],
        tags: options.tags,
        notes: options.notes,
      },
      timestamps: {
        created: now,
        lastUpdated: now,
      },
    };

    // Add as subtask if parent specified
    if (options.parentTaskId) {
      const parent = this.findTodo(options.parentTaskId);
      if (parent) {
        parent.subtasks = parent.subtasks || [];
        parent.subtasks.push(todo);
      }
    } else {
      this.session.todos.push(todo);
    }

    this.markDirty();
    this.emit({ type: 'todo_created', todo });

    // Track metrics for todo creation
    if (this.config.enableMetrics) {
      this.metrics.totalCreated++;
      this.metrics.lastUpdated = new Date().toISOString();
      this.persistence.saveMetrics(this.metrics);
    }

    // Check if we're approaching limits
    if (this.session.todos.length >= this.config.maxTodosPerSession) {
      console.warn(
        `[TodoManager] Warning: Session has ${this.session.todos.length} todos, approaching limit of ${this.config.maxTodosPerSession}`,
      );
    }

    return todo;
  }

  /**
   * Create multiple todos at once
   */
  createTodos(optionsList: CreateTodoOptions[]): AgenticTodo[] {
    return optionsList.map((options) => this.createTodo(options));
  }

  /**
   * Find a todo by ID (recursively searches all subtask levels)
   */
  findTodo(id: string): AgenticTodo | undefined {
    const searchRecursively = (
      todos: AgenticTodo[],
    ): AgenticTodo | undefined => {
      for (const todo of todos) {
        if (todo.id === id) return todo;
        // Recursively search in subtasks
        if (todo.subtasks && todo.subtasks.length > 0) {
          const found = searchRecursively(todo.subtasks);
          if (found) return found;
        }
      }
      return undefined;
    };
    return searchRecursively(this.session.todos);
  }

  /**
   * Update a todo
   */
  updateTodo(id: string, updates: UpdateTodoOptions): AgenticTodo | null {
    const todo = this.findTodo(id);
    if (!todo) {
      console.warn(`[TodoManager] Todo not found: ${id}`);
      return null;
    }

    const previousStatus = todo.status;
    const now = new Date().toISOString();

    // Apply updates
    if (updates.status !== undefined) {
      todo.status = updates.status;

      // Track timestamps
      if (updates.status === 'in_progress' && !todo.timestamps.started) {
        todo.timestamps.started = now;
      } else if (updates.status === 'completed') {
        todo.timestamps.completed = now;
      }
    }

    if (updates.priority !== undefined) {
      todo.priority = updates.priority;
    }

    if (updates.assignedAgentId !== undefined) {
      todo.assignedAgentId = updates.assignedAgentId;
    }

    if (updates.blockers !== undefined) {
      todo.context.blockers = updates.blockers;
    }

    if (updates.notes !== undefined) {
      todo.context.notes = updates.notes;
    }

    if (updates.result !== undefined) {
      todo.result = updates.result;
    }

    todo.timestamps.lastUpdated = now;
    this.session.lastActivityAt = now;

    this.markDirty();

    // Emit appropriate events
    if (updates.status !== undefined && updates.status !== previousStatus) {
      this.emit({ type: 'todo_updated', todo, previousStatus });

      if (updates.status === 'completed') {
        this.emit({ type: 'todo_completed', todo });

        // Update metrics
        if (this.config.enableMetrics) {
          this.metrics = updateMetricsWithTodo(this.metrics, todo);
          this.persistence.saveMetrics(this.metrics);
        }
      } else if (updates.status === 'blocked' && updates.blockers) {
        this.emit({ type: 'todo_blocked', todo, blockers: updates.blockers });
      }
    }

    return todo;
  }

  /**
   * Start working on a todo (convenience method)
   */
  startTodo(id: string, agentId?: string): AgenticTodo | null {
    const updates: UpdateTodoOptions = { status: 'in_progress' };
    if (agentId) {
      updates.assignedAgentId = agentId;
    }
    return this.updateTodo(id, updates);
  }

  /**
   * Complete a todo (convenience method)
   */
  completeTodo(id: string, result?: TodoResult): AgenticTodo | null {
    return this.updateTodo(id, { status: 'completed', result });
  }

  /**
   * Block a todo (convenience method)
   */
  blockTodo(id: string, blockers: string[]): AgenticTodo | null {
    return this.updateTodo(id, { status: 'blocked', blockers });
  }

  /**
   * Add a file to a todo's context
   */
  addFileToTodo(todoId: string, filePath: string): void {
    const todo = this.findTodo(todoId);
    if (todo && !todo.context.filesInvolved.includes(filePath)) {
      todo.context.filesInvolved.push(filePath);
      todo.timestamps.lastUpdated = new Date().toISOString();
      this.markDirty();
    }
  }

  /**
   * Add a decision to a todo's context
   */
  addDecisionToTodo(todoId: string, decision: string): void {
    const todo = this.findTodo(todoId);
    if (todo) {
      todo.context.decisionsMade.push(decision);
      todo.timestamps.lastUpdated = new Date().toISOString();
      this.markDirty();
    }
  }

  /**
   * Delete a todo and clean up all dependency references
   */
  deleteTodo(id: string): boolean {
    // Recursively delete from any list of todos
    const deleteRecursively = (todos: AgenticTodo[]): boolean => {
      const index = todos.findIndex((t) => t.id === id);
      if (index !== -1) {
        todos.splice(index, 1);
        return true;
      }
      // Check subtasks recursively
      for (const todo of todos) {
        if (todo.subtasks && todo.subtasks.length > 0) {
          if (deleteRecursively(todo.subtasks)) {
            return true;
          }
        }
      }
      return false;
    };

    const deleted = deleteRecursively(this.session.todos);

    if (deleted) {
      // Clean up dependency references in all todos
      const cleanupDependencies = (todos: AgenticTodo[]): void => {
        for (const todo of todos) {
          if (todo.dependencies && todo.dependencies.length > 0) {
            todo.dependencies = todo.dependencies.filter(
              (depId) => depId !== id,
            );
          }
          if (todo.subtasks && todo.subtasks.length > 0) {
            cleanupDependencies(todo.subtasks);
          }
        }
      };
      cleanupDependencies(this.session.todos);
      this.markDirty();
    }

    return deleted;
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all todos
   */
  getAllTodos(): AgenticTodo[] {
    return [...this.session.todos];
  }

  /**
   * Get todos matching a filter
   */
  getTodos(filter?: TodoFilter, sort?: TodoSort): AgenticTodo[] {
    let todos = this.flattenTodos();

    // Apply filters
    if (filter) {
      todos = todos.filter((todo) => {
        // Status filter
        if (filter.status) {
          const statuses = Array.isArray(filter.status)
            ? filter.status
            : [filter.status];
          if (!statuses.includes(todo.status)) return false;
        }

        // Agent filter
        if (
          filter.assignedAgentId &&
          todo.assignedAgentId !== filter.assignedAgentId
        ) {
          return false;
        }

        // Priority filter
        if (filter.priority) {
          if (typeof filter.priority === 'number') {
            if (todo.priority !== filter.priority) return false;
          } else {
            if (filter.priority.min && todo.priority < filter.priority.min)
              return false;
            if (filter.priority.max && todo.priority > filter.priority.max)
              return false;
          }
        }

        // Tags filter
        if (filter.tags && filter.tags.length > 0) {
          if (
            !todo.context.tags ||
            !filter.tags.some((t) => todo.context.tags!.includes(t))
          ) {
            return false;
          }
        }

        // Blockers filter
        if (filter.hasBlockers !== undefined) {
          const hasBlockers =
            todo.context.blockers && todo.context.blockers.length > 0;
          if (filter.hasBlockers !== hasBlockers) return false;
        }

        // Parent filter
        if (filter.parentTaskId !== undefined) {
          if (filter.parentTaskId === null) {
            // Only root tasks
            if (todo.parentTaskId) return false;
          } else {
            if (todo.parentTaskId !== filter.parentTaskId) return false;
          }
        }

        return true;
      });
    }

    // Apply sort
    if (sort) {
      const direction = sort.direction === 'asc' ? 1 : -1;
      todos.sort((a, b) => {
        switch (sort.field) {
          case 'priority':
            return (a.priority - b.priority) * direction;
          case 'created':
            return (
              (new Date(a.timestamps.created).getTime() -
                new Date(b.timestamps.created).getTime()) *
              direction
            );
          case 'lastUpdated':
            return (
              (new Date(a.timestamps.lastUpdated).getTime() -
                new Date(b.timestamps.lastUpdated).getTime()) *
              direction
            );
          case 'status': {
            const statusOrder: Record<TodoStatus, number> = {
              in_progress: 0,
              pending: 1,
              blocked: 2,
              completed: 3,
            };
            return (statusOrder[a.status] - statusOrder[b.status]) * direction;
          }
          default:
            return 0;
        }
      });
    }

    return todos;
  }

  /**
   * Flatten all todos including subtasks (recursively at all levels)
   */
  private flattenTodos(): AgenticTodo[] {
    const result: AgenticTodo[] = [];
    const flattenRecursively = (todos: AgenticTodo[]): void => {
      for (const todo of todos) {
        result.push(todo);
        if (todo.subtasks && todo.subtasks.length > 0) {
          flattenRecursively(todo.subtasks);
        }
      }
    };
    flattenRecursively(this.session.todos);
    return result;
  }

  /**
   * Get the currently active todo (in_progress)
   */
  getActiveTodo(): AgenticTodo | undefined {
    return this.flattenTodos().find((t) => t.status === 'in_progress');
  }

  /**
   * Get next todo to work on (highest priority pending with resolved dependencies)
   */
  getNextTodo(): AgenticTodo | undefined {
    const pending = this.getTodos(
      { status: 'pending' },
      { field: 'priority', direction: 'desc' },
    );

    for (const todo of pending) {
      // Check if all dependencies are completed
      if (todo.dependencies.length === 0) {
        return todo;
      }

      const allDepsCompleted = todo.dependencies.every((depId) => {
        const dep = this.findTodo(depId);
        return dep && dep.status === 'completed';
      });

      if (allDepsCompleted) {
        return todo;
      }
    }

    return undefined;
  }

  /**
   * Get summary statistics
   */
  getSummary(): TodoSummary {
    const todos = this.flattenTodos();

    const pending = todos.filter((t) => t.status === 'pending');
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const completed = todos.filter((t) => t.status === 'completed');
    const blocked = todos.filter((t) => t.status === 'blocked');

    // Calculate average priority
    const avgPriority =
      todos.length > 0
        ? todos.reduce((sum, t) => sum + t.priority, 0) / todos.length
        : 0;

    // Count by agent
    const agentCounts: Record<string, number> = {};
    for (const todo of todos) {
      if (todo.assignedAgentId) {
        agentCounts[todo.assignedAgentId] =
          (agentCounts[todo.assignedAgentId] || 0) + 1;
      }
    }

    const topAgents = Object.entries(agentCounts)
      .map(([agentId, count]) => ({ agentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total: todos.length,
      pending: pending.length,
      inProgress: inProgress.length,
      completed: completed.length,
      blocked: blocked.length,
      completionRate: todos.length > 0 ? completed.length / todos.length : 0,
      averagePriority: avgPriority,
      topAgents,
    };
  }

  // ==========================================================================
  // Decisions Management
  // ==========================================================================

  /**
   * Record a decision
   */
  recordDecision(
    decision: string,
    rationale: string,
    alternatives?: string[],
    relatedTodoId?: string,
  ): SessionDecision {
    const decisionRecord: SessionDecision = {
      timestamp: new Date().toISOString(),
      decision,
      rationale,
      alternatives,
      relatedTodoId,
    };

    this.session.sessionContext.keyDecisions.push(decisionRecord);
    this.markDirty();

    this.emit({ type: 'decision_recorded', decision: decisionRecord });

    // Update decisions log
    this.persistence.updateDecisionsLog(
      this.session.sessionContext.keyDecisions,
    );

    return decisionRecord;
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(count: number = 10): SessionDecision[] {
    return this.session.sessionContext.keyDecisions.slice(-count);
  }

  // ==========================================================================
  // Compaction & Context Management
  // ==========================================================================

  /**
   * Estimate current context usage (0-1)
   * This is a heuristic based on todo count and content length
   */
  estimateContextUsage(): number {
    const todos = this.flattenTodos();
    const decisions = this.session.sessionContext.keyDecisions;

    // Estimate tokens (rough approximation)
    let estimatedTokens = 0;

    for (const todo of todos) {
      // Base todo structure: ~50 tokens
      estimatedTokens += 50;
      // Content: ~1 token per 4 chars
      estimatedTokens += Math.ceil(todo.content.length / 4);
      // Files: ~10 tokens per file
      estimatedTokens += todo.context.filesInvolved.length * 10;
      // Decisions: ~20 tokens per decision
      estimatedTokens += todo.context.decisionsMade.length * 20;
    }

    for (const decision of decisions) {
      estimatedTokens += 30;
      estimatedTokens += Math.ceil(decision.decision.length / 4);
      estimatedTokens += Math.ceil(decision.rationale.length / 4);
    }

    // Use configured maxPlanningTokens (default: ~20% of typical 100k context window)
    return Math.min(1, estimatedTokens / this.config.maxPlanningTokens);
  }

  /**
   * Get compaction status
   */
  getCompactionStatus(): CompactionStatus {
    const usage = this.estimateContextUsage();
    const { warningThreshold, compactionThreshold } = this.config.compaction;

    const recommendations: string[] = [];

    if (usage > compactionThreshold) {
      recommendations.push('Immediate compaction recommended');
      recommendations.push('Archive completed tasks');
      recommendations.push('Summarize old decisions');
    } else if (usage > warningThreshold) {
      recommendations.push('Consider archiving completed tasks');
      recommendations.push('Limit number of pending tasks');
    }

    const completedCount = this.session.todos.filter(
      (t) => t.status === 'completed',
    ).length;
    if (completedCount > this.config.compaction.maxCompletedBeforeArchive) {
      recommendations.push(
        `${completedCount} completed tasks should be archived`,
      );
    }

    return {
      contextUsage: usage,
      warningTriggered: usage > warningThreshold,
      compactionNeeded: usage > compactionThreshold,
      recommendations,
    };
  }

  /**
   * Perform compaction - archive completed todos and trim decisions
   */
  performCompaction(): CompactionInfo {
    const beforeUsage = this.estimateContextUsage();
    const archivedItems: ArchivedTodoSummary[] = [];
    const now = new Date().toISOString();

    this.emit({ type: 'compaction_triggered', reason: 'manual' });

    // Archive completed todos
    const completed = this.session.todos.filter(
      (t) => t.status === 'completed',
    );
    for (const todo of completed) {
      archivedItems.push({
        todoId: todo.id,
        contentSummary:
          todo.content.slice(0, 100) + (todo.content.length > 100 ? '...' : ''),
        finalStatus: 'completed',
        archivedAt: now,
      });
    }

    // Remove completed todos from active session
    this.session.todos = this.session.todos.filter(
      (t) => t.status !== 'completed',
    );

    // Trim old decisions, keeping only the most recent
    const { preserveLastNDecisions } = this.config.compaction;
    if (
      this.session.sessionContext.keyDecisions.length > preserveLastNDecisions
    ) {
      this.session.sessionContext.keyDecisions =
        this.session.sessionContext.keyDecisions.slice(-preserveLastNDecisions);
    }

    // Update compaction info
    this.session.compactionInfo = this.session.compactionInfo || {
      compactionCount: 0,
      archivedItems: [],
    };
    this.session.compactionInfo.compactionCount++;
    this.session.compactionInfo.lastCompactionAt = now;
    this.session.compactionInfo.tokensBeforeLastCompaction = Math.round(
      beforeUsage * this.config.maxPlanningTokens,
    );
    this.session.compactionInfo.archivedItems.push(...archivedItems);

    // Update work summary
    const summaryLines = archivedItems.map(
      (item) => `- ${item.contentSummary}`,
    );
    const existingSummary =
      this.session.sessionContext.completedWorkSummary || '';
    this.session.sessionContext.completedWorkSummary =
      existingSummary +
      (existingSummary ? '\n\n' : '') +
      `## Compaction ${this.session.compactionInfo.compactionCount}\n${summaryLines.join('\n')}`;

    const afterUsage = this.estimateContextUsage();
    this.session.compactionInfo.tokensAfterLastCompaction = Math.round(
      afterUsage * this.config.maxPlanningTokens,
    );

    this.markDirty();
    this.save();

    // Update context files
    this.persistence.updateContextSummary(this.session);

    this.emit({
      type: 'compaction_completed',
      archivedCount: archivedItems.length,
    });

    return this.session.compactionInfo;
  }

  /**
   * Auto-compact if needed
   */
  autoCompactIfNeeded(): boolean {
    if (!this.config.compaction.enabled) {
      return false;
    }

    const status = this.getCompactionStatus();
    if (status.compactionNeeded) {
      this.performCompaction();
      return true;
    }

    return false;
  }

  // ==========================================================================
  // Persistence Operations
  // ==========================================================================

  /**
   * Mark session as dirty (needs saving)
   */
  private markDirty(): void {
    this.isDirty = true;
    this.session.lastActivityAt = new Date().toISOString();
  }

  /**
   * Save session immediately
   */
  save(): void {
    this.persistence.saveSession(this.session);
    this.persistence.updateContextSummary(this.session);
    this.isDirty = false;
    this.emit({ type: 'session_saved', sessionId: this.session.sessionId });
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      if (this.isDirty) {
        this.save();
      }
    }, this.config.autoSaveIntervalMs);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Generate context dump for LLM consumption
   */
  getContextDump(): string {
    return this.persistence.generateContextDump(this.session);
  }

  /**
   * Get the scratchpad content
   */
  getScratchpad(): string {
    return this.persistence.getScratchpad();
  }

  /**
   * Append to the scratchpad
   */
  appendToScratchpad(note: string): void {
    this.persistence.appendToScratchpad(note);
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Register an event handler
   */
  on(handler: TodoEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: TodoEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[TodoManager] Event handler error:', error);
      }
    }
  }

  // ==========================================================================
  // Metrics Access
  // ==========================================================================

  /**
   * Get current metrics
   */
  getMetrics(): TodoMetrics {
    return { ...this.metrics };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Generate active form from imperative content
   * "Fix the bug" -> "Fixing the bug"
   * "Add tests" -> "Adding tests"
   */
  private generateActiveForm(content: string): string {
    const words = content.split(' ');
    if (words.length === 0) return content;

    const verb = words[0].toLowerCase();
    let activeVerb = verb;

    // Common verb transformations
    const verbMappings: Record<string, string> = {
      add: 'Adding',
      fix: 'Fixing',
      create: 'Creating',
      implement: 'Implementing',
      update: 'Updating',
      delete: 'Deleting',
      remove: 'Removing',
      refactor: 'Refactoring',
      test: 'Testing',
      write: 'Writing',
      read: 'Reading',
      review: 'Reviewing',
      check: 'Checking',
      validate: 'Validating',
      verify: 'Verifying',
      deploy: 'Deploying',
      build: 'Building',
      run: 'Running',
      debug: 'Debugging',
      optimize: 'Optimizing',
      configure: 'Configuring',
      setup: 'Setting up',
      install: 'Installing',
      migrate: 'Migrating',
      integrate: 'Integrating',
      analyze: 'Analyzing',
      design: 'Designing',
      document: 'Documenting',
    };

    if (verbMappings[verb]) {
      activeVerb = verbMappings[verb];
    } else if (verb.endsWith('e')) {
      activeVerb = verb.slice(0, -1) + 'ing';
      activeVerb = activeVerb.charAt(0).toUpperCase() + activeVerb.slice(1);
    } else {
      activeVerb = verb + 'ing';
      activeVerb = activeVerb.charAt(0).toUpperCase() + activeVerb.slice(1);
    }

    words[0] = activeVerb;
    return words.join(' ');
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stopAutoSave();
    if (this.isDirty) {
      this.save();
    }
  }
}

/**
 * Create a TodoManager instance with default configuration
 */
export function createTodoManager(
  projectRoot: string,
  config?: Partial<TodoManagerConfig>,
): TodoManager {
  return new TodoManager(projectRoot, config);
}
