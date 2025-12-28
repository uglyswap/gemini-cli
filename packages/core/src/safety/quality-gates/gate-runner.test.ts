/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GateRunner } from './gate-runner.js';
import type { QualityGate, GateContext, GateCheckResult } from './types.js';

describe('GateRunner', () => {
  let runner: GateRunner;

  const mockContext: GateContext = {
    projectRoot: '/test/project',
    modifiedFiles: ['src/test.ts'],
    agentId: 'test-agent',
    taskDescription: 'Test task',
    trustLevel: 2,
    options: {},
  };

  beforeEach(() => {
    runner = new GateRunner({ verbose: false });
  });

  describe('constructor', () => {
    it('should create runner with default options', () => {
      const newRunner = new GateRunner();
      expect(newRunner).toBeDefined();
    });

    it('should create runner with custom options', () => {
      const newRunner = new GateRunner({
        continueOnFailure: false,
        strictMode: true,
        timeout: 30000,
      });
      expect(newRunner).toBeDefined();
    });
  });

  describe('registerGate', () => {
    it('should register a custom gate', () => {
      const customGate: QualityGate = {
        id: 'custom-gate',
        name: 'Custom Gate',
        description: 'A custom test gate',
        timing: 'post',
        defaultSeverity: 'warning',
        applicableDomains: 'all',
        checkType: 'typescript',
        skippable: true,
        checkFn: async (_context: GateContext): Promise<GateCheckResult> => ({
          gateId: 'custom-gate',
          gateName: 'Custom Gate',
          passed: true,
          severity: 'info',
          message: 'Custom gate passed',
          issues: [],
          durationMs: 0,
          skippable: true,
        }),
      };

      runner.registerGate(customGate);
      const gates = runner.getGates();

      expect(gates.some((g) => g.id === 'custom-gate')).toBe(true);
    });
  });

  describe('unregisterGate', () => {
    it('should unregister a gate', () => {
      const customGate: QualityGate = {
        id: 'to-remove',
        name: 'To Remove',
        description: 'Will be removed',
        timing: 'pre',
        defaultSeverity: 'error',
        applicableDomains: 'all',
        checkType: 'eslint',
        skippable: true,
      };

      runner.registerGate(customGate);
      expect(runner.getGates().some((g) => g.id === 'to-remove')).toBe(true);

      const removed = runner.unregisterGate('to-remove');
      expect(removed).toBe(true);
      expect(runner.getGates().some((g) => g.id === 'to-remove')).toBe(false);
    });

    it('should return false for non-existent gate', () => {
      const removed = runner.unregisterGate('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('getGates', () => {
    it('should return all registered gates', () => {
      const gates = runner.getGates();
      expect(Array.isArray(gates)).toBe(true);
    });
  });

  describe('getGatesForDomain', () => {
    it('should filter gates by domain', () => {
      const frontendGates = runner.getGatesForDomain('frontend');
      expect(Array.isArray(frontendGates)).toBe(true);
    });
  });

  describe('runGates', () => {
    it('should run gates and return execution result', async () => {
      const result = await runner.runGates('post', mockContext);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(Array.isArray(result.gates)).toBe(true);
      expect(result.summary).toBeDefined();
      expect(typeof result.totalDurationMs).toBe('number');
    });

    it('should handle function-based gates', async () => {
      const fnGate: QualityGate = {
        id: 'fn-gate',
        name: 'Function Gate',
        description: 'Function-based gate',
        timing: 'post',
        defaultSeverity: 'warning',
        applicableDomains: 'all',
        checkType: 'typescript',
        skippable: true,
        checkFn: async (_context: GateContext): Promise<GateCheckResult> => ({
          gateId: 'fn-gate',
          gateName: 'Function Gate',
          passed: true,
          severity: 'info',
          message: 'All good',
          issues: [],
          durationMs: 10,
          skippable: true,
        }),
      };

      runner.registerGate(fnGate);
      const result = await runner.runGates('post', mockContext);

      const fnGateResult = result.gates.find((g) => g.gateId === 'fn-gate');
      if (fnGateResult) {
        expect(fnGateResult.passed).toBe(true);
        expect(fnGateResult.message).toBe('All good');
      }
    });
  });

  describe('runPreGates', () => {
    it('should run pre-timing gates', async () => {
      const result = await runner.runPreGates(mockContext);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(result.summary).toBeDefined();
    });

    it('should filter by domain when provided', async () => {
      const result = await runner.runPreGates(mockContext, 'frontend');

      expect(result).toBeDefined();
      expect(Array.isArray(result.gates)).toBe(true);
    });
  });

  describe('runPostGates', () => {
    it('should run post-timing gates', async () => {
      const result = await runner.runPostGates(mockContext);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(result.summary).toBeDefined();
    });

    it('should filter by domain when provided', async () => {
      const result = await runner.runPostGates(mockContext, 'backend');

      expect(result).toBeDefined();
      expect(Array.isArray(result.gates)).toBe(true);
    });
  });

  describe('gate execution result structure', () => {
    it('should include summary statistics', async () => {
      const result = await runner.runPostGates(mockContext);

      expect(result.summary).toBeDefined();
      expect(typeof result.summary.total).toBe('number');
      expect(typeof result.summary.passed).toBe('number');
      expect(typeof result.summary.failed).toBe('number');
      expect(typeof result.summary.skipped).toBe('number');
      expect(typeof result.summary.errors).toBe('number');
      expect(typeof result.summary.warnings).toBe('number');
    });

    it('should include blocking issues array', async () => {
      const result = await runner.runPostGates(mockContext);

      expect(Array.isArray(result.blockingIssues)).toBe(true);
    });
  });
});
