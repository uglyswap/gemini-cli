/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { TodoManager} from './todo-manager.js';
import { createTodoManager } from './todo-manager.js';
import type { TodoEvent } from './types.js';

describe('TodoManager', () => {
  let todoManager: TodoManager;
  let testDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-manager-test-'));
    todoManager = createTodoManager(testDir, {
      autoSaveIntervalMs: 0, // Disable auto-save for tests
    });
  });

  afterEach(() => {
    todoManager.dispose();
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Todo CRUD Operations', () => {
    it('should create a todo with auto-generated activeForm', () => {
      const todo = todoManager.createTodo({
        content: 'Fix the authentication bug',
      });

      expect(todo.id).toBeDefined();
      expect(todo.content).toBe('Fix the authentication bug');
      expect(todo.activeForm).toBe('Fixing the authentication bug');
      expect(todo.status).toBe('pending');
      expect(todo.priority).toBe(5); // Default priority
    });

    it('should create a todo with custom options', () => {
      const todo = todoManager.createTodo({
        content: 'Implement new feature',
        activeForm: 'Implementing custom feature',
        priority: 8,
        assignedAgentId: 'test-agent',
        tags: ['feature', 'high-priority'],
        notes: 'This is important',
      });

      expect(todo.activeForm).toBe('Implementing custom feature');
      expect(todo.priority).toBe(8);
      expect(todo.assignedAgentId).toBe('test-agent');
      expect(todo.context.tags).toContain('feature');
      expect(todo.context.notes).toBe('This is important');
    });

    it('should create multiple todos', () => {
      const todos = todoManager.createTodos([
        { content: 'Task 1' },
        { content: 'Task 2' },
        { content: 'Task 3' },
      ]);

      expect(todos).toHaveLength(3);
      expect(todos[0].content).toBe('Task 1');
      expect(todos[2].content).toBe('Task 3');
    });

    it('should find a todo by ID', () => {
      const created = todoManager.createTodo({ content: 'Find me' });
      const found = todoManager.findTodo(created.id);

      expect(found).toBeDefined();
      expect(found?.content).toBe('Find me');
    });

    it('should return undefined for non-existent todo', () => {
      const found = todoManager.findTodo('non-existent-id');
      expect(found).toBeUndefined();
    });

    it('should update a todo', () => {
      const todo = todoManager.createTodo({ content: 'Update me' });

      const updated = todoManager.updateTodo(todo.id, {
        status: 'in_progress',
        priority: 9,
        notes: 'Updated notes',
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('in_progress');
      expect(updated?.priority).toBe(9);
      expect(updated?.context.notes).toBe('Updated notes');
      expect(updated?.timestamps.started).toBeDefined();
    });

    it('should delete a todo', () => {
      const todo = todoManager.createTodo({ content: 'Delete me' });
      expect(todoManager.findTodo(todo.id)).toBeDefined();

      const deleted = todoManager.deleteTodo(todo.id);
      expect(deleted).toBe(true);
      expect(todoManager.findTodo(todo.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent todo', () => {
      const deleted = todoManager.deleteTodo('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Status Transitions', () => {
    it('should start a todo', () => {
      const todo = todoManager.createTodo({ content: 'Start me' });

      const started = todoManager.startTodo(todo.id, 'test-agent');

      expect(started?.status).toBe('in_progress');
      expect(started?.assignedAgentId).toBe('test-agent');
      expect(started?.timestamps.started).toBeDefined();
    });

    it('should complete a todo', () => {
      const todo = todoManager.createTodo({ content: 'Complete me' });
      todoManager.startTodo(todo.id);

      const completed = todoManager.completeTodo(todo.id, {
        success: true,
        output: 'Task completed successfully',
        qualityScore: 95,
      });

      expect(completed?.status).toBe('completed');
      expect(completed?.timestamps.completed).toBeDefined();
      expect(completed?.result?.success).toBe(true);
      expect(completed?.result?.qualityScore).toBe(95);
    });

    it('should block a todo', () => {
      const todo = todoManager.createTodo({ content: 'Block me' });

      const blocked = todoManager.blockTodo(todo.id, [
        'Missing dependency',
        'Waiting for approval',
      ]);

      expect(blocked?.status).toBe('blocked');
      expect(blocked?.context.blockers).toContain('Missing dependency');
      expect(blocked?.context.blockers).toContain('Waiting for approval');
    });
  });

  describe('Context Management', () => {
    it('should add files to todo context', () => {
      const todo = todoManager.createTodo({ content: 'Add files' });

      todoManager.addFileToTodo(todo.id, '/path/to/file1.ts');
      todoManager.addFileToTodo(todo.id, '/path/to/file2.ts');
      todoManager.addFileToTodo(todo.id, '/path/to/file1.ts'); // Duplicate

      const updated = todoManager.findTodo(todo.id);
      expect(updated?.context.filesInvolved).toHaveLength(2);
      expect(updated?.context.filesInvolved).toContain('/path/to/file1.ts');
    });

    it('should add decisions to todo context', () => {
      const todo = todoManager.createTodo({ content: 'Make decisions' });

      todoManager.addDecisionToTodo(todo.id, 'Chose approach A');
      todoManager.addDecisionToTodo(todo.id, 'Used library X');

      const updated = todoManager.findTodo(todo.id);
      expect(updated?.context.decisionsMade).toHaveLength(2);
      expect(updated?.context.decisionsMade).toContain('Chose approach A');
    });
  });

  describe('Query Operations', () => {
    beforeEach(() => {
      todoManager.createTodo({ content: 'High priority', priority: 9 });
      todoManager.createTodo({ content: 'Medium priority', priority: 5 });
      todoManager.createTodo({ content: 'Low priority', priority: 2 });

      const inProgress = todoManager.createTodo({
        content: 'In progress task',
      });
      todoManager.startTodo(inProgress.id);

      const completed = todoManager.createTodo({ content: 'Completed task' });
      todoManager.completeTodo(completed.id);
    });

    it('should get all todos', () => {
      const all = todoManager.getAllTodos();
      expect(all).toHaveLength(5);
    });

    it('should filter todos by status', () => {
      const pending = todoManager.getTodos({ status: 'pending' });
      expect(pending).toHaveLength(3);

      const inProgress = todoManager.getTodos({ status: 'in_progress' });
      expect(inProgress).toHaveLength(1);
    });

    it('should filter todos by multiple statuses', () => {
      const activeStatuses = todoManager.getTodos({
        status: ['pending', 'in_progress'],
      });
      expect(activeStatuses).toHaveLength(4);
    });

    it('should sort todos by priority', () => {
      const sorted = todoManager.getTodos(
        { status: 'pending' },
        { field: 'priority', direction: 'desc' },
      );

      expect(sorted[0].content).toBe('High priority');
      expect(sorted[2].content).toBe('Low priority');
    });

    it('should get active todo', () => {
      const active = todoManager.getActiveTodo();
      expect(active?.content).toBe('In progress task');
    });

    it('should get next todo (highest priority pending)', () => {
      const next = todoManager.getNextTodo();
      expect(next?.content).toBe('High priority');
    });

    it('should get summary statistics', () => {
      const summary = todoManager.getSummary();

      expect(summary.total).toBe(5);
      expect(summary.pending).toBe(3);
      expect(summary.inProgress).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.blocked).toBe(0);
    });
  });

  describe('Dependencies', () => {
    it('should respect dependencies when getting next todo', () => {
      const first = todoManager.createTodo({
        content: 'First task',
        priority: 5,
      });
      todoManager.createTodo({
        content: 'Second task',
        priority: 10, // Higher priority but depends on first
        dependencies: [first.id],
      });

      // Next should be first task since second depends on it
      const next = todoManager.getNextTodo();
      expect(next?.content).toBe('First task');

      // Complete first task
      todoManager.completeTodo(first.id);

      // Now second task should be next
      const nextAfter = todoManager.getNextTodo();
      expect(nextAfter?.content).toBe('Second task');
    });
  });

  describe('Decisions', () => {
    it('should record a decision', () => {
      const todo = todoManager.createTodo({ content: 'Task with decision' });

      const decision = todoManager.recordDecision(
        'Use TypeScript',
        'Better type safety',
        ['JavaScript', 'Dart'],
        todo.id,
      );

      expect(decision.decision).toBe('Use TypeScript');
      expect(decision.rationale).toBe('Better type safety');
      expect(decision.alternatives).toContain('JavaScript');
      expect(decision.relatedTodoId).toBe(todo.id);
    });

    it('should get recent decisions', () => {
      todoManager.recordDecision('Decision 1', 'Reason 1');
      todoManager.recordDecision('Decision 2', 'Reason 2');
      todoManager.recordDecision('Decision 3', 'Reason 3');

      const recent = todoManager.getRecentDecisions(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].decision).toBe('Decision 2');
      expect(recent[1].decision).toBe('Decision 3');
    });
  });

  describe('Session Management', () => {
    it('should set task description', () => {
      todoManager.setTaskDescription('Implement new feature');
      // This should persist with save
      todoManager.save();

      // Create new manager to verify persistence
      const newManager = createTodoManager(testDir, { autoSaveIntervalMs: 0 });
      const dump = newManager.getContextDump();
      expect(dump).toContain('Implement new feature');
      newManager.dispose();
    });

    it('should set and get important values', () => {
      todoManager.setImportantValue('key1', 'value1');
      todoManager.setImportantValue('key2', 'value2');

      expect(todoManager.getImportantValue('key1')).toBe('value1');
      expect(todoManager.getImportantValue('key2')).toBe('value2');
      expect(todoManager.getImportantValue('unknown')).toBeUndefined();
    });

    it('should start new session and archive current', () => {
      todoManager.createTodo({ content: 'Old session task' });
      const oldSessionId = todoManager.getSessionId();

      todoManager.startNewSession();

      const newSessionId = todoManager.getSessionId();
      expect(newSessionId).not.toBe(oldSessionId);
      expect(todoManager.getAllTodos()).toHaveLength(0);
    });
  });

  describe('Compaction', () => {
    it('should estimate context usage', () => {
      // Empty session should have low usage
      const emptyUsage = todoManager.estimateContextUsage();
      expect(emptyUsage).toBeLessThan(0.1);

      // Add many todos to increase usage
      for (let i = 0; i < 50; i++) {
        todoManager.createTodo({
          content: `Task ${i} with some longer content to increase token count`,
        });
      }

      const usage = todoManager.estimateContextUsage();
      expect(usage).toBeGreaterThan(emptyUsage);
    });

    it('should get compaction status', () => {
      const status = todoManager.getCompactionStatus();

      expect(status.contextUsage).toBeGreaterThanOrEqual(0);
      expect(status.contextUsage).toBeLessThanOrEqual(1);
      expect(typeof status.warningTriggered).toBe('boolean');
      expect(typeof status.compactionNeeded).toBe('boolean');
      expect(Array.isArray(status.recommendations)).toBe(true);
    });

    it('should perform compaction and archive completed todos', () => {
      // Create and complete several todos
      for (let i = 0; i < 10; i++) {
        const todo = todoManager.createTodo({ content: `Task ${i}` });
        todoManager.completeTodo(todo.id);
      }

      expect(todoManager.getAllTodos()).toHaveLength(10);

      const compactionInfo = todoManager.performCompaction();

      expect(compactionInfo.compactionCount).toBe(1);
      expect(compactionInfo.archivedItems).toHaveLength(10);
      expect(todoManager.getAllTodos()).toHaveLength(0);
    });
  });

  describe('Event Handling', () => {
    it('should emit events for todo operations', () => {
      const events: TodoEvent[] = [];
      const unsubscribe = todoManager.on((event) => events.push(event));

      const todo = todoManager.createTodo({ content: 'Event test' });
      todoManager.startTodo(todo.id);
      todoManager.completeTodo(todo.id);

      expect(events).toHaveLength(4); // created, updated (start), updated (complete), completed
      expect(events[0].type).toBe('todo_created');
      expect(events[3].type).toBe('todo_completed');

      unsubscribe();
    });

    it('should allow unsubscribing from events', () => {
      const events: TodoEvent[] = [];
      const unsubscribe = todoManager.on((event) => events.push(event));

      todoManager.createTodo({ content: 'First' });
      expect(events).toHaveLength(1);

      unsubscribe();

      todoManager.createTodo({ content: 'Second' });
      expect(events).toHaveLength(1); // No new events after unsubscribe
    });
  });

  describe('Active Form Generation', () => {
    it('should generate correct active forms for common verbs', () => {
      const cases: Array<{ content: string; expected: string }> = [
        { content: 'Add new feature', expected: 'Adding new feature' },
        { content: 'Fix the bug', expected: 'Fixing the bug' },
        { content: 'Create component', expected: 'Creating component' },
        { content: 'Update documentation', expected: 'Updating documentation' },
        { content: 'Delete old files', expected: 'Deleting old files' },
        { content: 'Refactor code', expected: 'Refactoring code' },
        { content: 'Test functionality', expected: 'Testing functionality' },
        { content: 'Review changes', expected: 'Reviewing changes' },
        { content: 'Debug issue', expected: 'Debugging issue' },
        { content: 'Setup environment', expected: 'Setting up environment' },
      ];

      for (const { content, expected } of cases) {
        const todo = todoManager.createTodo({ content });
        expect(todo.activeForm).toBe(expected);
        todoManager.deleteTodo(todo.id);
      }
    });
  });

  describe('Persistence', () => {
    it('should save and load session', () => {
      todoManager.createTodo({ content: 'Persistent task' });
      todoManager.recordDecision('Persist decision', 'Test persistence');
      todoManager.save();

      // Create new manager to verify persistence
      const newManager = createTodoManager(testDir, { autoSaveIntervalMs: 0 });
      const todos = newManager.getAllTodos();

      expect(todos).toHaveLength(1);
      expect(todos[0].content).toBe('Persistent task');

      const decisions = newManager.getRecentDecisions(10);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('Persist decision');

      newManager.dispose();
    });
  });
});
