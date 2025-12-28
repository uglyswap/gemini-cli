/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { TodoManager} from '../todo-manager.js';
import { createTodoManager } from '../todo-manager.js';
import type { ContextManager} from '../context-manager.js';
import { createContextManager } from '../context-manager.js';
import type {
  CompactionHooksManager} from './compaction-hooks.js';
import {
  createCompactionHooksManager,
  createNotificationHook,
  createCriticalTaskGuardHook,
  createMinTaskPreservationHook,
} from './compaction-hooks.js';
import { DEFAULT_TODO_CONFIG } from '../types.js';

describe('CompactionHooksManager', () => {
  let todoManager: TodoManager;
  let contextManager: ContextManager;
  let hooksManager: CompactionHooksManager;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-hooks-test-'));
    todoManager = createTodoManager(testDir, { autoSaveIntervalMs: 0 });
    contextManager = createContextManager(
      todoManager,
      DEFAULT_TODO_CONFIG.compaction,
    );
    hooksManager = createCompactionHooksManager(
      todoManager,
      contextManager,
      DEFAULT_TODO_CONFIG.compaction,
    );
  });

  afterEach(() => {
    todoManager.dispose();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Hook Registration', () => {
    it('should register and execute pre-compact hooks', async () => {
      const executed: string[] = [];

      hooksManager.registerPreCompactHook('test-hook-1', async () => {
        executed.push('hook-1');
        return { success: true, message: 'Hook 1 executed' };
      });

      hooksManager.registerPreCompactHook('test-hook-2', async () => {
        executed.push('hook-2');
        return { success: true, message: 'Hook 2 executed' };
      });

      const result = await hooksManager.executePreCompactHooks();

      expect(result.success).toBe(true);
      expect(executed).toContain('hook-1');
      expect(executed).toContain('hook-2');
    });

    it('should execute hooks in priority order', async () => {
      const executed: string[] = [];

      hooksManager.registerPreCompactHook(
        'low-priority',
        async () => {
          executed.push('low');
          return { success: true, message: 'Low priority' };
        },
        100, // Low priority (higher number)
      );

      hooksManager.registerPreCompactHook(
        'high-priority',
        async () => {
          executed.push('high');
          return { success: true, message: 'High priority' };
        },
        1, // High priority (lower number)
      );

      await hooksManager.executePreCompactHooks();

      expect(executed[0]).toBe('high');
      expect(executed[1]).toBe('low');
    });

    it('should unregister hooks', async () => {
      const executed: string[] = [];

      hooksManager.registerPreCompactHook('removable', async () => {
        executed.push('removable');
        return { success: true, message: 'Executed' };
      });

      hooksManager.unregisterPreCompactHook('removable');

      await hooksManager.executePreCompactHooks();

      expect(executed).not.toContain('removable');
    });
  });

  describe('Hook Abort Functionality', () => {
    it('should allow hooks to abort compaction', async () => {
      hooksManager.registerPreCompactHook('aborter', async (ctx) => {
        ctx.abort();
        return { success: false, message: 'Aborted!' };
      });

      const result = await hooksManager.executePreCompactHooks();

      expect(result.aborted).toBe(true);
    });

    it('should skip remaining hooks after abort', async () => {
      const executed: string[] = [];

      hooksManager.registerPreCompactHook(
        'first',
        async (ctx) => {
          executed.push('first');
          ctx.abort();
          return { success: true, message: 'First and abort' };
        },
        1,
      );

      hooksManager.registerPreCompactHook(
        'second',
        async () => {
          executed.push('second');
          return { success: true, message: 'Second' };
        },
        2,
      );

      await hooksManager.executePreCompactHooks();

      expect(executed).toContain('first');
      expect(executed).not.toContain('second');
    });
  });

  describe('Hook Data Passing', () => {
    it('should pass data from pre-compact to post-compact hooks', async () => {
      let receivedData: Record<string, unknown> = {};

      hooksManager.registerPreCompactHook('setter', async (ctx) => {
        ctx.setData('testKey', 'testValue');
        ctx.setData('count', 42);
        return { success: true, message: 'Data set' };
      });

      hooksManager.registerPostCompactHook('receiver', async (ctx) => {
        receivedData = ctx.data;
        return { success: true, message: 'Data received' };
      });

      // Create and complete some todos for compaction
      const todo = todoManager.createTodo({ content: 'Completed task' });
      todoManager.completeTodo(todo.id);

      await hooksManager.executeCompactionWithHooks();

      expect(receivedData['testKey']).toBe('testValue');
      expect(receivedData['count']).toBe(42);
    });
  });

  describe('Full Compaction Cycle', () => {
    it('should execute full compaction cycle with hooks', async () => {
      const phases: string[] = [];

      hooksManager.registerPreCompactHook('pre', async () => {
        phases.push('pre');
        return { success: true, message: 'Pre executed' };
      });

      hooksManager.registerPostCompactHook('post', async () => {
        phases.push('post');
        return { success: true, message: 'Post executed' };
      });

      // Create completed todos
      for (let i = 0; i < 5; i++) {
        const todo = todoManager.createTodo({ content: `Task ${i}` });
        todoManager.completeTodo(todo.id);
      }

      const result = await hooksManager.executeCompactionWithHooks();

      expect(result.success).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.compactionInfo).toBeDefined();
      expect(result.compactionInfo?.archivedItems).toHaveLength(5);
      expect(phases).toEqual(['pre', 'post']);
    });

    it('should not execute post hooks if aborted', async () => {
      const phases: string[] = [];

      hooksManager.registerPreCompactHook('aborter', async (ctx) => {
        phases.push('pre');
        ctx.abort();
        return { success: false, message: 'Aborted' };
      });

      hooksManager.registerPostCompactHook('post', async () => {
        phases.push('post');
        return { success: true, message: 'Post executed' };
      });

      const result = await hooksManager.executeCompactionWithHooks();

      expect(result.aborted).toBe(true);
      expect(phases).not.toContain('post');
    });
  });

  describe('Error Handling', () => {
    it('should handle hook errors gracefully', async () => {
      hooksManager.registerPreCompactHook('error-hook', async () => {
        throw new Error('Hook failed!');
      });

      hooksManager.registerPreCompactHook('after-error', async () => ({ success: true, message: 'Continued' }));

      const result = await hooksManager.executePreCompactHooks();

      // Should continue executing after error
      const errorResult = result.results.find((r) => r.name === 'error-hook');
      expect(errorResult?.result.success).toBe(false);
      expect(errorResult?.result.error).toBeDefined();
    });
  });

  describe('Built-in Hooks', () => {
    it('should execute default validation hook', async () => {
      const result = await hooksManager.executePreCompactHooks();

      const validateResult = result.results.find(
        (r) => r.name === 'validate-context',
      );
      expect(validateResult).toBeDefined();
      expect(validateResult?.result.success).toBe(true);
    });

    it('should execute default snapshot hook', async () => {
      const result = await hooksManager.executePreCompactHooks();

      const snapshotResult = result.results.find(
        (r) => r.name === 'save-snapshot',
      );
      expect(snapshotResult).toBeDefined();
      expect(snapshotResult?.result.success).toBe(true);
      expect(result.data['preCompactSnapshot']).toBeDefined();
    });
  });

  describe('Custom Hook Factories', () => {
    describe('createNotificationHook', () => {
      it('should send notification before compaction', async () => {
        let notificationSent = '';

        const notifyHook = createNotificationHook(async (message) => {
          notificationSent = message;
        });

        hooksManager.registerPreCompactHook('notify', notifyHook);

        todoManager.createTodo({ content: 'Task 1' });
        const completed = todoManager.createTodo({ content: 'Task 2' });
        todoManager.completeTodo(completed.id);

        await hooksManager.executePreCompactHooks();

        expect(notificationSent).toContain('Compaction starting');
        expect(notificationSent).toContain('1/2');
      });
    });

    describe('createCriticalTaskGuardHook', () => {
      it('should abort compaction if critical task is in progress', async () => {
        const guardHook = createCriticalTaskGuardHook(9);
        hooksManager.registerPreCompactHook('guard', guardHook, 1);

        const critical = todoManager.createTodo({
          content: 'Critical task',
          priority: 10,
        });
        todoManager.startTodo(critical.id);

        const result = await hooksManager.executePreCompactHooks();

        expect(result.aborted).toBe(true);
        const guardResult = result.results.find((r) => r.name === 'guard');
        expect(guardResult?.result.success).toBe(false);
        expect(guardResult?.result.message).toContain('Critical task');
      });

      it('should allow compaction if no critical task is active', async () => {
        const guardHook = createCriticalTaskGuardHook(9);
        hooksManager.registerPreCompactHook('guard', guardHook, 1);

        const normal = todoManager.createTodo({
          content: 'Normal task',
          priority: 5,
        });
        todoManager.startTodo(normal.id);

        const result = await hooksManager.executePreCompactHooks();

        expect(result.aborted).toBe(false);
      });
    });

    describe('createMinTaskPreservationHook', () => {
      it('should log when below minimum pending tasks', async () => {
        const minHook = createMinTaskPreservationHook(10);
        hooksManager.registerPreCompactHook('min-check', minHook);

        todoManager.createTodo({ content: 'Task 1' });
        todoManager.createTodo({ content: 'Task 2' });

        const result = await hooksManager.executePreCompactHooks();

        const minResult = result.results.find((r) => r.name === 'min-check');
        expect(minResult?.result.success).toBe(true);
        expect(minResult?.result.message).toContain('below minimum');
      });
    });
  });

  describe('Auto-Compaction Check', () => {
    it('should not compact when not needed', async () => {
      const compacted = await hooksManager.checkAndCompact();
      expect(compacted).toBe(false);
    });

    it('should skip compaction when disabled', async () => {
      const disabledManager = createCompactionHooksManager(
        todoManager,
        contextManager,
        { ...DEFAULT_TODO_CONFIG.compaction, enabled: false },
      );

      const compacted = await disabledManager.checkAndCompact();
      expect(compacted).toBe(false);
    });
  });
});
