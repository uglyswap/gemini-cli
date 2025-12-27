/**
 * Trust Cascade System Types
 * Implements dynamic trust levels (L0-L4) for agent supervision
 * Inspired by Agentic Dev System's Trust Cascade protocol
 */

/**
 * Trust levels from most restricted to most autonomous
 */
export enum TrustLevel {
  /** Agent disabled due to critical failures or security issues */
  L0_QUARANTINE = 0,
  /** New or recovering agent - enhanced supervision required */
  L1_SUPERVISED = 1,
  /** Standard agent - full quality checks applied */
  L2_GUIDED = 2,
  /** Reliable agent - reduced oversight, standard checks */
  L3_TRUSTED = 3,
  /** Expert agent - minimal oversight, sampling verification */
  L4_AUTONOMOUS = 4,
}

/**
 * Record of a single agent execution
 */
export interface ExecutionRecord {
  /** ISO timestamp of execution */
  timestamp: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Task complexity */
  complexity?: 'simple' | 'moderate' | 'complex';
  /** Error message if failed */
  error?: string;
}

/**
 * Aggregated metrics for an agent
 */
export interface TrustMetrics {
  /** Total number of executions */
  totalExecutions: number;
  /** Number of successful executions */
  successfulExecutions: number;
  /** Number of failed executions */
  failedExecutions: number;
  /** Rolling average quality score (0-100) */
  averageQualityScore: number;
  /** Consecutive successful executions */
  consecutiveSuccesses: number;
  /** Consecutive failed executions */
  consecutiveFailures: number;
  /** List of critical failure descriptions */
  criticalFailures: string[];
  /** List of security issue descriptions */
  securityIssues: string[];
  /** Last N executions for recent analysis */
  lastExecutions: ExecutionRecord[];
  /** First execution timestamp */
  firstExecution?: string;
  /** Last execution timestamp */
  lastExecution?: string;
}

/**
 * Thresholds required to achieve a trust level
 */
export interface TrustThreshold {
  /** Minimum total executions required */
  minExecutions: number;
  /** Minimum success rate (0-1) */
  successRate: number;
  /** Minimum average quality score */
  averageScore: number;
  /** Maximum recent failures allowed (in last N executions) */
  maxRecentFailures: number;
  /** Whether zero critical failures is required */
  zeroCriticalFailures: boolean;
}

/**
 * Privileges granted at a trust level
 */
export interface TrustPrivileges {
  /** Skip explain-first phase */
  skipExplainFirst: boolean | 'for_simple_tasks';
  /** Skip diff preview before changes */
  skipDiffPreview: boolean | 'for_non_critical';
  /** Auto-approve changes without user confirmation */
  autoApproveChanges: boolean | 'low_risk_only';
  /** Skip code review phase */
  skipCodeReview: boolean | 'for_simple_tasks';
  /** Allow direct commits (no PR) */
  directCommit: boolean | 'formatting_only';
  /** Maximum parallel agents allowed */
  maxParallelAgents: number;
  /** Maximum retry attempts on failure */
  maxRetries: number;
  /** Allowed file operations */
  allowedOperations: ('read' | 'write' | 'delete' | 'execute')[];
  /** Maximum files modifiable in single operation */
  maxFilesPerOperation: number;
}

/**
 * Supervision mode for quality checking
 */
export type SupervisionMode = 
  | 'paranoid'   // Every action reviewed
  | 'enhanced'   // Extra checks on all operations
  | 'full'       // Standard full quality checks
  | 'standard'   // Normal quality checks
  | 'sampling';  // Random sampling (1 in N)

/**
 * Complete configuration for a trust level
 */
export interface TrustLevelConfig {
  /** The trust level */
  level: TrustLevel;
  /** Human-readable name */
  name: string;
  /** Description of this level */
  description: string;
  /** Thresholds to achieve this level */
  threshold: TrustThreshold;
  /** Privileges granted at this level */
  privileges: TrustPrivileges;
  /** Supervision mode for quality checks */
  supervisionMode: SupervisionMode;
  /** Hours to keep snapshots for rollback */
  rollbackWindowHours: number;
  /** Sampling rate for quality checks (1 = every, 5 = 1 in 5) */
  qualityCheckSampling: number;
}

/**
 * Result of recording an execution
 */
export interface ExecutionRecordResult {
  /** Agent ID */
  agentId: string;
  /** Previous trust level */
  previousLevel: TrustLevel;
  /** New trust level after recording */
  newLevel: TrustLevel;
  /** Whether level changed */
  levelChanged: boolean;
  /** Direction of change */
  changeDirection?: 'promoted' | 'demoted';
  /** Updated metrics */
  metrics: TrustMetrics;
}

/**
 * Trust store format for persistence
 */
export interface TrustStore {
  /** Store format version */
  version: string;
  /** Last update timestamp */
  lastUpdated: string;
  /** Agent metrics by ID */
  agents: Record<string, TrustMetrics>;
  /** Store metadata */
  metadata?: {
    projectName?: string;
    createdAt?: string;
  };
}

/**
 * Options for trust engine initialization
 */
export interface TrustEngineOptions {
  /** Path to store trust data */
  storePath?: string;
  /** Maximum executions to keep in history */
  maxHistorySize?: number;
  /** Custom level configurations */
  levelConfigs?: Partial<TrustLevelConfig>[];
  /** Enable auto-save after each update */
  autoSave?: boolean;
  /** Callback when trust level changes */
  onLevelChange?: (result: ExecutionRecordResult) => void;
}
