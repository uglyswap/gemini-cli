/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Orchestrator Integration
 * Integrates the 3-layer TODO system with the EnhancedAgentOrchestrator
 */

import type { AgenticTodo, TodoManagerConfig, TodoEvent } from './types.js';
import type { PlanningSystem } from './index.js';
import { createPlanningSystem } from './index.js';
import type {
  ExecutionPlan,
  ExecutionReport,
  ExecutionPhase,
} from '../orchestrator/types.js';

/**
 * Extended execution options with planning support
 */
export interface PlanningExecutionOptions {
  /** Create todo items for each agent step */
  createTodosForSteps?: boolean;
  /** Inject planning context into agent prompts */
  injectPlanningContext?: boolean;
  /** Auto-compact before execution if needed */
  autoCompactBeforeExecution?: boolean;
  /** Maximum context tokens for planning */
  maxPlanningContextTokens?: number;
}

/**
 * Planning-enhanced execution report
 */
export interface PlanningExecutionReport extends ExecutionReport {
  /** Planning context that was injected */
  planningContext?: string;
  /** Todos created during execution */
  createdTodos: AgenticTodo[];
  /** Todos completed during execution */
  completedTodos: AgenticTodo[];
  /** Compaction performed? */
  compactionPerformed: boolean;
}

/**
 * Orchestrator Planning Bridge
 * Connects the planning system with the orchestrator workflow
 */
export class OrchestratorPlanningBridge {
  private readonly planningSystem: PlanningSystem;
  private readonly options: PlanningExecutionOptions;

  constructor(
    projectRoot: string,
    planningConfig: Partial<TodoManagerConfig> = {},
    options: PlanningExecutionOptions = {},
  ) {
    this.planningSystem = createPlanningSystem(projectRoot, planningConfig);
    this.options = {
      createTodosForSteps: true,
      injectPlanningContext: true,
      autoCompactBeforeExecution: true,
      maxPlanningContextTokens: 4000,
      ...options,
    };
  }

  /**
   * Get the planning system components
   */
  get todoManager() {
    return this.planningSystem.todoManager;
  }

  get contextManager() {
    return this.planningSystem.contextManager;
  }

  get hooksManager() {
    return this.planningSystem.hooksManager;
  }

  // ==========================================================================
  // Pre-Execution Hooks
  // ==========================================================================

  /**
   * Prepare planning context before task execution
   */
  async prepareForExecution(task: string): Promise<{
    planningContext: string;
    compactionPerformed: boolean;
  }> {
    let compactionPerformed = false;

    // Set task description
    this.todoManager.setTaskDescription(task);
    this.todoManager.setCurrentFocus(task);

    // Auto-compact if needed
    if (this.options.autoCompactBeforeExecution) {
      const result = await this.hooksManager.checkAndCompact();
      compactionPerformed = result.compacted;
    }

    // Generate planning context
    const planningContext = this.options.injectPlanningContext
      ? this.contextManager.generateContextInjection(
          this.options.maxPlanningContextTokens,
        ).systemContext
      : '';

    return { planningContext, compactionPerformed };
  }

  /**
   * Create todos from execution plan
   * @param plan The execution plan to create todos from
   * @param parentTodoId Optional parent todo ID to nest under (currently unused, reserved for future hierarchical plans)
   */
  createTodosFromPlan(
    plan: ExecutionPlan,
    parentTodoId?: string,
  ): AgenticTodo[] {
    // parentTodoId is reserved for future use in hierarchical execution plans
    void parentTodoId;

    if (!this.options.createTodosForSteps) {
      return [];
    }

    const createdTodos: AgenticTodo[] = [];

    // Create a parent todo for the overall task
    const mainTodo = this.todoManager.createTodo({
      content: `Execute: ${plan.task.substring(0, 100)}${plan.task.length > 100 ? '...' : ''}`,
      activeForm: `Executing: ${plan.task.substring(0, 100)}${plan.task.length > 100 ? '...' : ''}`,
      priority: 8,
      tags: ['orchestration', 'multi-agent'],
    });
    createdTodos.push(mainTodo);

    // Sort steps by order to ensure correct dependency chain
    const sortedSteps = [...(plan.steps || [])].sort(
      (a, b) => a.order - b.order,
    );

    // Map step.order -> todoId for dependency resolution
    const stepOrderToTodoId = new Map<number, string>();

    // Create subtasks for each agent step
    for (const step of sortedSteps) {
      // Find the previous step's todo ID for dependency
      const previousStepOrder = step.order - 1;
      const previousTodoId = stepOrderToTodoId.get(previousStepOrder);

      const stepTodo = this.todoManager.createTodo({
        content: `[Step ${step.order}] ${step.agentName}: ${step.description}`,
        activeForm: `[Step ${step.order}] Running ${step.agentName}`,
        priority: 7,
        assignedAgentId: step.agentId,
        trustLevelRequired: step.trustLevel,
        parentTaskId: mainTodo.id,
        // Depend on previous step's todo if it exists
        dependencies: previousTodoId ? [previousTodoId] : [],
        tags: ['agent-step', step.agentId],
      });

      stepOrderToTodoId.set(step.order, stepTodo.id);
      createdTodos.push(stepTodo);
    }

    return createdTodos;
  }

