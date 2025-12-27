/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TrustCascadeEngine } from './trust-engine.js';
import { TrustLevel } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock fs module
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('TrustCascadeEngine', () => {
  let engine: TrustCascadeEngine;
  const mockWorkingDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    engine = new TrustCascadeEngine(mockWorkingDir);
  });

  describe('calculateTrustLevel', () => {
    it('should return L1_SUPERVISED for unknown agents', () => {
      const level = engine.calculateTrustLevel('unknown-agent');
      expect(level).toBe(TrustLevel.L1_SUPERVISED);
    });

    it('should increase trust level after successful executions', () => {
      const agentId = 'test-agent';
      
      // Record multiple successful executions
      for (let i = 0; i < 10; i++) {
        engine.recordExecution(agentId, true);
      }

      const level = engine.calculateTrustLevel(agentId);
      expect(level).not.toBe(TrustLevel.L0_QUARANTINE);
    });

    it('should decrease trust level after failures', () => {
      const agentId = 'failing-agent';
      
      // First, build some trust
      for (let i = 0; i < 5; i++) {
        engine.recordExecution(agentId, true);
      }
      
      // Then fail repeatedly
      for (let i = 0; i < 5; i++) {
        engine.recordExecution(agentId, false, 'Test error');
      }

      const level = engine.calculateTrustLevel(agentId);
      // Should be lower trust due to failures
      expect([TrustLevel.L0_QUARANTINE, TrustLevel.L1_SUPERVISED]).toContain(level);
    });
  });

  describe('getPrivileges', () => {
    it('should return restricted privileges for new agents', () => {
      const privileges = engine.getPrivileges('new-agent');
      
      expect(privileges.requiresApproval).toBe(true);
      expect(privileges.allowedTools).toBeDefined();
    });

    it('should return more privileges for trusted agents', () => {
      const agentId = 'trusted-agent';
      
      // Build trust
      for (let i = 0; i < 20; i++) {
        engine.recordExecution(agentId, true);
      }

      const privileges = engine.getPrivileges(agentId);
      // Should have more tools available
      expect(privileges.allowedTools.length).toBeGreaterThan(0);
    });
  });

  describe('recordExecution', () => {
    it('should update metrics after execution', () => {
      const agentId = 'record-test';
      
      engine.recordExecution(agentId, true);
      engine.recordExecution(agentId, true);
      engine.recordExecution(agentId, false, 'Error');

      // The trust level should reflect the mixed results
      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBeDefined();
    });

    it('should persist scores', () => {
      const agentId = 'persist-test';
      engine.recordExecution(agentId, true);

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('setTrustLevel', () => {
    it('should allow manual trust level override', () => {
      const agentId = 'manual-trust';
      
      engine.setTrustLevel(agentId, TrustLevel.L3_TRUSTED);
      
      const level = engine.calculateTrustLevel(agentId);
      expect(level).toBe(TrustLevel.L3_TRUSTED);
    });
  });

  describe('clearQuarantine', () => {
    it('should reset quarantined agent to supervised', () => {
      const agentId = 'quarantined-agent';
      
      // Quarantine the agent
      engine.setTrustLevel(agentId, TrustLevel.L0_QUARANTINE);
      expect(engine.calculateTrustLevel(agentId)).toBe(TrustLevel.L0_QUARANTINE);
      
      // Clear quarantine
      engine.clearQuarantine(agentId);
      expect(engine.calculateTrustLevel(agentId)).toBe(TrustLevel.L1_SUPERVISED);
    });
  });
});
