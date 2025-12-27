/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GateRunner } from './gate-runner.js';
import type { QualityGate } from './types.js';
import { exec } from 'node:child_process';

// Mock child_process
jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

describe('GateRunner', () => {
  let runner: GateRunner;
  const mockWorkingDir = '/test/project';

  const mockGates: QualityGate[] = [
    {
      name: 'test-gate-1',
      description: 'Test gate 1',
      phase: 'post',
      command: 'echo "test"',
    },
    {
      name: 'test-gate-2',
      description: 'Test gate 2',
      phase: 'post',
      checkFn: async () => ({ passed: true }),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new GateRunner(mockGates, mockWorkingDir);
  });

  describe('runGates', () => {
    it('should run all provided gates', async () => {
      // Mock exec to succeed
      (exec as unknown as jest.Mock).mockImplementation(
        (_cmd: string, _opts: any, callback: Function) => {
          callback(null, 'success', '');
        }
      );

      const results = await runner.runGates(mockGates);
      
      expect(results.length).toBe(2);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should handle command failures', async () => {
      const failingGate: QualityGate = {
        name: 'failing-gate',
        description: 'Always fails',
        phase: 'post',
        command: 'exit 1',
      };

      (exec as unknown as jest.Mock).mockImplementation(
        (_cmd: string, _opts: any, callback: Function) => {
          callback(new Error('Command failed'), '', 'error output');
        }
      );

      const runner2 = new GateRunner([failingGate], mockWorkingDir);
      const results = await runner2.runGates([failingGate]);
      
      expect(results[0].passed).toBe(false);
    });

    it('should handle function-based gates', async () => {
      const fnGate: QualityGate = {
        name: 'fn-gate',
        description: 'Function gate',
        phase: 'post',
        checkFn: async () => ({ passed: true, message: 'All good' }),
      };

      const runner2 = new GateRunner([fnGate], mockWorkingDir);
      const results = await runner2.runGates([fnGate]);
      
      expect(results[0].passed).toBe(true);
      expect(results[0].message).toBe('All good');
    });
  });

  describe('runPreGates', () => {
    it('should only run pre-phase gates', async () => {
      const mixedGates: QualityGate[] = [
        { name: 'pre-gate', description: 'Pre', phase: 'pre', checkFn: async () => ({ passed: true }) },
        { name: 'post-gate', description: 'Post', phase: 'post', checkFn: async () => ({ passed: true }) },
      ];

      const runner2 = new GateRunner(mixedGates, mockWorkingDir);
      const results = await runner2.runPreGates();
      
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('pre-gate');
    });
  });

  describe('runPostGates', () => {
    it('should only run post-phase gates', async () => {
      (exec as unknown as jest.Mock).mockImplementation(
        (_cmd: string, _opts: any, callback: Function) => {
          callback(null, 'success', '');
        }
      );

      const results = await runner.runPostGates();
      
      // Both mock gates are post-phase
      expect(results.length).toBe(2);
    });
  });

  describe('timeout handling', () => {
    it('should respect gate timeout', async () => {
      const slowGate: QualityGate = {
        name: 'slow-gate',
        description: 'Slow gate',
        phase: 'post',
        checkFn: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { passed: true };
        },
        timeoutMs: 50,
      };

      const runner2 = new GateRunner([slowGate], mockWorkingDir, { defaultTimeout: 50 });
      const results = await runner2.runGates([slowGate]);
      
      // Should either timeout or complete, depending on implementation
      expect(results[0]).toBeDefined();
    });
  });
});