  // ==========================================================================
  // Execution Phase Handlers
  // ==========================================================================

  /**
   * Handle phase change events
   */
  onPhaseChange(phase: ExecutionPhase, activeStepTodo?: AgenticTodo): void {
    // Record phase as a decision
    this.todoManager.recordDecision(
      `Entered phase: ${phase}`,
      `Orchestrator workflow phase transition`,
      undefined,
      activeStepTodo?.id,
    );

    // Update focus based on phase
    this.todoManager.setCurrentFocus(`Phase: ${phase}`);
  }

  /**
   * Start an agent step
   */
  startAgentStep(agentId: string, todoId?: string): void {
    if (todoId) {
      this.todoManager.startTodo(todoId, agentId);
    }

    // Set as important value
    this.todoManager.setImportantValue('currentAgent', agentId);
  }

  /**
   * Complete an agent step
   */
  completeAgentStep(
    agentId: string,
    success: boolean,
    output: string,
    filesModified: string[],
    todoId?: string,
  ): void {
    if (todoId) {
      const todo = this.todoManager.findTodo(todoId);
      if (todo) {
        // Add files to context
        for (const file of filesModified) {
          this.todoManager.addFileToTodo(todoId, file);
        }

        // Complete or block based on result
        if (success) {
          this.todoManager.completeTodo(todoId, {
            success: true,
            output: output.substring(0, 500),
            filesModified,
          });
        } else {
          this.todoManager.blockTodo(todoId, [
            output || 'Agent execution failed',
          ]);
        }
      }
    }

    // Clear current agent
    this.todoManager.setImportantValue('currentAgent', '');
  }

  /**
   * Handle validation results
   */
  handleValidationResults(
    passed: boolean,
    gateResults: Array<{
      gateId: string;
      gateName: string;
      passed: boolean;
      message?: string;
    }>,
    mainTodoId?: string,
  ): void {
    // Record validation as decision
    const failedGates = gateResults.filter((g) => !g.passed);
    this.todoManager.recordDecision(
      passed
        ? 'All quality gates passed'
        : `Quality gates failed: ${failedGates.map((g) => g.gateName).join(', ')}`,
      passed
        ? 'Execution completed successfully'
        : `Failed gates: ${failedGates.map((g) => g.message || g.gateName).join('; ')}`,
      undefined,
      mainTodoId,
    );

    // Update main todo
    if (mainTodoId) {
      if (passed) {
        this.todoManager.completeTodo(mainTodoId, {
          success: true,
          output: 'All quality gates passed',
          qualityScore: 100,
        });
      } else {
        this.todoManager.blockTodo(
          mainTodoId,
          failedGates.map((g) => `${g.gateName}: ${g.message || 'failed'}`),
        );
      }
    }
  }

  // ==========================================================================
  // Post-Execution
  // ==========================================================================

