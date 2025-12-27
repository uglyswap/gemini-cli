/**
 * Hybrid Agentic System
 * 
 * Combines the best of gemini-cli's execution engine with
 * Agentic Dev System's multi-agent orchestration concepts.
 * 
 * Features:
 * - Trust Cascade (L0-L4): Dynamic trust levels based on agent history
 * - Multi-Agent (28 specialized): Domain-specific agents with intelligent routing
 * - Safety Net: Automatic snapshots and quality gates
 * - Enhanced Orchestrator: Coordinates all components
 * 
 * @example
 * ```typescript
 * import { EnhancedAgentOrchestrator } from './hybrid';
 * 
 * const orchestrator = new EnhancedAgentOrchestrator({
 *   projectRoot: process.cwd(),
 *   enableTrustCascade: true,
 *   enableMultiAgent: true,
 *   enableSnapshots: true,
 * });
 * 
 * const result = await orchestrator.executeTask({
 *   description: 'Add authentication to the API',
 *   affectedFiles: ['src/auth/*.ts'],
 * });
 * ```
 */

// Trust Cascade System
export {
  TrustLevel,
  TrustMetrics,
  TrustThreshold,
  TrustPrivileges,
  TrustLevelConfig,
  TrustStore,
  TrustEngineOptions,
  ExecutionRecord,
  ExecutionRecordResult,
  SupervisionMode,
} from '../trust/types.js';

export {
  TrustCascadeEngine,
  DEFAULT_LEVEL_CONFIGS,
} from '../trust/trust-engine.js';

// Specialized Agents
export {
  AgentDomain,
  ModelTier,
  TaskComplexity,
  QualityCheck,
  ToolId,
  AgentSpecialization,
  AgentSelectionResult,
  AgentContext,
} from '../agents/specialized/types.js';

export {
  AGENT_REGISTRY,
  getAgentById,
  getAgentsByDomain,
  getAllAgentIds,
} from '../agents/specialized/agent-registry.js';

export {
  AgentSelector,
  AgentSelectorConfig,
} from '../agents/specialized/agent-selector.js';

// Safety Net - Snapshots
export {
  Snapshot,
  SnapshotFile,
  SnapshotMetadata,
  SnapshotDiff,
  FileDiff,
  FileChangeStatus,
  RestoreOptions,
  RestoreResult,
  SnapshotManagerOptions,
} from '../safety/snapshot/types.js';

export {
  SnapshotManager,
} from '../safety/snapshot/snapshot-manager.js';

// Safety Net - Quality Gates
export {
  GateSeverity,
  GateTiming,
  GateCheckResult,
  GateIssue,
  GateExecutionResult,
  QualityGate,
  GateContext,
  GateRunnerOptions,
} from '../safety/quality-gates/types.js';

export {
  GateRunner,
} from '../safety/quality-gates/gate-runner.js';

export {
  BUILT_IN_GATES,
} from '../safety/quality-gates/built-in-gates.js';

// Enhanced Orchestrator
export {
  ExecutionPhase,
  OrchestratorTask,
  AgentExecutionResult,
  TaskExecutionResult,
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
  PhaseCallback,
  ApprovalCallback,
} from '../orchestrator/types.js';

export {
  EnhancedAgentOrchestrator,
} from '../orchestrator/enhanced-orchestrator.js';

/**
 * Quick start function to create a configured orchestrator
 */
export function createOrchestrator(
  projectRoot: string = process.cwd(),
  options: {
    enableTrustCascade?: boolean;
    enableMultiAgent?: boolean;
    enableSnapshots?: boolean;
    enableQualityGates?: boolean;
    verbose?: boolean;
  } = {}
) {
  const { EnhancedAgentOrchestrator } = require('../orchestrator/enhanced-orchestrator.js');
  
  return new EnhancedAgentOrchestrator({
    projectRoot,
    enableTrustCascade: options.enableTrustCascade ?? true,
    enableMultiAgent: options.enableMultiAgent ?? true,
    enableSnapshots: options.enableSnapshots ?? true,
    enableQualityGates: options.enableQualityGates ?? true,
    verbose: options.verbose ?? false,
  });
}
