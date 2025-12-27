/**
 * Enhanced Orchestrator Types
 * For the main multi-agent orchestration system
 */

import { TrustLevel } from '../trust/types.js';
import { AgentSpecialization, TaskComplexity, AgentContext } from '../agents/specialized/types.js';
import { GateExecutionResult } from '../safety/quality-gates/types.js';

/**
 * Execution phases
 */
export type ExecutionPhase = 
  | 'init'
  | 'explain'
  | 'snapshot'
  | 'execute'
  | 'validate'
  | 'report'
  | 'error'
  | 'rollback';

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
  output: unknown;
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
  /** Enable trust cascade system */
  enableTrustCascade: boolean;
  /** Enable multi-agent routing */
  enableMultiAgent: boolean;
  /** Enable automatic snapshots */
  enableSnapshots: boolean;
  /** Enable quality gates */
  enableQualityGates: boolean;
  /** Trust level threshold for requiring snapshot */
  snapshotTrustThreshold: TrustLevel;
  /** Maximum agents per task */
  maxAgentsPerTask: number;
  /** Quality gate strictness */
  strictQualityGates: boolean;
  /** Auto-rollback on failure */
  autoRollbackOnFailure: boolean;
  /** Enable verbose logging */
  verbose: boolean;
  /** Model configuration */
  modelConfig: {
    fastModel: string;
    balancedModel: string;
    powerfulModel: string;
  };
}

/**
 * Default orchestrator configuration
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  projectRoot: process.cwd(),
  enableTrustCascade: true,
  enableMultiAgent: true,
  enableSnapshots: true,
  enableQualityGates: true,
  snapshotTrustThreshold: TrustLevel.L2_GUIDED,
  maxAgentsPerTask: 4,
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
 * Phase transition callback
 */
export type PhaseCallback = (
  phase: ExecutionPhase,
  data: unknown
) => void | Promise<void>;

/**
 * Approval callback for user confirmation
 */
export type ApprovalCallback = (
  task: OrchestratorTask,
  agents: AgentSpecialization[],
  context: AgentContext
) => Promise<boolean>;