  /**
   * Finalize execution and generate enhanced report
   */
  finalizeExecution(
    baseReport: ExecutionReport,
    createdTodos: AgenticTodo[],
    planningContext: string,
    compactionPerformed: boolean,
  ): PlanningExecutionReport {
    // Get completed todos
    const allTodos = this.todoManager.getAllTodos();
    const completedTodos = allTodos.filter((t) => t.status === 'completed');

    // Update work summary
    if (baseReport.success) {
      const agentNames =
        baseReport.agentExecutions?.map((e) => e.agentName).join(', ') ||
        'none';
      const summary =
        `Task completed: ${baseReport.task}\n` +
        `Duration: ${baseReport.totalDurationMs}ms\n` +
        `Agents used: ${agentNames}`;
      this.todoManager.appendToScratchpad(summary);
    }

    // Save session
    this.todoManager.save();

    return {
      ...baseReport,
      planningContext,
      createdTodos,
      completedTodos,
      compactionPerformed,
    };
  }

  // ==========================================================================
  // Context Injection
  // ==========================================================================

  /**
   * Generate context to inject into agent prompts
   */
  generateAgentContextInjection(agentId: string): string {
    const minimalReminder = this.contextManager.generateMinimalReminder();
    const currentAgent = this.todoManager.getImportantValue('currentAgent');

    return `${minimalReminder}
<agent-context agent="${agentId}" current="${currentAgent === agentId}">
</agent-context>`;
  }

  /**
   * Get context dump for debugging/logging
   */
  getFullContextDump(): string {
    return this.todoManager.getContextDump();
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to todo events
   */
  onTodoEvent(handler: (event: TodoEvent) => void): () => void {
    return this.todoManager.on(handler);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.planningSystem.dispose();
  }
}

/**
 * Create an orchestrator planning bridge
 */
export function createOrchestratorPlanningBridge(
  projectRoot: string,
  planningConfig?: Partial<TodoManagerConfig>,
  options?: PlanningExecutionOptions,
): OrchestratorPlanningBridge {
  return new OrchestratorPlanningBridge(projectRoot, planningConfig, options);
}

// ==========================================================================
// Integration Helpers
// ==========================================================================

/**
 * Build planning-enhanced agent prompt
 */
export function buildPlanningEnhancedPrompt(
  originalPrompt: string,
  planningContext: string,
  agentContext: string,
): string {
  return `${planningContext}

${agentContext}

${originalPrompt}`;
}

/**
 * Maximum input length for todo extraction to prevent ReDoS attacks
 */
const MAX_TODO_EXTRACTION_INPUT_LENGTH = 100_000;

/**
 * Extract todo operations from agent output
 * Includes ReDoS protection via input length limiting and bounded patterns
 */
export function extractTodoOperationsFromOutput(output: string): Array<{
  operation: 'create' | 'complete' | 'block';
  content: string;
  blockers?: string[];
}> {
  const operations: Array<{
    operation: 'create' | 'complete' | 'block';
    content: string;
    blockers?: string[];
  }> = [];

  // ReDoS protection: limit input length
  if (output.length > MAX_TODO_EXTRACTION_INPUT_LENGTH) {
    console.warn(
      `[TodoExtraction] Input exceeds ${MAX_TODO_EXTRACTION_INPUT_LENGTH} chars, truncating`,
    );
    output = output.slice(0, MAX_TODO_EXTRACTION_INPUT_LENGTH);
  }

  // Use bounded patterns with explicit character classes to prevent ReDoS
  // [^\n]* is safer than .+? as it can't backtrack across newlines
  const todoCreatePattern = /\[TODO:CREATE\]\s*([^\n]+?)(?:\n|$)/g;
  const todoCompletePattern = /\[TODO:COMPLETE\]\s*([^\n]+?)(?:\n|$)/g;
  // For block pattern, use [^\n|]+ to match content before pipe
  const todoBlockPattern =
    /\[TODO:BLOCK\]\s*([^\n|]+?)\s*\|\s*([^\n]+?)(?:\n|$)/g;

  let match: RegExpExecArray | null;

  while ((match = todoCreatePattern.exec(output)) !== null) {
    operations.push({
      operation: 'create',
      content: match[1].trim(),
    });
  }

  while ((match = todoCompletePattern.exec(output)) !== null) {
    operations.push({
      operation: 'complete',
      content: match[1].trim(),
    });
  }

  while ((match = todoBlockPattern.exec(output)) !== null) {
    operations.push({
      operation: 'block',
      content: match[1].trim(),
      blockers: match[2].split(',').map((b) => b.trim()),
    });
  }

  return operations;
}
