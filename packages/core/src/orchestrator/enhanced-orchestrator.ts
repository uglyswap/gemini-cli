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
  ParallelExecutionGroup,
  OrchestratorEvent,
  OrchestratorEventCallback,
  OrchestratorEventType,
} from './types.js';
import { ExecutionMode } from './types.js';
import { TrustCascadeEngine } from '../trust/trust-engine.js';
import { TrustLevel } from '../trust/types.js';
import { AgentSelector, getAgentById } from '../agents/specialized/index.js';
import type { SpecializedAgent } from '../agents/specialized/types.js';
import { SnapshotManager } from '../safety/snapshot/snapshot-manager.js';
import { GateRunner } from '../safety/quality-gates/gate-runner.js';
import { AgentSessionManager } from '../agents/session/agent-session-manager.js';
import type { Config } from '../config/config.js';
import type { ContentGenerator } from '../core/contentGenerator.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { Tool } from '@google/genai';

// New components for enhanced workflow
import {
  AnalyzerAgent,
  type TechContextDocument,
} from '../agents/analyzer/analyzer-agent.js';
import { ValidationPipeline } from '../validation/validation-pipeline.js';
import { FeedbackLoop, type FeedbackError } from '../feedback/feedback-loop.js';
import { ErrorMemory } from '../feedback/error-memory.js';

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

  // New components for enhanced workflow
  private readonly analyzerAgent: AnalyzerAgent;
  private readonly validationPipeline: ValidationPipeline;
  private readonly feedbackLoop: FeedbackLoop;
  private readonly errorMemory: ErrorMemory;
  private techContext: TechContextDocument | null = null;

  private currentPhase: ExecutionPhase = 'INIT';
  private phaseCallbacks: PhaseCallback[] = [];
  private approvalCallbacks: ApprovalCallback[] = [];
  private eventCallbacks: OrchestratorEventCallback[] = [];
  private sessionEventUnsubscribe: (() => void) | null = null;

  constructor(
    cliConfig: Config,
    contentGenerator: ContentGenerator,
    orchestratorConfig: OrchestratorConfig,
    toolRegistry?: ToolRegistry,
  ) {
    this.config = orchestratorConfig;

    const workingDir =
      orchestratorConfig.workingDirectory || orchestratorConfig.projectRoot;

    // Initialize trust engine
    this.trustEngine = new TrustCascadeEngine(workingDir);

    // Initialize agent selector
    this.agentSelector = new AgentSelector();

    // Initialize snapshot manager
    this.snapshotManager = new SnapshotManager(workingDir, {
      maxSnapshots: 10,
      excludePatterns: ['node_modules', '.git', 'dist', 'build', '.gemini'],
    });

    // Initialize quality gate runner
    // Note: Gate selection from config is handled internally by GateRunner
    this.gateRunner = new GateRunner({
      verbose: orchestratorConfig.verbose,
    });

    // Convert tool registry to Gemini Tool format
    const defaultTools: Tool[] = toolRegistry
      ? [{ functionDeclarations: toolRegistry.getFunctionDeclarations() }]
      : [];

    // Initialize session manager for isolated agent contexts
    this.sessionManager = new AgentSessionManager(cliConfig, contentGenerator, {
      workingDirectory: workingDir,
      maxConcurrentSessions: 5,
      reuseAgentSessions: true,
      defaultTools,
      toolRegistry,
    });

    // Initialize new enhanced workflow components
    this.analyzerAgent = new AnalyzerAgent();
    this.validationPipeline = new ValidationPipeline({
      enableTypeCheck: true,
      enableLint: true,
      enableSecurity: true,
      // enableTests is now configurable via orchestratorConfig (default: false for backwards compatibility)
      enableTests: orchestratorConfig.enableTests ?? false,
    });
    this.feedbackLoop = new FeedbackLoop({
      maxIterations: orchestratorConfig.maxRetryIterations || 5,
      exponentialBackoff: true,
    });
    this.errorMemory = new ErrorMemory({
      persistPath: `${workingDir}/.devora/error-memory.json`,
      autoPersist: true,
    });

    // Subscribe to session events and store unsubscribe function for cleanup
    this.sessionEventUnsubscribe = this.sessionManager.onEvent((event) => {
      if (event.type === 'task_completed') {
        const session = this.sessionManager.getSession(event.sessionId);
        if (session) {
          const agentId = session.getAgent().id;
          // Record execution in trust engine
          this.trustEngine.recordExecution(agentId, {
            success: event.result.success,
            qualityScore: event.result.success ? 80 : 30,
            durationMs: event.result.durationMs,
            errorDetails: event.result.error,
          });
        }
      }
    });
  }

  /**
   * Emit an orchestrator event to all registered callbacks
   */
  private async emitEvent(
    type: OrchestratorEventType,
    message: string,
    data?: OrchestratorEvent['data'],
  ): Promise<void> {
    const event: OrchestratorEvent = {
      type,
      timestamp: new Date(),
      message,
      data: {
        ...data,
        phase: this.currentPhase,
      },
    };

    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        console.error('[Orchestrator] Event callback error:', error);
      }
    }
  }

  /**
   * Execute a task using the 6-phase workflow
   */
  async executeTask(
    task: string,
    options?: {
      onPhaseChange?: PhaseCallback;
      onApprovalRequired?: ApprovalCallback;
      /** Callback for streaming orchestrator events */
      onEvent?: OrchestratorEventCallback;
    },
  ): Promise<ExecutionReport> {
    const startTime = Date.now();

    // Prevent duplicate callbacks when executeTask is called in parallel
    if (
      options?.onPhaseChange &&
      !this.phaseCallbacks.includes(options.onPhaseChange)
    ) {
      this.phaseCallbacks.push(options.onPhaseChange);
    }
    if (
      options?.onApprovalRequired &&
      !this.approvalCallbacks.includes(options.onApprovalRequired)
    ) {
      this.approvalCallbacks.push(options.onApprovalRequired);
    }
    if (options?.onEvent && !this.eventCallbacks.includes(options.onEvent)) {
      this.eventCallbacks.push(options.onEvent);
    }

    let snapshotId: string | undefined;
    let plan: ExecutionPlan | undefined;
    const agentExecutions: AgentExecution[] = [];
    let rolledBack = false;

    try {
      // Phase 1: INIT - Analyze codebase and select agents
      await this.setPhase('INIT');

      // Analyze codebase for tech context (used by agents)
      const workingDir =
        this.config.workingDirectory || this.config.projectRoot;
      this.techContext = await this.analyzerAgent.analyze(workingDir);

      const selectionResult = this.agentSelector.selectAgents(task);
      const orderedAgentsList = this.agentSelector.getExecutionOrder(
        selectionResult.agents,
      );

      // Convert to the format expected by generatePlan
      const orderedAgents = orderedAgentsList.map((agent) => ({
        agent,
        score: selectionResult.scores.get(agent.id) || 0,
      }));

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
            undefined,
            undefined,
            false,
          );
        }
      }

      // Phase 3: SNAPSHOT - Create safety snapshot
      await this.setPhase('SNAPSHOT');
      if (this.config.enableSnapshots !== false) {
        const snapshot = await this.snapshotManager.createSnapshot(
          [], // No specific files, will snapshot working directory
          `Before task: ${task.substring(0, 50)}...`,
          {
            agentId: 'orchestrator',
            taskDescription: task,
            trustLevel: TrustLevel.L2_GUIDED,
          },
        );
        snapshotId = snapshot.id;
      }

      // Phase 4: EXECUTE - Run agents based on execution mode
      await this.setPhase('EXECUTE');
      const executionMode =
        this.config.executionMode || ExecutionMode.CONFIDENCE;

      if (executionMode === ExecutionMode.SPEED) {
        // SPEED mode: Maximum parallelization - all agents at once
        const executions = await this.executeAgentsParallel(
          orderedAgents.map((a) => a.agent),
          task,
          plan,
          this.config.maxConcurrentAgents || 5,
        );
        agentExecutions.push(...executions);
      } else if (executionMode === ExecutionMode.BALANCED) {
        // BALANCED mode: Domain-level parallelization
        const groups = this.createParallelGroups(orderedAgents);
        for (const group of groups) {
          const agents = group.agentIds
            .map((id) => getAgentById(id))
            .filter((a): a is SpecializedAgent => a !== undefined);

          const executions = await this.executeAgentsParallel(
            agents,
            task,
            plan,
            this.config.maxConcurrentAgents || 5,
          );
          agentExecutions.push(...executions);

          // Check for critical failures before moving to next group
          const hasCriticalFailure = executions.some(
            (e) =>
              !e.success && this.shouldStopOnFailure(getAgentById(e.agentId)!),
          );
          if (hasCriticalFailure) break;
        }
      } else {
        // CONFIDENCE mode (default): Sequential execution for maximum quality
        for (const agentInfo of orderedAgents) {
          const agent = getAgentById(agentInfo.agent.id);
          if (!agent) continue;

          const execution = await this.executeAgent(agent, task, plan);
          agentExecutions.push(execution);

          // Stop on critical failure if not in autonomous mode
          if (!execution.success && this.shouldStopOnFailure(agent)) {
            break;
          }
        }
      }

      // Phase 5: VALIDATE - Run quality gates and validation pipeline with feedback loop
      await this.setPhase('VALIDATE');
      const gateWorkingDir =
        this.config.workingDirectory || this.config.projectRoot;
      const modifiedFiles = agentExecutions.flatMap(
        (e) => e.filesModified || [],
      );

      // Emit validation start event
      await this.emitEvent('validation_start', 'Starting validation pipeline', {
        files: modifiedFiles,
      });

      // Skip ValidationPipeline if no files were modified
      // This prevents false-positive failures from pre-existing project errors
      // when the agent only performed analysis without making changes
      let feedbackResult: import('../feedback/feedback-loop.js').FeedbackLoopResult;

      if (modifiedFiles.length === 0) {
        // No files modified - skip validation pipeline entirely
        await this.emitEvent(
          'validation_progress',
          'No files modified, skipping validation pipeline',
          {
            validationStep: 'skip',
            success: true,
          },
        );

        feedbackResult = {
          success: true,
          iterations: 0,
          maxIterations: this.feedbackLoop.getConfig().maxIterations,
          maxIterationsReached: false,
          totalDurationMs: 0,
          iterationResults: [],
          unresolvedErrors: [],
          resolvedErrors: [],
          summary: '✅ No files modified, validation skipped',
        };
      } else {
        // Use FeedbackLoop to attempt automatic error correction
        feedbackResult = await this.feedbackLoop.run(
          // Execute iteration: run validation pipeline
          async () => {
            const validationResult =
              await this.validationPipeline.run(gateWorkingDir);

            // Emit validation progress for each step
            for (const step of validationResult.steps) {
              await this.emitEvent(
                'validation_progress',
                `${step.step}: ${step.passed ? 'passed' : 'failed'} (${step.issues.length} issues)`,
                {
                  validationStep: step.step,
                  success: step.passed,
                  error: step.issues
                    .filter((i) => i.type === 'error')
                    .map((i) => i.message)
                    .join('; '),
                },
              );
            }

            // Collect all errors from validation steps
            const allErrors = validationResult.steps.flatMap((step) =>
              step.issues.filter((i) => i.type === 'error'),
            );

            // Record errors in memory for learning
            for (const step of validationResult.steps) {
              for (const issue of step.issues.filter(
                (i) => i.type === 'error',
              )) {
                this.errorMemory.recordError({
                  id: `${step.step}_${issue.line || 0}`,
                  category: this.mapValidationCategory(step.step),
                  message: issue.message,
                  file: issue.file,
                  line: issue.line,
                  occurrenceCount: 1,
                  autoFixable: false,
                });
              }
            }

            return {
              success: validationResult.success,
              errors: allErrors,
            };
          },
          // Retry strategy: use agents to fix errors
          async (errors, iteration, context) => {
            if (errors.length === 0) return [];

            // Build error summary for agents
            const errorSummary = errors
              .map(
                (e) =>
                  `- ${e.file || 'unknown'}:${e.line || '?'}: ${e.message}`,
              )
              .join('\n');

            // Get recent errors from ErrorMemory to avoid repeating the same mistakes
            const recentErrors = this.errorMemory.getRecentErrors(5);
            const errorMemorySection =
              recentErrors.length > 0
                ? `
## PREVIOUS ERRORS (learn from these - do NOT repeat the same mistakes):
${recentErrors.map((e) => `- [${e.category}] ${e.file || 'unknown'}:${e.line || '?'}: ${e.message} (occurred ${e.occurrenceCount}x)`).join('\n')}
`
                : '';

            // Get error patterns that keep occurring
            const frequentErrors = recentErrors.filter(
              (e) => e.occurrenceCount > 1,
            );
            const patternWarning =
              frequentErrors.length > 0
                ? `
⚠️ WARNING: The following errors have occurred multiple times. Pay special attention to fix them differently:
${frequentErrors.map((e) => `- ${e.message} (${e.occurrenceCount}x)`).join('\n')}
`
                : '';

            // Generate error-specific instructions based on error categories
            const errorCategories = new Set(errors.map((e) => e.category));
            const errorSpecificInstructions =
              this.generateErrorSpecificInstructions(errorCategories);

            const fixTask = `
Fix the following validation errors (iteration ${iteration}/${this.feedbackLoop.getConfig().maxIterations}):

## CURRENT ERRORS TO FIX:
${errorSummary}
${errorMemorySection}${patternWarning}
## CONTEXT
- Previous iterations: ${context.previousIterations.length}
- Working directory: ${context.workingDirectory}

## ERROR-SPECIFIC FIX STRATEGIES:
${errorSpecificInstructions}

## GENERAL INSTRUCTIONS
1. Analyze each error carefully
2. Apply the error-specific strategies above
3. Check if similar errors appeared before and AVOID the same fix approach
4. Apply different fix strategies if previous attempts failed
5. Verify your changes don't introduce new errors
          `.trim();

            // Re-execute relevant agents to fix errors
            if (!plan) {
              // No plan available, cannot re-execute agents
              return [];
            }

            for (const agentInfo of orderedAgents) {
              const agent = getAgentById(agentInfo.agent.id);
              if (!agent) continue;

              // Only use agents that can help with the error types
              const canHelp = this.agentCanFixErrors(agent, errors);
              if (!canHelp) continue;

              const execution = await this.executeAgent(agent, fixTask, plan);
              agentExecutions.push(execution);
            }

            return errors.map((error) => ({
              errorId: error.id,
              type: 'code_change' as const,
              description: `Agent attempted fix for: ${error.message}`,
              file: error.file,
              success: false, // Will be determined by next validation
            }));
          },
          // Context
          {
            previousIterations: [],
            taskDescription: task,
            workingDirectory: gateWorkingDir,
          },
        );
      } // End of else block (modifiedFiles.length > 0)

      // Run traditional quality gates after feedback loop
      const gateContext = {
        projectRoot: gateWorkingDir,
        modifiedFiles,
        agentId: 'orchestrator',
        taskDescription: task,
        trustLevel: TrustLevel.L2_GUIDED,
        options: {},
      };
      const gateResults = await this.gateRunner.runPostGates(gateContext);
      const allGatesPassed = gateResults.passed && feedbackResult.success;

      // Emit validation complete event
      await this.emitEvent(
        'validation_complete',
        allGatesPassed ? 'Validation passed' : 'Validation failed',
        {
          success: allGatesPassed,
          error: allGatesPassed
            ? undefined
            : gateResults.gates
                .filter((g) => !g.passed)
                .map((g) => g.message)
                .join('; '),
        },
      );

      // Only rollback if FeedbackLoop failed AND we have a snapshot
      if (
        !allGatesPassed &&
        snapshotId &&
        this.config.enableSnapshots !== false
      ) {
        const shouldRollback = await this.requestRollbackApproval(
          gateResults.gates,
        );
        if (shouldRollback) {
          // Emit rollback start event
          await this.emitEvent(
            'rollback_start',
            'Rolling back changes due to validation failure',
            {
              error: gateResults.gates
                .filter((g) => !g.passed)
                .map((g) => g.message)
                .join('; '),
            },
          );

          try {
            await this.snapshotManager.restoreSnapshot(snapshotId);
            rolledBack = true;

            // Emit rollback complete event
            await this.emitEvent(
              'rollback_complete',
              'Rollback completed successfully',
              {
                success: true,
              },
            );
          } catch (rollbackError) {
            console.error(
              'Rollback after validation failure failed:',
              rollbackError,
            );

            // Emit rollback error event
            await this.emitEvent('error', `Rollback failed: ${rollbackError}`, {
              success: false,
              error: String(rollbackError),
            });
          }
        }
      }

      // Phase 6: REPORT - Generate execution report
      await this.setPhase('REPORT');
      const overallSuccess =
        agentExecutions.every((e) => e.success) && allGatesPassed;

      return this.createReport(
        task,
        plan,
        agentExecutions,
        overallSuccess,
        undefined,
        startTime,
        gateResults.gates,
        snapshotId,
        rolledBack,
      );
    } catch (error) {
      // Handle unexpected errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Emit error event
      await this.emitEvent('error', `Task execution failed: ${errorMessage}`, {
        success: false,
        error: errorMessage,
      });

      // Attempt rollback on error
      if (snapshotId && this.config.enableSnapshots !== false) {
        // Emit rollback start event
        await this.emitEvent(
          'rollback_start',
          'Rolling back changes due to error',
          {
            error: errorMessage,
          },
        );

        try {
          await this.snapshotManager.restoreSnapshot(snapshotId);
          rolledBack = true;

          // Emit rollback complete event
          await this.emitEvent(
            'rollback_complete',
            'Rollback completed successfully',
            {
              success: true,
            },
          );
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);

          // Emit rollback error event
          await this.emitEvent('error', `Rollback failed: ${rollbackError}`, {
            success: false,
            error: String(rollbackError),
          });
        }
      }

      return this.createReport(
        task,
        plan,
        agentExecutions,
        false,
        errorMessage,
        startTime,
        undefined,
        snapshotId,
        rolledBack,
      );
    } finally {
      // Cleanup
      this.phaseCallbacks = this.phaseCallbacks.filter(
        (cb) => cb !== options?.onPhaseChange,
      );
      this.approvalCallbacks = this.approvalCallbacks.filter(
        (cb) => cb !== options?.onApprovalRequired,
      );
      this.eventCallbacks = this.eventCallbacks.filter(
        (cb) => cb !== options?.onEvent,
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
    // Unsubscribe from session events to prevent memory leaks
    if (this.sessionEventUnsubscribe) {
      this.sessionEventUnsubscribe();
      this.sessionEventUnsubscribe = null;
    }
    // Await the async closeAllSessions method
    await this.sessionManager.closeAllSessions();
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
      // Pass domain for accurate initial trust level calculation
      const trustLevel = this.trustEngine.calculateTrustLevel(
        agentInfo.agent.id,
        agentInfo.agent.domain,
      );
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

    return agents.some((agentInfo) => {
      const trustLevel = this.trustEngine.calculateTrustLevel(
        agentInfo.agent.id,
      );
      const privileges = this.trustEngine.getPrivileges(agentInfo.agent.id);
      // Require approval if privileges say so, or if trust level is below threshold
      return privileges.requiresApproval || trustLevel < threshold;
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
    gateResults: Array<{
      gateId: string;
      gateName: string;
      passed: boolean;
      message?: string;
    }>,
  ): Promise<boolean> {
    // In automated mode, auto-rollback on failure
    if (this.approvalCallbacks.length === 0) {
      return true;
    }

    // Otherwise, ask for approval
    const failedGates = gateResults.filter((r) => !r.passed);
    const rollbackPlan: ExecutionPlan = {
      task: 'Rollback due to validation failures',
      steps: [
        {
          order: 1,
          agentId: 'system',
          agentName: 'System Rollback',
          description: `Failed gates: ${failedGates.map((g) => g.gateName).join(', ')}`,
          trustLevel: TrustLevel.L4_AUTONOMOUS,
          privileges: this.trustEngine.getPrivileges('system'),
          estimatedComplexity: 'simple' as const,
        },
      ],
      totalAgents: 1,
      estimatedComplexity: 'simple',
      createdAt: new Date(),
    };

    return this.requestApproval(rollbackPlan);
  }

  /**
   * Default timeout for agent execution in milliseconds (2 minutes)
   * Reduced from 5 minutes to fail faster and prevent hanging agents
   * Can be overridden via OrchestratorConfig.agentTimeoutMs
   */
  private static readonly DEFAULT_AGENT_TIMEOUT_MS = 2 * 60 * 1000;

  /**
   * Execute a single agent with its task
   * Includes timeout protection to prevent hanging agents
   * Emits streaming events for real-time progress updates
   */
  private async executeAgent(
    agent: SpecializedAgent,
    task: string,
    plan: ExecutionPlan,
  ): Promise<AgentExecution> {
    const startTime = Date.now();
    // Pass domain for accurate initial trust level calculation
    const trustLevel = this.trustEngine.calculateTrustLevel(
      agent.id,
      agent.domain,
    );

    // Emit agent start event
    await this.emitEvent('agent_start', `Starting agent: ${agent.name}`, {
      agentId: agent.id,
      agentName: agent.name,
      domain: agent.domain,
    });

    // Build agent-specific task prompt
    const agentTask = this.buildAgentTask(agent, task, plan);

    // Use configured timeout or default
    const timeoutMs =
      this.config.agentTimeoutMs ??
      EnhancedAgentOrchestrator.DEFAULT_AGENT_TIMEOUT_MS;

    try {
      // Execute via session manager with timeout protection
      const result = await this.executeWithTimeout(
        this.sessionManager.executeAgentTask(agent, agentTask),
        timeoutMs,
        agent.id,
      );

      // Emit agent complete event
      await this.emitEvent(
        'agent_complete',
        `Agent ${agent.name} ${result.success ? 'completed successfully' : 'failed'}`,
        {
          agentId: agent.id,
          agentName: agent.name,
          domain: agent.domain,
          success: result.success,
          files: result.modifiedFiles,
          error: result.error,
        },
      );

      return {
        agentId: agent.id,
        agentName: agent.name,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
        trustLevel,
        toolsUsed: result.toolCalls?.map((tc) => tc.name) || [],
        filesModified: result.modifiedFiles || [],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Emit agent error event
      await this.emitEvent(
        'error',
        `Agent ${agent.name} error: ${errorMessage}`,
        {
          agentId: agent.id,
          agentName: agent.name,
          domain: agent.domain,
          success: false,
          error: errorMessage,
        },
      );

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
   * Execute a promise with a timeout
   * Rejects with a timeout error if the promise doesn't resolve in time
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    agentId: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Agent ${agentId} execution timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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
    const stepInfo = plan.steps?.find((s) => s.agentId === agent.id);

    // Include tech context if available
    const techContextSection = this.techContext
      ? this.analyzerAgent.generateContextSummary(this.techContext)
      : '';

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

${techContextSection ? `## Project Tech Context\n${techContextSection}\n` : ''}

## Your Responsibilities
${agent.qualityChecks.map((check) => `- ${check}`).join('\n')}

## Instructions
1. Analyze the task from your specialized perspective
2. Follow the project's coding conventions detected above
3. Execute only actions within your domain
4. Report your findings and any changes made
5. Flag any concerns or issues for review

Begin your analysis and execution now.
`.trim();
  }

  /**
   * Map validation step to error category
   */
  private mapValidationCategory(
    step: string,
  ):
    | 'type_error'
    | 'lint_error'
    | 'security_error'
    | 'test_failure'
    | 'unknown' {
    switch (step.toLowerCase()) {
      case 'typecheck':
        return 'type_error';
      case 'lint':
        return 'lint_error';
      case 'security':
        return 'security_error';
      case 'tests':
        return 'test_failure';
      default:
        return 'unknown';
    }
  }

  /**
   * Generate error-specific fix instructions based on error categories
   * This improves retry success rate by providing targeted guidance
   */
  private generateErrorSpecificInstructions(
    errorCategories: Set<string>,
  ): string {
    const instructions: string[] = [];

    if (errorCategories.has('type_error')) {
      instructions.push(`
### TypeScript Type Errors:
- Check for missing type imports (did you forget to import a type?)
- Verify function signatures match expected parameters
- Look for 'any' types that should be properly typed
- Check for nullable types (use optional chaining ?. or null checks)
- Ensure interfaces/types are properly exported where needed
- Use type assertions (as TypeName) only when you're certain of the type
- For generic types, verify all type parameters are specified
`);
    }

    if (errorCategories.has('lint_error')) {
      instructions.push(`
### ESLint/Lint Errors:
- Check for unused variables (remove or add _prefix if intentionally unused)
- Fix inconsistent indentation/formatting (use prettier if available)
- Remove console.log statements in production code
- Add missing semicolons or remove extra ones (based on project style)
- Fix import ordering (group by type: external, internal, relative)
- Address any-type warnings by adding proper types
- Fix missing return statements in functions
`);
    }

    if (errorCategories.has('security_error')) {
      instructions.push(`
### Security Errors:
- NEVER use eval() or Function() constructor
- Sanitize user inputs before using in queries or commands
- Use parameterized queries for database operations
- Avoid hardcoded secrets - use environment variables
- Validate and sanitize all external data
- Use HTTPS for external API calls
- Implement proper authentication checks before sensitive operations
- Escape HTML output to prevent XSS
`);
    }

    if (errorCategories.has('test_failure')) {
      instructions.push(`
### Test Failures:
- Read the test assertion failure message carefully
- Check if the expected vs actual values match
- Verify mock setup is correct (are mocks returning expected values?)
- Check async test timing (use await, done(), or increase timeout)
- Ensure test fixtures/setup is complete
- Look for order-dependent tests (tests should be independent)
- Check if implementation logic matches test expectations
- For snapshot tests, update snapshots if changes are intentional
`);
    }

    if (errorCategories.has('unknown') || instructions.length === 0) {
      instructions.push(`
### General/Unknown Error Fix Guidelines:
- Read the error message carefully - it often tells you exactly what's wrong
- Check the line number and surrounding context
- Look for similar patterns in the codebase that work correctly
- Consider if recent changes might have broken something
- Check imports and exports are correct
- Verify file paths and references are valid
- For HTML/CSS/JS: check syntax, missing closing tags, or typos
- For new files: ensure all required dependencies are in place
`);
    }

    return instructions.join('\n');
  }

  /**
   * Determine if an agent can help fix specific error types
   */
  private agentCanFixErrors(
    agent: SpecializedAgent,
    errors: FeedbackError[],
  ): boolean {
    // Map agent domains to error categories they can fix
    // Note: 'unknown' errors are included for general/frontend/backend agents
    // to allow them to attempt fixes on uncategorized errors
    const domainToErrorCategories: Record<string, string[]> = {
      frontend: ['type_error', 'lint_error', 'syntax_error', 'unknown'],
      backend: [
        'type_error',
        'lint_error',
        'syntax_error',
        'runtime_error',
        'unknown',
      ],
      security: ['security_error'],
      testing: ['test_failure'],
      database: ['type_error', 'configuration_error'],
      devops: ['configuration_error', 'dependency_error'],
      'ai-ml': ['type_error', 'lint_error', 'unknown'],
      documentation: [], // Documentation agents don't fix code errors
      general: [
        'type_error',
        'lint_error',
        'syntax_error',
        'runtime_error',
        'unknown',
      ], // General can attempt any code fix
    };

    const agentCategories = domainToErrorCategories[agent.domain] || [
      'type_error',
      'lint_error',
      'unknown',
    ];
    const errorCategories = new Set(errors.map((e) => e.category));

    // Check if agent can fix any of the error categories
    return agentCategories.some((cat) => errorCategories.has(cat as never));
  }

  /**
   * Get the current tech context (for external access)
   */
  getTechContext(): TechContextDocument | null {
    return this.techContext;
  }

  /**
   * Get error memory statistics
   */
  getErrorMemoryStats() {
    return this.errorMemory.getStats();
  }

  /**
   * Get the feedback loop for external access (e.g., retry workflows)
   */
  getFeedbackLoop(): FeedbackLoop {
    return this.feedbackLoop;
  }

  /**
   * Determine if execution should stop on agent failure
   */
  private shouldStopOnFailure(agent: SpecializedAgent): boolean {
    // Stop on failure for supervised/guided agents
    // Pass domain for accurate trust level calculation
    const trustLevel = this.trustEngine.calculateTrustLevel(
      agent.id,
      agent.domain,
    );
    return (
      trustLevel === TrustLevel.L1_SUPERVISED ||
      trustLevel === TrustLevel.L2_GUIDED
    );
  }

  /**
   * Domain execution order for implicit consensus
   * Earlier domains must complete before later ones
   */
  private static readonly DOMAIN_ORDER: Record<string, number> = {
    security: 1, // Security validation first
    database: 2, // Schema before backend
    backend: 3, // API before frontend
    'ai-ml': 3, // AI alongside backend
    frontend: 4, // UI after backend
    testing: 5, // Tests after implementation
    documentation: 6, // Docs after testing
    devops: 7, // DevOps last
  };

  /**
   * Create parallel execution groups based on domain dependencies
   * Agents in the same group can run in parallel
   */
  private createParallelGroups(
    agents: Array<{ agent: SpecializedAgent; score: number }>,
  ): ParallelExecutionGroup[] {
    // Group agents by domain order
    const domainGroups = new Map<number, SpecializedAgent[]>();

    for (const agentInfo of agents) {
      const domain = agentInfo.agent.domain;
      const order =
        EnhancedAgentOrchestrator.DOMAIN_ORDER[domain] ||
        EnhancedAgentOrchestrator.DOMAIN_ORDER['frontend']; // Default to frontend order

      if (!domainGroups.has(order)) {
        domainGroups.set(order, []);
      }
      domainGroups.get(order)!.push(agentInfo.agent);
    }

    // Convert to ParallelExecutionGroup array, sorted by order
    const groups: ParallelExecutionGroup[] = [];
    const sortedOrders = Array.from(domainGroups.keys()).sort((a, b) => a - b);

    for (const order of sortedOrders) {
      const agentsInGroup = domainGroups.get(order)!;
      const domains = [...new Set(agentsInGroup.map((a) => a.domain))];

      groups.push({
        order,
        domains,
        agentIds: agentsInGroup.map((a) => a.id),
        waitForPrevious: order > 1, // Wait for previous group except first
      });
    }

    return groups;
  }

  /**
   * Execute multiple agents in parallel with concurrency limit
   */
  private async executeAgentsParallel(
    agents: SpecializedAgent[],
    task: string,
    plan: ExecutionPlan,
    maxConcurrent: number,
  ): Promise<AgentExecution[]> {
    const results: AgentExecution[] = [];

    // Process agents in batches to respect concurrency limit
    for (let i = 0; i < agents.length; i += maxConcurrent) {
      const batch = agents.slice(i, i + maxConcurrent);
      const batchPromises = batch.map((agent) =>
        this.executeAgent(agent, task, plan),
      );
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Create the final execution report
   * @param rolledBack - Whether a rollback was performed during execution (notifies user)
   */
  private createReport(
    task: string,
    plan: ExecutionPlan | undefined,
    agentExecutions: AgentExecution[],
    success: boolean,
    error: string | undefined,
    startTime: number,
    gateResults?: Array<{
      gateId: string;
      gateName: string;
      passed: boolean;
      message?: string;
    }>,
    snapshotId?: string,
    rolledBack?: boolean,
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
      rolledBack: rolledBack ?? false,
      totalDurationMs: Date.now() - startTime,
      completedAt: new Date(),
    };
  }
}
