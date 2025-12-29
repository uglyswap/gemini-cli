/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enhanced Orchestrator Types
 * For the main multi-agent orchestration system
 */

import type { TrustPrivileges } from '../trust/types.js';
import { TrustLevel } from '../trust/types.js';

/**
 * Execution mode for the orchestrator
 * Controls the balance between speed and quality
 */
export enum ExecutionMode {
  /**
   * SPEED mode: Maximum parallelization, minimal validation
   * - All independent agents run in parallel
   * - Only critical quality gates
   * - No inter-agent consensus
   * Best for: Quick iterations, prototyping
   */
  SPEED = 'speed',

  /**
   * BALANCED mode: Moderate parallelization with standard validation
   * - Domain-level parallelization (e.g., all frontend agents together)
   * - Standard quality gates
   * - Domain-level validation
   * Best for: Regular development work
   */
  BALANCED = 'balanced',

  /**
   * CONFIDENCE mode: Sequential with full validation (DEFAULT)
   * - Domain-ordered execution for implicit consensus
   * - All quality gates enabled
   * - Full validation pipeline
   * - DiffValidator for change verification
   * Best for: Production code, critical features
   */
  CONFIDENCE = 'confidence',
}

/**
 * Parallel execution group
 * Agents within a group can run in parallel
 */
export interface ParallelExecutionGroup {
  /** Group order (lower = earlier) */
  order: number;
  /** Domain(s) in this group */
  domains: string[];
  /** Agent IDs in this group */
  agentIds: string[];
  /** Whether this group requires previous group to complete */
  waitForPrevious: boolean;
}
import type {
  AgentSpecialization,
  TaskComplexity,
  AgentContext,
} from '../agents/specialized/types.js';
import type { GateExecutionResult } from '../safety/quality-gates/types.js';

/**
 * Execution phases (uppercase is canonical, lowercase is deprecated)
 */
export type ExecutionPhase =
  | 'INIT'
  | 'EXPLAIN'
  | 'SNAPSHOT'
  | 'EXECUTE'
  | 'VALIDATE'
  | 'REPORT'
  | 'ERROR'
  | 'ROLLBACK';

/**
 * Legacy lowercase phase names for backward compatibility
 * @deprecated Use uppercase ExecutionPhase values
 */
export type LegacyExecutionPhase =
  | 'init'
  | 'explain'
  | 'snapshot'
  | 'execute'
  | 'validate'
  | 'report'
  | 'error'
  | 'rollback';

/**
 * Combined phase type for backward compatibility
 */
export type ExecutionPhaseCompat = ExecutionPhase | LegacyExecutionPhase;

/**
 * Normalize a phase to uppercase canonical form
 */
export function normalizeExecutionPhase(
  phase: ExecutionPhaseCompat,
): ExecutionPhase {
  return phase.toUpperCase() as ExecutionPhase;
}

/**
 * Execution step (alias for backward compatibility)
 */
export type ExecutionStep = ExecutionPhase;

/**
 * Task input to the orchestrator
 */
