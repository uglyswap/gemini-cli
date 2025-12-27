/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OrchestratorConfig,
  ExecutionPlan,
  ExecutionReport,
  ExecutionPhase,
  AgentExecution,
  PhaseCallback,
  ApprovalCallback,
} from './types.js';
import { TrustCascadeEngine } from '../trust/trust-engine.js';
import { TrustLevel } from '../trust/types.js';
import { AgentSelector, getAgentById } from '../agents/specialized/index.js';
import type { SpecializedAgent } from '../agents/specialized/types.js';
import { SnapshotManager } from '../safety/snapshot/snapshot-manager.js';
import { GateRunner } from '../safety/quality-gates/gate-runner.js';
import { BUILT_IN_GATES } from '../safety/quality-gates/built-in-gates.js';
import { AgentSessionManager } from '../agents/session/agent-session-manager.js';
import type { AgentTaskResult } from '../agents/session/types.js';
import type { Config } from '../config/config.js';
import type { ContentGenerator } from '../core/contentGenerator.js';

/**
 * Enhanced Agent Orchestrator
 * 
 * Implements the 6-phase execution workflow:
 * 1. INIT - Select agents based on task analysis
 * 2. EXPLAIN - Generate execution plan with trust-based privileges
 * 3. SNAPSHOT - Create safety snapshot before execution
 * 4. EXECUTE - Run agents with appropriate supervision
 * 5. VALIDATE - Run quality gates and verify results
 * 6. REPORT - Generate comprehensive execution report
 */
export class EnhancedAgentOrchestrator {
  private readonly trustEngine: TrustCascadeEngine;
  private readonly agentSelector: AgentSelector;
  private readonly snapshotManager: SnapshotManager;
  private readonly gateRunner: GateRunner;
  private readonly sessionManager: AgentSessionManager;
  private readonly config: OrchestratorConfig;

  private currentPhase: ExecutionPhase = 'INIT';
  private phaseCallbacks: PhaseCallback[] = [];
  private approvalCallbacks: ApprovalCallback[] = [];

  constructor(
    cliConfig: Config,
    contentGenerator: ContentGenerator,
    orchestratorConfig: OrchestratorConfig,
  ) {
    this.config = orchestratorConfig;

    // Initialize trust engine
    this.trustEngine = new TrustCascadeEngine(
      orchestratorConfig.workingDirectory,
    );

    // Initialize agent selector
    this.agentSelector = new AgentSelector();

    // Initialize snapshot manager
    this.snapshotManager = new SnapshotManager({
      workingDirectory: orchestratorConfig.workingDirectory,
      maxSnapshots: 10,
      excludePatterns: ['node_modules', '.git', 'dist', 'build', '.gemini'],
    });

    // Initialize quality gate runner with configured gates
    const gates = (orchestratorConfig.qualityGates || ['typescript', 'eslint'])
      .map(name => BUILT_IN_GATES.find(g => g.name === name))
      .filter((g): g is NonNullable<typeof g> => g !== undefined);

    this.gateRunner = new GateRunner(
      gates,
      orchestratorConfig.workingDirectory,
    );

    // Initialize session manager for isolated agent contexts
    this.sessionManager = new AgentSessionManager(
      cliConfig,
      contentGenerator,
      {
        workingDirectory: orchestratorConfig.workingDirectory,
        maxConcurrentSessions: 5,
        reuseAgentSessions: true,
      },
    );

    // Subscribe to session events
    this.sessionManager.onEvent((event) => {
      if (event.type === 'task_completed') {
        const agentId = this.sessionManager.getSession(event.sessionId)?.getAgent().id;
        if (agentId) {
          // Record execution in trust engine
          this.trustEngine.recordExecution(
            agentId,
            event.result.success,
            event.result.error,
          );
        }
      }
    });
  }

