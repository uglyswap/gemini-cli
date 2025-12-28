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
import type { ContextManager} from './context-manager.js';
import { createContextManager } from './context-manager.js';
import { DEFAULT_TODO_CONFIG } from './types.js';

describe('ContextManager', () => {
  let todoManager: TodoManager;
  let contextManager: ContextManager;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-manager-test-'));
    todoManager = createTodoManager(testDir, { autoSaveIntervalMs: 0 });
    contextManager = createContextManager(
      todoManager,
      DEFAULT_TODO_CONFIG.compaction,
    );
  });

  afterEach(() => {
    todoManager.dispose();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Context Generation', () => {
    it('should generate context injection', () => {
      todoManager.createTodo({ content: 'Test task', priority: 8 });
      todoManager.recordDecision('Test decision', 'Test rationale');

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.systemContext).toBeDefined();
      expect(injection.humanReadable).toBeDefined();
      expect(injection.estimatedTokens).toBeGreaterThan(0);
      expect(injection.systemContext).toContain('<planning-context>');
    });

    it('should generate minimal reminder', () => {
      const todo = todoManager.createTodo({ content: 'Active task' });
      todoManager.startTodo(todo.id);

      const reminder = contextManager.generateMinimalReminder();

      expect(reminder).toContain('<planning-context>');
      expect(reminder).toContain('Active task');
      expect(reminder).toContain('<progress');
    });

    it('should generate context snapshot', () => {
      const todo = todoManager.createTodo({
        content: 'In progress task',
        priority: 7,
      });
      todoManager.startTodo(todo.id);
      todoManager.addFileToTodo(todo.id, '/path/to/file.ts');
      todoManager.recordDecision('Important decision', 'Good reason');

      const snapshot = contextManager.generateContextSnapshot();

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.activeTaskSummary).toContain('In progress task');
      expect(snapshot.criticalDecisions).toContain('Important decision');
      expect(snapshot.activeFiles).toContain('/path/to/file.ts');
    });
  });

  describe('Context Rating', () => {
    it('should rate in-progress tasks as critical', () => {
      const todo = todoManager.createTodo({ content: 'Active task' });
      todoManager.startTodo(todo.id);

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.systemContext).toContain('importance="critical"');
    });

    it('should rate blocked tasks as high importance', () => {
      const todo = todoManager.createTodo({ content: 'Blocked task' });
      todoManager.blockTodo(todo.id, ['Blocker reason']);

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.systemContext).toContain('importance="high"');
    });

    it('should rate high priority pending tasks as high importance', () => {
      todoManager.createTodo({ content: 'High priority', priority: 9 });

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.systemContext).toContain('importance="high"');
    });
  });

  describe('Token Budget Selection', () => {
    it('should respect token budget', () => {
      // Create many todos to exceed budget
      for (let i = 0; i < 50; i++) {
        todoManager.createTodo({
          content: `Task ${i} with some extra content to increase token count significantly`,
          priority: Math.floor(Math.random() * 10) + 1,
        });
      }

      const injection = contextManager.generateContextInjection(500);

      // Should be limited to around 500 tokens
      expect(injection.estimatedTokens).toBeLessThan(1000);
    });

    it('should always include critical items even if over budget', () => {
      // Create a critical (in-progress) task
      const critical = todoManager.createTodo({
        content: 'Critical active task',
      });
      todoManager.startTodo(critical.id);

      // Create many low priority tasks
      for (let i = 0; i < 20; i++) {
        todoManager.createTodo({
          content: `Low priority task ${i} with content`,
          priority: 1,
        });
      }

      const injection = contextManager.generateContextInjection(100); // Very small budget

      // Critical task should still be included
      expect(injection.systemContext).toContain('Critical active task');
    });
  });

  describe('Formatting', () => {
    it('should format as XML for system prompts', () => {
      todoManager.createTodo({ content: 'Test task' });
      todoManager.recordDecision('Test decision', 'Rationale');

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.systemContext).toContain('<planning-context>');
      expect(injection.systemContext).toContain('<todos>');
      expect(injection.systemContext).toContain('</todos>');
      expect(injection.systemContext).toContain('<recent-decisions>');
      expect(injection.systemContext).toContain('</planning-context>');
    });

    it('should format as Markdown for human display', () => {
      todoManager.createTodo({ content: 'Test task', priority: 8 });

      const injection = contextManager.generateContextInjection(4000);

      expect(injection.humanReadable).toContain('## Planning Context');
      expect(injection.humanReadable).toContain('### Tasks');
    });
  });

  describe('Pre-Compaction Snapshot', () => {
    it('should create comprehensive pre-compaction snapshot', () => {
      const active = todoManager.createTodo({
        content: 'Active task',
        priority: 9,
      });
      todoManager.startTodo(active.id);
      todoManager.addFileToTodo(active.id, '/path/to/file.ts');

      const blocked = todoManager.createTodo({ content: 'Blocked task' });
      todoManager.blockTodo(blocked.id, ['Missing dependency']);

      todoManager.createTodo({ content: 'Pending task 1' });
      todoManager.createTodo({ content: 'Pending task 2' });

      todoManager.recordDecision('Key decision', 'Important rationale');

      const snapshot = contextManager.createPreCompactionSnapshot();

      expect(snapshot).toContain('# Pre-Compaction Snapshot');
      expect(snapshot).toContain('Active Task');
      expect(snapshot).toContain('Active task');
      expect(snapshot).toContain('Pending Tasks');
      expect(snapshot).toContain('Critical Decisions');
      expect(snapshot).toContain('Key decision');
      expect(snapshot).toContain('Active Files');
      expect(snapshot).toContain('/path/to/file.ts');
      expect(snapshot).toContain('Blockers');
      expect(snapshot).toContain('Missing dependency');
    });
  });

  describe('Context Validation', () => {
    it('should detect orphaned dependencies', () => {
      const todo1 = todoManager.createTodo({ content: 'First task' });
      todoManager.createTodo({
        content: 'Second task',
        dependencies: [todo1.id, 'non-existent-id'],
      });

      const validation = contextManager.validateContextIntegrity();

      expect(validation.valid).toBe(false);
      expect(
        validation.issues.some((i) => i.includes('missing dependency')),
      ).toBe(true);
    });

    it('should detect too many blocked tasks', () => {
      for (let i = 0; i < 10; i++) {
        const todo = todoManager.createTodo({ content: `Blocked ${i}` });
        todoManager.blockTodo(todo.id, ['Some blocker']);
      }

      const validation = contextManager.validateContextIntegrity();

      expect(validation.valid).toBe(false);
      expect(validation.issues.some((i) => i.includes('blocked'))).toBe(true);
    });

    it('should pass validation for healthy context', () => {
      todoManager.createTodo({ content: 'Normal task 1' });
      todoManager.createTodo({ content: 'Normal task 2' });

      const validation = contextManager.validateContextIntegrity();

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });
});
