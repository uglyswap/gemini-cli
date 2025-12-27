/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agentic Hybrid System - Main Entry Point
 * 
 * This module combines gemini-cli's TypeScript runtime with advanced
 * agent orchestration concepts for enhanced multi-agent execution.
 * 
 * Key Features:
 * - Trust Cascade Engine (L0-L4 trust levels)
 * - 28 Specialized Agents across 8 domains
 * - Safety Net (Snapshots + Quality Gates)
 * - Enhanced Agent Orchestration (6-phase workflow)
 * - Isolated Agent Sessions (context separation)
 */

// Trust System
export { TrustCascadeEngine } from '../trust/trust-engine.js';
export { TrustLevel } from '../trust/types.js';
export type {
  TrustMetrics,
  TrustThreshold,
  TrustPrivileges,
  TrustLevelConfig,
} from '../trust/types.js';

// Agent Registry & Selection
export {
  AGENT_REGISTRY,
  getAgentById,
  getAgentsByDomain,
  getAllAgentIds,
} from '../agents/specialized/agent-registry.js';
export { AgentSelector } from '../agents/specialized/agent-selector.js';
export type {
  SpecializedAgent,
  AgentDomain,
  ModelTier,
} from '../agents/specialized/types.js';

// Agent Sessions
export { AgentSession } from '../agents/session/agent-session.js';
export { AgentSessionManager } from '../agents/session/agent-session-manager.js';
export type {
  AgentSessionConfig,
  AgentTaskResult,
  AgentSessionState,
  AgentToolCall,
  AgentSessionEvent,
  AgentSessionEventCallback,
  ModelConfig,
  MODEL_TIER_CONFIGS,
} from '../agents/session/types.js';

// Safety Net
export { SnapshotManager } from '../safety/snapshot/snapshot-manager.js';
export { GateRunner } from '../safety/quality-gates/gate-runner.js';
export { BUILT_IN_GATES } from '../safety/quality-gates/built-in-gates.js';
export type {
  Snapshot,
  SnapshotFile,
  SnapshotManagerConfig,
  SnapshotDiff,
} from '../safety/snapshot/types.js';
export type {
  QualityGate,
  GateResult,
  GateRunnerConfig,
} from '../safety/quality-gates/types.js';

// Orchestrator
export { EnhancedAgentOrchestrator } from '../orchestrator/enhanced-orchestrator.js';
export type {
  OrchestratorConfig,
  ExecutionPlan,
  ExecutionStep,
  ExecutionReport,
  AgentExecution,
  ExecutionPhase,
  PhaseCallback,
  ApprovalCallback,
} from '../orchestrator/types.js';

// Hybrid Mode Manager (CLI Integration)
export {
  HybridModeManager,
  parseHybridConfig,
  createHybridModeManager,
  DEFAULT_HYBRID_CONFIG,
} from './hybrid-mode-manager.js';
export type { HybridModeConfig } from './hybrid-mode-manager.js';

// Agentic Command
export { AgenticCommand } from './agentic-command.js';
export type { AgenticCommandResult } from './agentic-command.js';

/**
 * Quick setup helper for creating an orchestrator with defaults
 */
export function createOrchestrator(
  cliConfig: any,
  contentGenerator: any,
  options: {
    workingDirectory: string;
    enableSnapshots?: boolean;
    qualityGates?: string[];
    requireApprovalAbove?: any;
  },
) {
  const { EnhancedAgentOrchestrator } = require('../orchestrator/enhanced-orchestrator.js');
  
  return new EnhancedAgentOrchestrator(cliConfig, contentGenerator, {
    workingDirectory: options.workingDirectory,
    enableSnapshots: options.enableSnapshots ?? true,
    qualityGates: options.qualityGates ?? ['typescript', 'eslint'],
    requireApprovalAbove: options.requireApprovalAbove,
  });
}
