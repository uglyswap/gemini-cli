/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { ContentGenerator } from '../core/contentGenerator.js';
import { EnhancedAgentOrchestrator } from '../orchestrator/enhanced-orchestrator.js';
import type { ExecutionReport, ExecutionPhase, OrchestratorConfig } from '../orchestrator/types.js';
import type { TrustLevel } from '../trust/types.js';

/**
 * Configuration for hybrid/agentic mode
 */
export interface HybridModeConfig {
  /** Enable agentic mode (multi-agent orchestration) */
  enabled: boolean;
  /** Enable file snapshots for safety */
  enableSnapshots?: boolean;
  /** Quality gates to run */
  qualityGates?: string[];
  /** Trust level above which approval is required */
  requireApprovalAbove?: TrustLevel;
  /** Maximum concurrent agent sessions */
  maxConcurrentSessions?: number;
  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
}

/**
 * Default configuration for hybrid mode
 */
export const DEFAULT_HYBRID_CONFIG: HybridModeConfig = {
  enabled: false,
  enableSnapshots: true,
  qualityGates: ['typescript', 'eslint'],
  maxConcurrentSessions: 5,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * Manager for hybrid/agentic mode in gemini-cli
 * 
 * This class provides the integration point between gemini-cli and the
 * enhanced agent orchestration system. It can be enabled via:
 * - GEMINI.md configuration: `enableAgentic: true`
 * - Environment variable: `GEMINI_AGENTIC_MODE=true`
 * - CLI flag: `--agentic`
 */
export class HybridModeManager {
  private orchestrator: EnhancedAgentOrchestrator | null = null;
  private readonly config: HybridModeConfig;
  private isInitialized = false;

  constructor(
    private readonly cliConfig: Config,
    private readonly contentGenerator: ContentGenerator,
    hybridConfig?: Partial<HybridModeConfig>,
  ) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...hybridConfig };
  }

  /**
   * Check if agentic mode is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable agentic mode
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable agentic mode
   */
  disable(): void {
    this.config.enabled = false;
    if (this.orchestrator) {
      this.orchestrator.cleanup();
      this.orchestrator = null;
    }
  }

  /**
   * Initialize the orchestrator (lazy initialization)
   */
  private async initialize(workingDirectory: string): Promise<void> {
    if (this.isInitialized && this.orchestrator) {
      return;
    }

    const orchestratorConfig: OrchestratorConfig = {
      workingDirectory,
      enableSnapshots: this.config.enableSnapshots,
      qualityGates: this.config.qualityGates,
      requireApprovalAbove: this.config.requireApprovalAbove,
    };

    this.orchestrator = new EnhancedAgentOrchestrator(
      this.cliConfig,
      this.contentGenerator,
      orchestratorConfig,
    );

    this.isInitialized = true;
  }

  /**
   * Execute a task using the agentic system
   */
  async executeTask(
    task: string,
    workingDirectory: string,
    options?: {
      onPhaseChange?: (phase: ExecutionPhase) => void | Promise<void>;
      onApprovalRequired?: (plan: any) => Promise<boolean>;
    },
  ): Promise<ExecutionReport> {
    if (!this.config.enabled) {
      throw new Error('Agentic mode is not enabled. Enable it first with enable() or set enabled: true in config.');
    }

    await this.initialize(workingDirectory);

    if (!this.orchestrator) {
      throw new Error('Failed to initialize orchestrator');
    }

    return this.orchestrator.executeTask(task, options);
  }

  /**
   * Get the current execution phase
   */
  getCurrentPhase(): ExecutionPhase | null {
    return this.orchestrator?.getCurrentPhase() || null;
  }

  /**
   * Get session statistics
   */
  getStats() {
    return this.orchestrator?.getSessionStats() || null;
  }

  /**
   * Get trust information for an agent
   */
  getAgentTrust(agentId: string) {
    return this.orchestrator?.getAgentTrust(agentId) || null;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.orchestrator) {
      await this.orchestrator.cleanup();
      this.orchestrator = null;
    }
    this.isInitialized = false;
  }
}

/**
 * Parse hybrid mode configuration from GEMINI.md or environment
 */
export function parseHybridConfig(
  geminiMdConfig?: Record<string, unknown>,
  env?: Record<string, string | undefined>,
): HybridModeConfig {
  const config = { ...DEFAULT_HYBRID_CONFIG };

  // Check environment variable
  if (env?.['GEMINI_AGENTIC_MODE'] === 'true') {
    config.enabled = true;
  }

  // Parse GEMINI.md configuration
  if (geminiMdConfig) {
    if (typeof geminiMdConfig['enableAgentic'] === 'boolean') {
      config.enabled = geminiMdConfig['enableAgentic'];
    }

    if (typeof geminiMdConfig['agenticSnapshots'] === 'boolean') {
      config.enableSnapshots = geminiMdConfig['agenticSnapshots'];
    }

    if (Array.isArray(geminiMdConfig['agenticQualityGates'])) {
      config.qualityGates = geminiMdConfig['agenticQualityGates'] as string[];
    }

    if (typeof geminiMdConfig['agenticMaxSessions'] === 'number') {
      config.maxConcurrentSessions = geminiMdConfig['agenticMaxSessions'];
    }
  }

  return config;
}

/**
 * Create a hybrid mode manager from CLI config
 */
export function createHybridModeManager(
  cliConfig: Config,
  contentGenerator: ContentGenerator,
  geminiMdConfig?: Record<string, unknown>,
): HybridModeManager {
  const hybridConfig = parseHybridConfig(geminiMdConfig, process.env as Record<string, string>);
  return new HybridModeManager(cliConfig, contentGenerator, hybridConfig);
}
