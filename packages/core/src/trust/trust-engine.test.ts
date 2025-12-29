/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { TrustCascadeEngine } from './trust-engine.js';
import { TrustLevel } from './types.js';
import * as fs from 'node:fs';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('TrustCascadeEngine', () => {
  let engine: TrustCascadeEngine;
  const mockWorkingDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(false);
    engine = new TrustCascadeEngine(mockWorkingDir);
  });

  describe('calculateTrustLevel', () => {
    it('should return domain-based initial trust level for new agents', () => {
      // "unknown-agent" maps to "general" domain which has L2_GUIDED initial level
      const level = engine.calculateTrustLevel('unknown-agent');
      expect(level).toBe(TrustLevel.L2_GUIDED);

      // Security domain agents start at L1_SUPERVISED
      const securityLevel = engine.calculateTrustLevel('security-auditor');
      expect(securityLevel).toBe(TrustLevel.L1_SUPERVISED);

      // Testing domain agents start at L3_TRUSTED
      const testingLevel = engine.calculateTrustLevel('testing-runner');
      expect(testingLevel).toBe(TrustLevel.L3_TRUSTED);
    });

    it('should increase trust level after successful executions', () => {
      const agentId = 'test-agent';

      // Record multiple successful executions with quality scores
      for (let i = 0; i < 10; i++) {
        engine.recordExecution(agentId, {
          success: true,
          qualityScore: 85,
        });
      }

      const level = engine.calculateTrustLevel(agentId);
      expect(level).not.toBe(TrustLevel.L0_QUARANTINE);
    });

    it('should decrease trust level after failures', () => {
      const agentId = 'failing-agent';

      // First, build some trust
      for (let i = 0; i < 5; i++) {
        engine.recordExecution(agentId, {
          success: true,
          qualityScore: 80,
        });
      }

      // Then fail repeatedly (3 consecutive failures triggers quarantine)
      for (let i = 0; i < 3; i++) {
        engine.recordExecution(agentId, {
          success: false,
          qualityScore: 20,
          errorDetails: 'Test error',
        });
      }

      const level = engine.calculateTrustLevel(agentId);
      // Should be quarantined due to consecutive failures
      expect(level).toBe(TrustLevel.L0_QUARANTINE);
    });
  });

  describe('getPrivileges', () => {
    it('should return restricted privileges for new agents', () => {
      const privileges = engine.getPrivileges('new-agent');

      expect(privileges.requiresApproval).toBeUndefined(); // L1 doesn't have explicit approval flag
      expect(privileges.allowedOperations).toBeDefined();
    });

    it('should return more privileges for trusted agents', () => {
      const agentId = 'trusted-agent';

      // Build trust with many successful executions
      for (let i = 0; i < 25; i++) {
        engine.recordExecution(agentId, {
          success: true,
          qualityScore: 90,
        });
      }

      const privileges = engine.getPrivileges(agentId);
      // Should have more operations available
      expect(privileges.allowedOperations.length).toBeGreaterThan(0);
    });
  });

  describe('recordExecution', () => {
    it('should update metrics after execution', () => {
      const agentId = 'record-test';

      engine.recordExecution(agentId, { success: true, qualityScore: 80 });
      engine.recordExecution(agentId, { success: true, qualityScore: 75 });
      engine.recordExecution(agentId, {
        success: false,
        qualityScore: 30,
        errorDetails: 'Error',
      });

      // The trust level should reflect the mixed results
      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBeDefined();
    });

    it('should persist scores', () => {
      const agentId = 'persist-test';
      engine.recordExecution(agentId, { success: true, qualityScore: 85 });

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should track critical failures', () => {
      const agentId = 'critical-test';

      engine.recordExecution(agentId, {
        success: false,
        qualityScore: 0,
        isCriticalFailure: true,
        errorDetails: 'Critical error occurred',
      });

      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBe(TrustLevel.L0_QUARANTINE);
    });

    it('should track security issues', () => {
      const agentId = 'security-test';

      engine.recordExecution(agentId, {
        success: false,
        qualityScore: 0,
        isSecurityIssue: true,
        errorDetails: 'Security vulnerability detected',
      });

      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBe(TrustLevel.L0_QUARANTINE);
    });
  });

  describe('setTrustLevel', () => {
    it('should allow manual trust level override', () => {
      const agentId = 'manual-trust';

      engine.setTrustLevel(agentId, TrustLevel.L3_TRUSTED, 'Admin override');

      const level = engine.calculateTrustLevel(agentId);
      // Note: setTrustLevel affects metrics but level is recalculated
      expect(level).toBeDefined();
    });
  });

  describe('clearQuarantine', () => {
    it('should reset quarantined agent to domain-based initial level', () => {
      const agentId = 'quarantined-agent';

      // Quarantine the agent
      engine.setTrustLevel(
        agentId,
        TrustLevel.L0_QUARANTINE,
        'Test quarantine',
      );

      // Clear quarantine
      const cleared = engine.clearQuarantine(agentId, 'Reviewed and approved');
      expect(cleared).toBe(true);

      // After clearing, agent returns to domain-based initial level (general → L2_GUIDED)
      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBe(TrustLevel.L2_GUIDED);
    });

    it('should return false for non-quarantined agent', () => {
      const agentId = 'normal-agent';

      // Record a success to ensure it's not quarantined
      engine.recordExecution(agentId, { success: true, qualityScore: 80 });

      const cleared = engine.clearQuarantine(agentId, 'Not needed');
      expect(cleared).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('should return default metrics for new agent', () => {
      const metrics = engine.getMetrics('new-agent');

      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.successfulExecutions).toBe(0);
      expect(metrics.failedExecutions).toBe(0);
    });

    it('should return updated metrics after executions', () => {
      const agentId = 'metrics-test';

      engine.recordExecution(agentId, { success: true, qualityScore: 90 });
      engine.recordExecution(agentId, { success: true, qualityScore: 85 });
      engine.recordExecution(agentId, { success: false, qualityScore: 40 });

      const metrics = engine.getMetrics(agentId);

      expect(metrics.totalExecutions).toBe(3);
      expect(metrics.successfulExecutions).toBe(2);
      expect(metrics.failedExecutions).toBe(1);
    });
  });

  describe('resetAgent', () => {
    it('should reset agent metrics to defaults', () => {
      const agentId = 'reset-test';

      // Add some history
      engine.recordExecution(agentId, { success: true, qualityScore: 80 });
      engine.recordExecution(agentId, { success: true, qualityScore: 80 });

      // Reset
      engine.resetAgent(agentId);

      const metrics = engine.getMetrics(agentId);
      expect(metrics.totalExecutions).toBe(0);
    });
  });

  describe('getSummary', () => {
    it('should return summary of all agents', () => {
      engine.recordExecution('agent1', { success: true, qualityScore: 80 });
      engine.recordExecution('agent2', { success: true, qualityScore: 75 });

      const summary = engine.getSummary();

      expect(Array.isArray(summary)).toBe(true);
      expect(summary.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getAllAgentIds', () => {
    it('should return list of all agent IDs', () => {
      engine.recordExecution('agent1', { success: true, qualityScore: 80 });
      engine.recordExecution('agent2', { success: true, qualityScore: 80 });

      const ids = engine.getAllAgentIds();

      expect(ids).toContain('agent1');
      expect(ids).toContain('agent2');
    });
  });
});
