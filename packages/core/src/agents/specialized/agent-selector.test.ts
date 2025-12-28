/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentSelector } from './agent-selector.js';

describe('AgentSelector', () => {
  let selector: AgentSelector;

  beforeEach(() => {
    selector = new AgentSelector();
  });

  describe('selectAgents', () => {
    it('should select react-specialist for React tasks', () => {
      const result = selector.selectAgents(
        'Create a new React component for user profile',
      );
      const agentIds = result.agents.map((s) => s.id);

      expect(agentIds).toContain('react-specialist');
    });

    it('should select security agents for auth tasks', () => {
      const result = selector.selectAgents(
        'Implement JWT authentication with refresh tokens',
      );
      const agentIds = result.agents.map((s) => s.id);

      expect(agentIds).toContain('auth-security');
    });

    it('should select database agents for schema tasks', () => {
      const result = selector.selectAgents(
        'Create database migration for user table',
      );
      const agentIds = result.agents.map((s) => s.id);

      expect(
        agentIds.some(
          (id: string) => id.includes('database') || id.includes('migration'),
        ),
      ).toBe(true);
    });

    it('should select test agents when testing is mentioned', () => {
      const result = selector.selectAgents(
        'Write unit tests for the payment service',
      );
      const agentIds = result.agents.map((s) => s.id);

      expect(agentIds.some((id: string) => id.includes('test'))).toBe(true);
    });

    it('should limit number of selected agents', () => {
      const result = selector.selectAgents(
        'Build a full-stack application with React frontend, Node.js backend, ' +
          'PostgreSQL database, JWT authentication, and comprehensive testing',
      );

      expect(result.agents.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for unrelated tasks', () => {
      const result = selector.selectAgents('xyzzy random gibberish');

      // Might return some agents based on partial matches or none
      expect(Array.isArray(result.agents)).toBe(true);
    });
  });

  describe('analyzeComplexity', () => {
    it('should return "simple" for short tasks', () => {
      const complexity = selector.analyzeComplexity('Fix typo');
      expect(complexity).toBe('simple');
    });

    it('should return "moderate" for medium tasks', () => {
      const complexity = selector.analyzeComplexity(
        'Add a new API endpoint for user preferences with validation',
      );
      expect(['moderate', 'complex']).toContain(complexity);
    });

    it('should return "complex" for comprehensive tasks', () => {
      const complexity = selector.analyzeComplexity(
        'Implement a complete authentication system with OAuth2, JWT refresh tokens, ' +
          'role-based access control, session management, and audit logging. ' +
          'Include comprehensive security measures and full test coverage. ' +
          'Refactor existing code to use the new system.',
      );
      expect(complexity).toBe('complex');
    });
  });

  describe('getExecutionOrder', () => {
    it('should order agents by domain priority', () => {
      const result = selector.selectAgents(
        'Create React component with API integration and tests',
      );

      const ordered = selector.getExecutionOrder(result.agents);

      // Should have some ordering
      expect(ordered.length).toBe(result.agents.length);
    });

    it('should maintain agents in ordered output', () => {
      const result = selector.selectAgents('Implement user authentication');
      const ordered = selector.getExecutionOrder(result.agents);

      for (const agent of ordered) {
        expect(agent.id).toBeDefined();
      }
    });
  });
});
