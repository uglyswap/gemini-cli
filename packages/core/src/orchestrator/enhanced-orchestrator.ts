/**
 * Enhanced Agent Orchestrator
 * Main orchestration system integrating Trust Cascade, Multi-Agent, and Safety Net
 */

import * as crypto from 'crypto';
import {
  OrchestratorConfig,
  OrchestratorTask,
  TaskExecutionResult,
  AgentExecutionResult,
  ExecutionPhase,
  PhaseCallback,
  ApprovalCallback,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './types.js';
import { TrustCascadeEngine } from '../trust/trust-engine.js';
import { TrustLevel, TrustPrivileges } from '../trust/types.js';
import { AgentSelector } from '../agents/specialized/agent-selector.js';
import { AgentSpecialization, AgentContext, TaskComplexity } from '../agents/specialized/types.js';
import { AGENT_REGISTRY, getAgentById } from '../agents/specialized/agent-registry.js';
import { SnapshotManager } from '../safety/snapshot/snapshot-manager.js';
import { GateRunner } from '../safety/quality-gates/gate-runner.js';
import { GateContext } from '../safety/quality-gates/types.js';

/**
 * Enhanced Agent Orchestrator
 * Coordinates multi-agent execution with trust management and safety features
 */
export class EnhancedAgentOrchestrator {
  private config: OrchestratorConfig;
  private trustEngine: TrustCascadeEngine;
  private agentSelector: AgentSelector;
  private snapshotManager: SnapshotManager;
  private gateRunner: GateRunner;
  
  private phaseCallbacks: PhaseCallback[] = [];
  private approvalCallback?: ApprovalCallback;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    
    // Initialize subsystems
    this.trustEngine = new TrustCascadeEngine(this.config.projectRoot);
    this.agentSelector = new AgentSelector({
      maxAgents: this.config.maxAgentsPerTask,
      debug: this.config.verbose,
    });
    this.snapshotManager = new SnapshotManager(this.config.projectRoot);
    this.gateRunner = new GateRunner({
      strictMode: this.config.strictQualityGates,
      verbose: this.config.verbose,
    });
  }

  /**
   * Register a callback for phase transitions
   */
  onPhaseChange(callback: PhaseCallback): void {
    this.phaseCallbacks.push(callback);
  }

  /**
   * Set the approval callback for user confirmation
   */
  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
  }

  /**
   * Execute a task through the orchestration pipeline
   */
  async executeTask(task: OrchestratorTask): Promise<TaskExecutionResult> {
    const taskId = this.generateTaskId();
    const startTime = Date.now();
    
    this.log(`\n${'='.repeat(60)}`);
    this.log(`[Orchestrator] Task ${taskId}: ${task.description.slice(0, 50)}...`);
    this.log('='.repeat(60));

    // Initialize result object
    const result: TaskExecutionResult = {
      success: false,
      taskId,
      taskDescription: task.description,
      complexity: 'moderate',
      agentResults: [],
      averageQuality: 0,
      rolledBack: false,
      totalDurationMs: 0,
      allModifiedFiles: [],
      trustLevels: {},
      finalPhase: 'init',
      errors: [],
      warnings: [],
    };

    try {
      // ========================================
      // PHASE 0: INITIALIZATION
      // ========================================
      await this.emitPhase('init', { task, taskId });
      
      // Analyze task and select agents
      const selectionResult = this.config.enableMultiAgent
        ? this.agentSelector.selectAgents(task.description)
        : { 
            agents: [AGENT_REGISTRY.find(a => a.id === 'backend-developer')!],
            complexity: 'moderate' as TaskComplexity,
            scores: new Map(),
            reasoning: 'Multi-agent disabled, using default agent',
          };

      // Apply forced/skipped agents
      let selectedAgents = this.applyAgentOverrides(
        selectionResult.agents,
        task.forceAgents,
        task.skipAgents
      );

      // Get execution order
      selectedAgents = this.agentSelector.getExecutionOrder(selectedAgents);

      result.complexity = selectionResult.complexity;

      this.log(`[Orchestrator] Complexity: ${result.complexity}`);
      this.log(`[Orchestrator] Selected agents: ${selectedAgents.map(a => a.name).join(' \u2192 ')}`);

      // Calculate trust levels
      const agentTrustLevels = new Map<string, TrustLevel>();
      let lowestTrustLevel = TrustLevel.L4_AUTONOMOUS;

      if (this.config.enableTrustCascade) {
        for (const agent of selectedAgents) {
          const level = this.trustEngine.calculateTrustLevel(agent.id);
          agentTrustLevels.set(agent.id, level);
          result.trustLevels[agent.id] = level;
          if (level < lowestTrustLevel) {
            lowestTrustLevel = level;
          }
          this.log(`[Trust] ${agent.name}: ${TrustLevel[level]}`);
        }
      }

      // Check for quarantined agents
      const quarantinedAgents = selectedAgents.filter(
        a => agentTrustLevels.get(a.id) === TrustLevel.L0_QUARANTINE
      );
      if (quarantinedAgents.length > 0) {
        result.errors.push(
          `Quarantined agents detected: ${quarantinedAgents.map(a => a.name).join(', ')}`
        );
        result.finalPhase = 'error';
        return this.finalizeResult(result, startTime);
      }

      // ========================================
      // PHASE 1: EXPLAIN (if low trust)
      // ========================================
      if (lowestTrustLevel <= TrustLevel.L2_GUIDED && task.requireApproval !== false) {
        await this.emitPhase('explain', { selectedAgents, selectionResult });
        
        const context: AgentContext = {
          originalTask: task.description,
          modifiedFiles: [],
          readFiles: [],
          errors: [],
          warnings: [],
          metadata: {},
        };

        // Request approval if callback is set
        if (this.approvalCallback) {
          const approved = await this.approvalCallback(task, selectedAgents, context);
          if (!approved) {
            result.errors.push('User did not approve the execution plan');
            result.finalPhase = 'explain';
            return this.finalizeResult(result, startTime);
          }
        }
      }

      // ========================================
      // PHASE 2: SAFETY SNAPSHOT
      // ========================================
      if (this.config.enableSnapshots && 
          lowestTrustLevel <= this.config.snapshotTrustThreshold) {
        await this.emitPhase('snapshot', { lowestTrustLevel });
        
        const filesToSnapshot = task.affectedFiles || [];
        
        if (filesToSnapshot.length > 0) {
          const snapshot = await this.snapshotManager.createSnapshot(
            filesToSnapshot,
            `Pre-task: ${task.description.slice(0, 50)}...`,
            {
              agentId: selectedAgents[0]?.id || 'orchestrator',
              taskDescription: task.description,
              trustLevel: lowestTrustLevel,
              complexity: result.complexity,
            }
          );
          result.snapshotId = snapshot.id;
          this.log(`[Snapshot] Created: ${snapshot.id}`);
        }
      }

      // ========================================
      // PHASE 3: PRE-EXECUTION GATES
      // ========================================
      if (this.config.enableQualityGates) {
        const gateContext: GateContext = {
          projectRoot: this.config.projectRoot,
          modifiedFiles: task.affectedFiles || [],
          agentId: selectedAgents[0]?.id || 'orchestrator',
          taskDescription: task.description,
          trustLevel: lowestTrustLevel,
          options: {},
        };

        result.preGateResults = await this.gateRunner.runPreGates(
          gateContext,
          selectedAgents[0]?.domain
        );

        if (!result.preGateResults.passed) {
          result.errors.push('Pre-execution quality gates failed');
          result.errors.push(...result.preGateResults.blockingIssues.map(i => i.message));
          result.finalPhase = 'error';
          return this.finalizeResult(result, startTime);
        }
      }

      // ========================================
      // PHASE 4: AGENT EXECUTION
      // ========================================
      await this.emitPhase('execute', { agents: selectedAgents });

      let previousContext = '';
      let allSuccess = true;

      for (const agent of selectedAgents) {
        const trustLevel = agentTrustLevels.get(agent.id) || TrustLevel.L1_SUPERVISED;
        const privileges = this.config.enableTrustCascade
          ? this.trustEngine.getPrivileges(agent.id)
          : this.getDefaultPrivileges();

        this.log(`\n[Executing] ${agent.name} (${TrustLevel[trustLevel]})`);

        const agentResult = await this.executeSingleAgent(
          agent,
          task,
          previousContext,
          trustLevel,
          privileges
        );

        result.agentResults.push(agentResult);
        result.allModifiedFiles.push(...agentResult.modifiedFiles);

        // Record execution for trust cascade
        if (this.config.enableTrustCascade) {
          this.trustEngine.recordExecution(agent.id, {
            success: agentResult.success,
            qualityScore: agentResult.qualityScore,
            durationMs: agentResult.durationMs,
            complexity: result.complexity,
            isCriticalFailure: agentResult.isCriticalFailure,
            isSecurityIssue: agentResult.isSecurityIssue,
            errorDetails: agentResult.error,
          });
        }

        if (!agentResult.success) {
          allSuccess = false;
          result.errors.push(`Agent ${agent.name} failed: ${agentResult.error}`);

          // Consider stopping on failure for low trust levels
          if (trustLevel <= TrustLevel.L1_SUPERVISED) {
            this.log(`[Orchestrator] Stopping due to failure at low trust level`);
            break;
          }
        }

        // Pass context to next agent
        previousContext = agentResult.contextForNext || '';
      }

      // ========================================
      // PHASE 5: POST-EXECUTION VALIDATION
      // ========================================
      await this.emitPhase('validate', { agentResults: result.agentResults });

      if (this.config.enableQualityGates) {
        const gateContext: GateContext = {
          projectRoot: this.config.projectRoot,
          modifiedFiles: result.allModifiedFiles,
          agentId: 'orchestrator',
          taskDescription: task.description,
          trustLevel: lowestTrustLevel,
          options: {},
        };

        result.postGateResults = await this.gateRunner.runPostGates(
          gateContext,
          selectedAgents[0]?.domain
        );

        if (!result.postGateResults.passed && this.config.strictQualityGates) {
          result.warnings.push('Post-execution quality gates failed');
          result.warnings.push(...result.postGateResults.blockingIssues.map(i => i.message));
          allSuccess = false;
        }
      }

      // ========================================
      // PHASE 6: HANDLE FAILURE / ROLLBACK
      // ========================================
      if (!allSuccess && this.config.autoRollbackOnFailure && result.snapshotId) {
        await this.emitPhase('rollback', { snapshotId: result.snapshotId });
        
        if (lowestTrustLevel <= TrustLevel.L1_SUPERVISED) {
          this.log(`[Orchestrator] Auto-rolling back due to failure at low trust level`);
          
          await this.snapshotManager.restoreSnapshot(result.snapshotId);
          result.rolledBack = true;
          result.rollbackReason = 'Automatic rollback due to execution failure';
        }
      }

      result.success = allSuccess && !result.rolledBack;
      result.finalPhase = 'report';

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      result.finalPhase = 'error';
      
      // Attempt rollback on error
      if (this.config.autoRollbackOnFailure && result.snapshotId) {
        try {
          await this.snapshotManager.restoreSnapshot(result.snapshotId);
          result.rolledBack = true;
          result.rollbackReason = 'Automatic rollback due to execution error';
        } catch {
          result.errors.push('Rollback also failed');
        }
      }
    }

    // ========================================
    // PHASE 7: FINAL REPORT
    // ========================================
    await this.emitPhase('report', result);
    
    return this.finalizeResult(result, startTime);
  }

  /**
   * Get trust engine for external access
   */
  getTrustEngine(): TrustCascadeEngine {
    return this.trustEngine;
  }

  /**
   * Get snapshot manager for external access
   */
  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  /**
   * Get gate runner for external access
   */
  getGateRunner(): GateRunner {
    return this.gateRunner;
  }

  // Private methods

  private async executeSingleAgent(
    agent: AgentSpecialization,
    task: OrchestratorTask,
    previousContext: string,
    trustLevel: TrustLevel,
    privileges: TrustPrivileges
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      // Build enhanced prompt
      const prompt = this.buildAgentPrompt(agent, task, previousContext, privileges);

      // This is where the actual LLM execution would happen
      // For now, we return a placeholder result
      // In a real implementation, this would call LocalAgentExecutor
      
      const output = await this.simulateAgentExecution(agent, prompt, trustLevel);

      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        success: true,
        qualityScore: 85 + Math.random() * 15, // Simulated score
        durationMs: Date.now() - startTime,
        output,
        modifiedFiles: [],
        contextForNext: `Completed by ${agent.name}: ${task.description.slice(0, 100)}`,
        trustLevel,
      };
    } catch (error) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        success: false,
        qualityScore: 30,
        durationMs: Date.now() - startTime,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        isCriticalFailure: this.isCriticalError(error),
        isSecurityIssue: this.isSecurityError(error),
        modifiedFiles: [],
        trustLevel,
      };
    }
  }

  private buildAgentPrompt(
    agent: AgentSpecialization,
    task: OrchestratorTask,
    previousContext: string,
    privileges: TrustPrivileges
  ): string {
    return `${agent.systemPrompt}

## Current Task
${task.description}

${task.userContext ? `## User Context\n${task.userContext}\n` : ''}
${previousContext ? `## Context from Previous Agent\n${previousContext}\n` : ''}

## Your Privileges (Trust-Based)
- Skip explanations: ${privileges.skipExplainFirst}
- Auto-approve changes: ${privileges.autoApproveChanges}
- Allowed operations: ${privileges.allowedOperations.join(', ')}
- Max files per operation: ${privileges.maxFilesPerOperation}
- Max retries: ${privileges.maxRetries}

## Quality Checklist
Before completing, verify:
${agent.qualityChecks.map(c => `- [ ] ${c}`).join('\n')}

## Output Format
When done, clearly state:
1. What was accomplished
2. Files modified
3. Any issues found
4. Context for next agent (if applicable)
`;
  }

  private async simulateAgentExecution(
    agent: AgentSpecialization,
    _prompt: string,
    _trustLevel: TrustLevel
  ): Promise<unknown> {
    // This is a placeholder for actual LLM execution
    // In a real implementation, this would:
    // 1. Create a LocalAgentExecutor with the agent config
    // 2. Run the agent with the prompt
    // 3. Return the structured output

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      summary: `Agent ${agent.name} executed successfully`,
      completed: true,
    };
  }

  private applyAgentOverrides(
    agents: AgentSpecialization[],
    forceAgents?: string[],
    skipAgents?: string[]
  ): AgentSpecialization[] {
    let result = [...agents];

    // Add forced agents
    if (forceAgents && forceAgents.length > 0) {
      for (const agentId of forceAgents) {
        const agent = getAgentById(agentId);
        if (agent && !result.find(a => a.id === agentId)) {
          result.push(agent);
        }
      }
    }

    // Remove skipped agents
    if (skipAgents && skipAgents.length > 0) {
      result = result.filter(a => !skipAgents.includes(a.id));
    }

    return result;
  }

  private getDefaultPrivileges(): TrustPrivileges {
    return {
      skipExplainFirst: false,
      skipDiffPreview: false,
      autoApproveChanges: false,
      skipCodeReview: false,
      directCommit: false,
      maxParallelAgents: 1,
      maxRetries: 2,
      allowedOperations: ['read', 'write'],
      maxFilesPerOperation: 10,
    };
  }

  private finalizeResult(
    result: TaskExecutionResult,
    startTime: number
  ): TaskExecutionResult {
    result.totalDurationMs = Date.now() - startTime;
    
    // Calculate average quality
    if (result.agentResults.length > 0) {
      result.averageQuality = result.agentResults.reduce(
        (sum, r) => sum + r.qualityScore, 0
      ) / result.agentResults.length;
    }

    // Deduplicate modified files
    result.allModifiedFiles = [...new Set(result.allModifiedFiles)];

    // Log final report
    this.printReport(result);

    return result;
  }

  private printReport(result: TaskExecutionResult): void {
    console.log('\n' + '='.repeat(60));
    console.log(`Task ${result.success ? 'COMPLETED' : 'FAILED'}: ${result.taskDescription.slice(0, 50)}...`);
    console.log('='.repeat(60));
    console.log();
    console.log('Agents Executed:');
    console.log('-'.repeat(60));
    
    for (const agent of result.agentResults) {
      const status = agent.success ? '\u2713' : '\u2717';
      console.log(
        `${status} ${agent.agentName.padEnd(25)} | ` +
        `Score: ${agent.qualityScore.toFixed(0).padStart(3)}% | ` +
        `${agent.durationMs}ms | ` +
        `${TrustLevel[agent.trustLevel]}`
      );
    }
    
    console.log('-'.repeat(60));
    console.log(`Overall Quality: ${result.averageQuality.toFixed(1)}%`);
    console.log(`Total Duration: ${result.totalDurationMs}ms`);
    console.log(`Files Modified: ${result.allModifiedFiles.length}`);
    
    if (result.snapshotId) {
      console.log(`Snapshot: ${result.snapshotId}`);
    }
    
    if (result.rolledBack) {
      console.log(`\u26A0 ROLLED BACK: ${result.rollbackReason}`);
    }
    
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) {
        console.log(`  \u2717 ${error}`);
      }
    }
    
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of result.warnings) {
        console.log(`  \u26A0 ${warning}`);
      }
    }
    
    console.log('='.repeat(60) + '\n');
  }

  private async emitPhase(phase: ExecutionPhase, data: unknown): Promise<void> {
    for (const callback of this.phaseCallbacks) {
      await callback(phase, data);
    }
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private isCriticalError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    return msg.includes('data loss') || 
           msg.includes('corruption') || 
           msg.includes('critical');
  }

  private isSecurityError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    return msg.includes('security') || 
           msg.includes('vulnerability') || 
           msg.includes('injection');
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}
