/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import type { Config } from '@google/gemini-cli-core';

// Import orchestration components directly from source until core is properly compiled
// TODO: Replace with '@google/gemini-cli-core' imports once core build issues are resolved
import { AgentSelector } from '@google/gemini-cli-core/src/agents/specialized/agent-selector.js';
import type { AgentSelectionResult } from '@google/gemini-cli-core/src/agents/specialized/types.js';
import {
  HybridModeManager,
  DEFAULT_HYBRID_CONFIG,
} from '@google/gemini-cli-core/src/hybrid/hybrid-mode-manager.js';
import type {
  ExecutionReport,
  ExecutionPhase,
  ExecutionPlan,
} from '@google/gemini-cli-core/src/orchestrator/types.js';

/**
 * Configuration for orchestrator behavior
 */
export interface OrchestratorHookConfig {
  /** Minimum agent score to trigger orchestration (default: 5) */
  minScoreThreshold?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result from the orchestrator analysis
 */
export interface OrchestratorAnalysis {
  /** Whether orchestration should be used for this task */
  shouldUseOrchestrator: boolean;
  /** Selected agents (if any) */
  selection: AgentSelectionResult;
  /** Human-readable explanation */
  reasoning: string;
}

/**
 * Return type for useAgentOrchestrator hook
 */
export interface UseAgentOrchestratorReturn {
  /** Whether orchestration is currently enabled */
  isEnabled: boolean;
  /** Current execution phase (if executing) */
  currentPhase: ExecutionPhase | null;
  /** Whether orchestrator is currently executing a task */
  isExecuting: boolean;
  /** Last execution report */
  lastReport: ExecutionReport | null;
  /** Analyze if a task should use orchestration */
  analyzeTask: (taskDescription: string) => OrchestratorAnalysis;
  /** Execute a task through the orchestrator */
  executeTask: (
    task: string,
    options?: {
      onPhaseChange?: (phase: ExecutionPhase) => void | Promise<void>;
      onApprovalRequired?: (plan: ExecutionPlan) => Promise<boolean>;
    },
  ) => Promise<ExecutionReport>;
  /** Enable orchestration */
  enable: () => void;
  /** Disable orchestration */
  disable: () => void;
  /** Get session statistics */
  getStats: () => ReturnType<HybridModeManager['getStats']>;
}

/**
 * Hook for integrating the multi-agent orchestration system
 *
 * This hook provides access to the HybridModeManager and AgentSelector,
 * allowing the CLI to:
 * 1. Analyze tasks to determine if they should use specialized agents
 * 2. Execute complex tasks through the multi-agent orchestration pipeline
 * 3. Track execution phases and reports
 *
 * @example
 * ```tsx
 * const { analyzeTask, executeTask, isEnabled } = useAgentOrchestrator(config);
 *
 * // Analyze a user's query
 * const analysis = analyzeTask("Create a React component with TypeScript");
 *
 * if (analysis.shouldUseOrchestrator) {
 *   // Use orchestrator for complex tasks
 *   const report = await executeTask(userQuery);
 * } else {
 *   // Use regular Gemini flow for simple queries
 *   await geminiClient.sendMessageStream(userQuery, ...);
 * }
 * ```
 */
export const useAgentOrchestrator = (
  config: Config,
  hookConfig: OrchestratorHookConfig = {},
): UseAgentOrchestratorReturn => {
  const { minScoreThreshold = 5, debug = false } = hookConfig;

  // Lazy initialization of the manager
  const managerRef = useRef<HybridModeManager | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<ExecutionPhase | null>(null);
  const [lastReport, setLastReport] = useState<ExecutionReport | null>(null);
  const [isEnabled, setIsEnabled] = useState(DEFAULT_HYBRID_CONFIG.enabled);

  // Create agent selector with configuration
  const agentSelector = useMemo(
    () =>
      new AgentSelector({
        minScoreThreshold,
        debug,
      }),
    [minScoreThreshold, debug],
  );

  /**
   * Get or create the HybridModeManager
   */
  const getManager = useCallback((): HybridModeManager => {
    if (!managerRef.current) {
      const contentGenerator = config.getContentGenerator();
      managerRef.current = new HybridModeManager(config, contentGenerator, {
        enabled: isEnabled,
      });
    }
    return managerRef.current;
  }, [config, isEnabled]);

  /**
   * Analyze a task to determine if orchestration should be used
   */
  const analyzeTask = useCallback(
    (taskDescription: string): OrchestratorAnalysis => {
      const selection = agentSelector.selectAgents(taskDescription);
      const shouldUseOrchestrator = selection.agents.length > 0 && isEnabled;

      let reasoning: string;
      if (!isEnabled) {
        reasoning = 'Orchestration is disabled. Using standard Gemini flow.';
      } else if (selection.agents.length === 0) {
        reasoning =
          'No specialized agents matched this task. Using standard Gemini flow for general queries.';
      } else {
        reasoning = selection.reasoning;
      }

      if (debug) {
        console.log('[useAgentOrchestrator] Analysis:', {
          task: taskDescription.slice(0, 100),
          shouldUseOrchestrator,
          agentCount: selection.agents.length,
          complexity: selection.complexity,
        });
      }

      return {
        shouldUseOrchestrator,
        selection,
        reasoning,
      };
    },
    [agentSelector, isEnabled, debug],
  );

  /**
   * Execute a task through the orchestration system
   */
  const executeTask = useCallback(
    async (
      task: string,
      options?: {
        onPhaseChange?: (phase: ExecutionPhase) => void | Promise<void>;
        onApprovalRequired?: (plan: ExecutionPlan) => Promise<boolean>;
      },
    ): Promise<ExecutionReport> => {
      const manager = getManager();
      const workingDirectory = config.getProjectRoot() || process.cwd();

      setIsExecuting(true);
      setCurrentPhase('INIT');

      try {
        const report = await manager.executeTask(task, workingDirectory, {
          onPhaseChange: async (phase: ExecutionPhase) => {
            setCurrentPhase(phase);
            if (options?.onPhaseChange) {
              await options.onPhaseChange(phase);
            }
          },
          onApprovalRequired: options?.onApprovalRequired,
        });

        setLastReport(report);
        return report;
      } finally {
        setIsExecuting(false);
        setCurrentPhase(null);
      }
    },
    [getManager, config],
  );

  /**
   * Enable orchestration
   */
  const enable = useCallback(() => {
    setIsEnabled(true);
    const manager = managerRef.current;
    if (manager) {
      manager.enable();
    }
  }, []);

  /**
   * Disable orchestration
   */
  const disable = useCallback(() => {
    setIsEnabled(false);
    const manager = managerRef.current;
    if (manager) {
      manager.disable();
    }
  }, []);

  /**
   * Get session statistics
   */
  const getStats = useCallback(() => {
    const manager = managerRef.current;
    return manager?.getStats() ?? null;
  }, []);

  return {
    isEnabled,
    currentPhase,
    isExecuting,
    lastReport,
    analyzeTask,
    executeTask,
    enable,
    disable,
    getStats,
  };
};