export interface OrchestratorTask {
  /** Task description */
  description: string;
  /** Files likely to be affected (optional, will be detected if not provided) */
  affectedFiles?: string[];
  /** Force specific agents (optional) */
  forceAgents?: string[];
  /** Skip certain agents (optional) */
  skipAgents?: string[];
  /** User context or additional instructions */
  userContext?: string;
  /** Require user approval before execution */
  requireApproval?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a single agent execution
 */
export interface AgentExecutionResult {
  /** Agent ID */
  agentId: string;
  /** Agent name */
  agentName: string;
  /** Agent domain */
  domain: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Execution duration in ms */
  durationMs: number;
  /** Agent output/response */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Whether this was a critical failure */
  isCriticalFailure?: boolean;
  /** Whether this was a security issue */
  isSecurityIssue?: boolean;
  /** Files modified by this agent */
  modifiedFiles: string[];
  /** Context passed to next agent */
  contextForNext?: string;
  /** Trust level at execution */
  trustLevel: TrustLevel;
}

/**
 * Complete task execution result
 */
export interface TaskExecutionResult {
  /** Overall success */
  success: boolean;
  /** Task ID */
  taskId: string;
  /** Task description */
  taskDescription: string;
  /** Assessed complexity */
  complexity: TaskComplexity;
  /** All agent execution results */
  agentResults: AgentExecutionResult[];
  /** Pre-execution gate results */
  preGateResults?: GateExecutionResult;
  /** Post-execution gate results */
  postGateResults?: GateExecutionResult;
  /** Average quality score across agents */
  averageQuality: number;
  /** Snapshot ID if created */
  snapshotId?: string;
  /** Whether rollback was performed */
  rolledBack: boolean;
  /** Rollback reason if applicable */
  rollbackReason?: string;
  /** Total execution duration */
  totalDurationMs: number;
  /** All files modified */
  allModifiedFiles: string[];
  /** Trust levels of agents */
  trustLevels: Record<string, TrustLevel>;
  /** Current phase at completion */
  finalPhase: ExecutionPhase;
  /** Error messages if any */
  errors: string[];
  /** Warnings */
  warnings: string[];
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** Project root directory */
  projectRoot: string;
  /** Working directory for execution */
  workingDirectory?: string;
  /** Execution mode (default: CONFIDENCE for perfect code) */
  executionMode: ExecutionMode;
  /** Enable trust cascade system */
  enableTrustCascade: boolean;
  /** Enable multi-agent routing */
  enableMultiAgent: boolean;
  /** Enable automatic snapshots */
  enableSnapshots: boolean;
  /** Enable quality gates */
  enableQualityGates: boolean;
  /** Quality gates to run */
  qualityGates?: string[];
  /** Trust level threshold for requiring snapshot */
  snapshotTrustThreshold: TrustLevel;
  /** Maximum agents per task */
  maxAgentsPerTask: number;
  /** Maximum concurrent agent executions (for parallel modes) */
  maxConcurrentAgents: number;
  /** Quality gate strictness */
  strictQualityGates: boolean;
  /** Auto-rollback on failure */
  autoRollbackOnFailure: boolean;
  /** Enable verbose logging */
  verbose: boolean;
  /** Require approval above this trust level */
  requireApprovalAbove?: TrustLevel;
  /** Timeout for individual agent execution in milliseconds (default: 5 minutes) */
  agentTimeoutMs?: number;
  /** Enable diff validation after agent execution */
  enableDiffValidation: boolean;
  /** Model configuration */
  modelConfig: {
    fastModel: string;
    balancedModel: string;
    powerfulModel: string;
  };
}

/**
 * Execution step in a plan
 */
export interface ExecutionPlanStep {
  /** Execution order */
  order: number;
  /** Agent ID */
  agentId: string;
  /** Agent name */
  agentName: string;
  /** Step description */
  description: string;
  /** Trust level for this step */
  trustLevel: TrustLevel;
  /** Privileges for this step */
  privileges: TrustPrivileges;
  /** Estimated complexity */
  estimatedComplexity: TaskComplexity | string;
}

/**
 * Execution plan for a task
 */
export interface ExecutionPlan {
  /** Task description */
  task: string;
  /** Ordered list of agents to execute (legacy format) */
  agents?: Array<{
    agent: AgentSpecialization;
    score: number;
  }>;
  /** Execution steps */
  steps?: ExecutionPlanStep[];
  /** Total number of agents */
  totalAgents?: number;
  /** Estimated complexity */
  complexity?: TaskComplexity;
  /** Estimated complexity as string */
  estimatedComplexity?: string;
  /** Files likely to be affected */
  affectedFiles?: string[];
  /** Explanation of the plan */
  explanation?: string;
  /** Trust privileges per agent */
  trustPrivileges?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt?: Date;
}

/**
 * Single agent execution record
 */
export interface AgentExecution {
  /** Agent ID */
  agentId: string;
  /** Agent name */
  agentName: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Start timestamp */
  startTime?: number;
  /** End timestamp */
  endTime?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Output from the agent */
  output: string;
  /** Error if failed */
  error?: string;
  /** Files modified during execution */
  modifiedFiles?: string[];
  /**
   * Alias for modifiedFiles
   * @deprecated Use `modifiedFiles` instead. This field will be removed in a future version.
   */
  filesModified?: string[];
  /** Tools used during execution */
  toolsUsed?: string[];
  /** Trust level during execution */
  trustLevel?: TrustLevel;
}

/**
 * Execution report after completing a task
 */
export interface ExecutionReport {
  /** Task that was executed */
  task: string;
  /** Execution plan used */
  plan: ExecutionPlan;
  /** All agent executions */
  executions?: AgentExecution[];
  /** Alias for executions (backward compatibility) */
  agentExecutions?: AgentExecution[];
  /** Overall success */
  success: boolean;
  /** Failure reason if not successful */
  failureReason?: string;
  /** Error message if failed */
  error?: string;
  /** Snapshot ID if created */
  snapshotId?: string;
  /** Whether rollback occurred */
  rolledBack?: boolean;
  /** Total execution time in ms */
  totalTimeMs?: number;
  /** Alias for totalTimeMs (backward compatibility) */
  totalDurationMs?: number;
  /** Quality gate results */
  gateResults?: unknown[];
  /** Alias for gateResults (backward compatibility) */
  qualityGateResults?: unknown[];
  /** Completion timestamp */
  completedAt?: Date;
}

/**
 * Default orchestrator configuration values (without projectRoot)
 * Use getDefaultOrchestratorConfig() to get a complete config with projectRoot
 *
 * NOTE: ExecutionMode.CONFIDENCE is the default for maximum code quality
 */
const DEFAULT_CONFIG_VALUES: Omit<OrchestratorConfig, 'projectRoot'> = {
  executionMode: ExecutionMode.CONFIDENCE,
  enableTrustCascade: true,
  enableMultiAgent: true,
  enableSnapshots: true,
  enableQualityGates: true,
  enableDiffValidation: true,
  snapshotTrustThreshold: TrustLevel.L2_GUIDED,
  maxAgentsPerTask: 4,
  maxConcurrentAgents: 5,
  strictQualityGates: false,
  autoRollbackOnFailure: true,
  verbose: false,
  modelConfig: {
    fastModel: 'gemini-1.5-flash',
    balancedModel: 'gemini-1.5-pro',
    powerfulModel: 'gemini-1.5-pro',
  },
};

/**
 * Get default orchestrator configuration with projectRoot evaluated at runtime
 * This prevents issues with module load-time evaluation of process.cwd()
 */
export function getDefaultOrchestratorConfig(
  projectRoot?: string,
): OrchestratorConfig {
  return {
    projectRoot: projectRoot ?? process.cwd(),
    ...DEFAULT_CONFIG_VALUES,
  };
}

/**
 * Default orchestrator configuration
 * @deprecated Use getDefaultOrchestratorConfig() for proper runtime evaluation of projectRoot
 *
 * Note: Uses a Proxy to defer process.cwd() evaluation until access time
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = new Proxy(
  {} as OrchestratorConfig,
  {
    get(_target, prop: string) {
      const config = getDefaultOrchestratorConfig();
      return config[prop as keyof OrchestratorConfig];
    },
    ownKeys() {
      return Object.keys(getDefaultOrchestratorConfig());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const config = getDefaultOrchestratorConfig();
      if (prop in config) {
        return {
          configurable: true,
          enumerable: true,
          value: config[prop as keyof OrchestratorConfig],
        };
      }
      return undefined;
    },
  },
);

/**
 * Phase transition callback
 */
export type PhaseCallback = (
  phase: ExecutionPhase,
  data?: unknown,
) => void | Promise<void>;

/**
 * Approval callback for user confirmation
 * Can accept either full task info or just the execution plan
 */
export type ApprovalCallback = (
  planOrTask: ExecutionPlan | OrchestratorTask,
  agents?: AgentSpecialization[],
  context?: AgentContext,
) => Promise<boolean>;