  /**
   * Execute a task using the 6-phase workflow
   */
  async executeTask(
    task: string,
    options?: {
      onPhaseChange?: PhaseCallback;
      onApprovalRequired?: ApprovalCallback;
    },
  ): Promise<ExecutionReport> {
    const startTime = Date.now();
    
    if (options?.onPhaseChange) {
      this.phaseCallbacks.push(options.onPhaseChange);
    }
    if (options?.onApprovalRequired) {
      this.approvalCallbacks.push(options.onApprovalRequired);
    }

    let snapshotId: string | undefined;
    let plan: ExecutionPlan | undefined;
    const agentExecutions: AgentExecution[] = [];

    try {
      // Phase 1: INIT - Select agents
      await this.setPhase('INIT');
      const selectedAgents = this.agentSelector.selectAgents(task);
      const orderedAgents = this.agentSelector.getExecutionOrder(selectedAgents);

      // Phase 2: EXPLAIN - Generate execution plan
      await this.setPhase('EXPLAIN');
      plan = await this.generatePlan(task, orderedAgents);

      // Check if approval is required based on trust levels
      const requiresApproval = this.checkApprovalRequired(orderedAgents);
      if (requiresApproval) {
        const approved = await this.requestApproval(plan);
        if (!approved) {
          return this.createReport(
            task,
            plan,
            agentExecutions,
            false,
            'Execution cancelled by user',
            startTime,
          );
        }
      }

      // Phase 3: SNAPSHOT - Create safety snapshot
      await this.setPhase('SNAPSHOT');
      if (this.config.enableSnapshots !== false) {
        snapshotId = await this.snapshotManager.createSnapshot(
          `Before task: ${task.substring(0, 50)}...`,
        );
      }

      // Phase 4: EXECUTE - Run agents
      await this.setPhase('EXECUTE');
      for (const agentInfo of orderedAgents) {
        const agent = getAgentById(agentInfo.agent.id);
        if (!agent) continue;

        const execution = await this.executeAgent(
          agent,
          task,
          plan,
        );
        agentExecutions.push(execution);

        // Stop on critical failure if not in autonomous mode
        if (!execution.success && this.shouldStopOnFailure(agent)) {
          break;
        }
      }

      // Phase 5: VALIDATE - Run quality gates
      await this.setPhase('VALIDATE');
      const gateResults = await this.gateRunner.runPostGates();
      const allGatesPassed = gateResults.every(r => r.passed);

      // Rollback if validation failed and we have a snapshot
      if (!allGatesPassed && snapshotId && this.config.enableSnapshots !== false) {
        const shouldRollback = await this.requestRollbackApproval(gateResults);
        if (shouldRollback) {
          await this.snapshotManager.restoreSnapshot(snapshotId);
        }
      }

      // Phase 6: REPORT - Generate execution report
      await this.setPhase('REPORT');
      const overallSuccess = agentExecutions.every(e => e.success) && allGatesPassed;

      return this.createReport(
        task,
        plan,
        agentExecutions,
        overallSuccess,
        undefined,
        startTime,
        gateResults,
        snapshotId,
      );

    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Attempt rollback on error
      if (snapshotId && this.config.enableSnapshots !== false) {
        try {
          await this.snapshotManager.restoreSnapshot(snapshotId);
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
      }

      return this.createReport(
        task,
        plan,
        agentExecutions,
        false,
        errorMessage,
        startTime,
      );
    } finally {
      // Cleanup
      this.phaseCallbacks = this.phaseCallbacks.filter(
        cb => cb !== options?.onPhaseChange,
      );
      this.approvalCallbacks = this.approvalCallbacks.filter(
        cb => cb !== options?.onApprovalRequired,
      );
    }
  }

  /**
   * Get current execution phase
   */
  getCurrentPhase(): ExecutionPhase {
    return this.currentPhase;
  }

  /**
   * Get session manager statistics
   */
  getSessionStats() {
    return this.sessionManager.getStats();
  }

  /**
   * Get trust information for an agent
   */
  getAgentTrust(agentId: string) {
    return {
      level: this.trustEngine.calculateTrustLevel(agentId),
      privileges: this.trustEngine.getPrivileges(agentId),
    };
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    this.sessionManager.closeAllSessions();
    await this.snapshotManager.cleanup();
  }

  /**
   * Set the current phase and notify callbacks
   */
  private async setPhase(phase: ExecutionPhase): Promise<void> {
    this.currentPhase = phase;
    for (const callback of this.phaseCallbacks) {
      await callback(phase);
    }
  }

  /**
   * Generate execution plan for the task
   */
  private async generatePlan(
    task: string,
    agents: Array<{ agent: SpecializedAgent; score: number }>,
  ): Promise<ExecutionPlan> {
    const steps = agents.map((agentInfo, index) => {
      const trustLevel = this.trustEngine.calculateTrustLevel(agentInfo.agent.id);
      const privileges = this.trustEngine.getPrivileges(agentInfo.agent.id);

      return {
        order: index + 1,
        agentId: agentInfo.agent.id,
        agentName: agentInfo.agent.name,
        description: `${agentInfo.agent.name} will handle aspects related to ${agentInfo.agent.domain}`,
        trustLevel,
        privileges,
        estimatedComplexity: this.agentSelector.analyzeComplexity(task),
      };
    });

    return {
      task,
      steps,
      totalAgents: agents.length,
      estimatedComplexity: this.agentSelector.analyzeComplexity(task),
      createdAt: new Date(),
    };
  }

  /**
   * Check if any agent requires approval based on trust level
   */
  private checkApprovalRequired(
    agents: Array<{ agent: SpecializedAgent; score: number }>,
  ): boolean {
    const threshold = this.config.requireApprovalAbove || TrustLevel.L2_GUIDED;
    
    return agents.some(agentInfo => {
      const trustLevel = this.trustEngine.calculateTrustLevel(agentInfo.agent.id);
      const privileges = this.trustEngine.getPrivileges(agentInfo.agent.id);
      return privileges.requiresApproval;
    });
  }

  /**
   * Request approval from user
   */
  private async requestApproval(plan: ExecutionPlan): Promise<boolean> {
    if (this.approvalCallbacks.length === 0) {
      // No approval callback - auto-approve
      return true;
    }

    for (const callback of this.approvalCallbacks) {
      const approved = await callback(plan);
      if (!approved) return false;
    }

    return true;
  }

  /**
   * Request rollback approval after validation failure
   */
  private async requestRollbackApproval(
    gateResults: Array<{ name: string; passed: boolean; message?: string }>,
  ): Promise<boolean> {
    // In automated mode, auto-rollback on failure
    if (this.approvalCallbacks.length === 0) {
      return true;
    }

    // Otherwise, ask for approval
    const failedGates = gateResults.filter(r => !r.passed);
    const rollbackPlan: ExecutionPlan = {
      task: 'Rollback due to validation failures',
      steps: [{
        order: 1,
        agentId: 'system',
        agentName: 'System Rollback',
        description: `Failed gates: ${failedGates.map(g => g.name).join(', ')}`,
        trustLevel: TrustLevel.L4_AUTONOMOUS,
        privileges: this.trustEngine.getPrivileges('system'),
        estimatedComplexity: 'simple' as const,
      }],
      totalAgents: 1,
      estimatedComplexity: 'simple',
      createdAt: new Date(),
    };

    return this.requestApproval(rollbackPlan);
  }

  /**
   * Execute a single agent with its task
   */
  private async executeAgent(
    agent: SpecializedAgent,
    task: string,
    plan: ExecutionPlan,
  ): Promise<AgentExecution> {
    const startTime = Date.now();
    const trustLevel = this.trustEngine.calculateTrustLevel(agent.id);
    const privileges = this.trustEngine.getPrivileges(agent.id);

    // Build agent-specific task prompt
    const agentTask = this.buildAgentTask(agent, task, plan);

    try {
      // Execute via session manager (isolated context)
      const result: AgentTaskResult = await this.sessionManager.executeAgentTask(
        agent,
        agentTask,
      );

      return {
        agentId: agent.id,
        agentName: agent.name,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
        trustLevel,
        toolsUsed: result.toolCalls?.map(tc => tc.name) || [],
        filesModified: result.modifiedFiles || [],
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        agentId: agent.id,
        agentName: agent.name,
        success: false,
        output: '',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        trustLevel,
        toolsUsed: [],
        filesModified: [],
      };
    }
  }

  /**
   * Build a task prompt specific to an agent
   */
  private buildAgentTask(
    agent: SpecializedAgent,
    task: string,
    plan: ExecutionPlan,
  ): string {
    const stepInfo = plan.steps.find(s => s.agentId === agent.id);
    
    return `
# Task Assignment for ${agent.name}

## Overall Task
${task}

## Your Specific Role
As the ${agent.name}, focus on the ${agent.domain} aspects of this task.

## Execution Context
- Step ${stepInfo?.order || '?'} of ${plan.totalAgents}
- Trust Level: ${stepInfo?.trustLevel || 'unknown'}
- Complexity: ${stepInfo?.estimatedComplexity || 'unknown'}

## Your Responsibilities
${agent.qualityChecks.map(check => `- ${check}`).join('\n')}

## Instructions
1. Analyze the task from your specialized perspective
2. Execute only actions within your domain
3. Report your findings and any changes made
4. Flag any concerns or issues for review

Begin your analysis and execution now.
`.trim();
  }

  /**
   * Determine if execution should stop on agent failure
   */
  private shouldStopOnFailure(agent: SpecializedAgent): boolean {
    const privileges = this.trustEngine.getPrivileges(agent.id);
    
    // Stop on failure for supervised/guided agents
    const trustLevel = this.trustEngine.calculateTrustLevel(agent.id);
    return trustLevel === TrustLevel.L1_SUPERVISED || 
           trustLevel === TrustLevel.L2_GUIDED;
  }

  /**
   * Create the final execution report
   */
  private createReport(
    task: string,
    plan: ExecutionPlan | undefined,
    agentExecutions: AgentExecution[],
    success: boolean,
    error: string | undefined,
    startTime: number,
    gateResults?: Array<{ name: string; passed: boolean; message?: string }>,
    snapshotId?: string,
  ): ExecutionReport {
    return {
      task,
      plan: plan || {
        task,
        steps: [],
        totalAgents: 0,
        estimatedComplexity: 'simple',
        createdAt: new Date(),
      },
      agentExecutions,
      success,
      error,
      qualityGateResults: gateResults || [],
      snapshotId,
      totalDurationMs: Date.now() - startTime,
      completedAt: new Date(),
    };
  }
}
