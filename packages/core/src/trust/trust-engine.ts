/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Trust Cascade Engine
 * Manages dynamic trust levels for agents based on execution history
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TrustLevel } from './types.js';
import type {
  TrustMetrics,
  TrustLevelConfig,
  TrustPrivileges,
  TrustStore,
  TrustEngineOptions,
  ExecutionRecord,
  ExecutionRecordResult,
} from './types.js';

/**
 * Default trust level configurations
 * Based on Agentic Dev System's Trust Cascade protocol
 */
const DEFAULT_LEVEL_CONFIGS: TrustLevelConfig[] = [
  {
    level: TrustLevel.L4_AUTONOMOUS,
    name: 'Autonomous Expert',
    description:
      'Agent with excellent track record - minimal oversight required',
    threshold: {
      minExecutions: 50,
      successRate: 0.95,
      averageScore: 90,
      maxRecentFailures: 0,
      zeroCriticalFailures: true,
    },
    privileges: {
      skipExplainFirst: true,
      skipDiffPreview: 'for_non_critical',
      autoApproveChanges: true,
      skipCodeReview: 'for_simple_tasks',
      directCommit: 'formatting_only',
      maxParallelAgents: 5,
      maxRetries: 1,
      allowedOperations: ['read', 'write', 'delete', 'execute'],
      maxFilesPerOperation: 50,
    },
    supervisionMode: 'sampling',
    rollbackWindowHours: 24,
    qualityCheckSampling: 5, // Check 1 in 5
  },
  {
    level: TrustLevel.L3_TRUSTED,
    name: 'Trusted Agent',
    description: 'Reliable agent with good history - standard oversight',
    threshold: {
      minExecutions: 20,
      successRate: 0.85,
      averageScore: 80,
      maxRecentFailures: 0, // In last 5 executions
      zeroCriticalFailures: true,
    },
    privileges: {
      skipExplainFirst: 'for_simple_tasks',
      skipDiffPreview: false,
      autoApproveChanges: 'low_risk_only',
      skipCodeReview: false,
      directCommit: false,
      maxParallelAgents: 3,
      maxRetries: 2,
      allowedOperations: ['read', 'write', 'execute'],
      maxFilesPerOperation: 20,
    },
    supervisionMode: 'standard',
    rollbackWindowHours: 48,
    qualityCheckSampling: 1, // Check every execution
  },
  {
    level: TrustLevel.L2_GUIDED,
    name: 'Guided Agent',
    description: 'Standard agent with normal supervision',
    threshold: {
      minExecutions: 5,
      successRate: 0.7,
      averageScore: 60,
      maxRecentFailures: 2,
      zeroCriticalFailures: true,
    },
    privileges: {
      skipExplainFirst: false,
      skipDiffPreview: false,
      autoApproveChanges: false,
      skipCodeReview: false,
      directCommit: false,
      maxParallelAgents: 2,
      maxRetries: 2,
      allowedOperations: ['read', 'write'],
      maxFilesPerOperation: 10,
    },
    supervisionMode: 'full',
    rollbackWindowHours: 72,
    qualityCheckSampling: 1,
  },
  {
    level: TrustLevel.L1_SUPERVISED,
    name: 'New/Recovering Agent',
    description:
      'New agent or agent recovering from failures - enhanced supervision',
    threshold: {
      minExecutions: 0,
      successRate: 0,
      averageScore: 0,
      maxRecentFailures: 5,
      zeroCriticalFailures: true,
    },
    privileges: {
      skipExplainFirst: false,
      skipDiffPreview: false,
      autoApproveChanges: false,
      skipCodeReview: false,
      directCommit: false,
      maxParallelAgents: 1,
      maxRetries: 3,
      allowedOperations: ['read', 'write'],
      maxFilesPerOperation: 5,
    },
    supervisionMode: 'enhanced',
    rollbackWindowHours: 168, // 7 days
    qualityCheckSampling: 1,
  },
  {
    level: TrustLevel.L0_QUARANTINE,
    name: 'Quarantined Agent',
    description: 'Agent disabled due to critical failures or security issues',
    threshold: {
      minExecutions: 0,
      successRate: 0,
      averageScore: 0,
      maxRecentFailures: 999,
      zeroCriticalFailures: false,
    },
    privileges: {
      skipExplainFirst: false,
      skipDiffPreview: false,
      autoApproveChanges: false,
      skipCodeReview: false,
      directCommit: false,
      maxParallelAgents: 0,
      maxRetries: 0,
      allowedOperations: ['read'],
      maxFilesPerOperation: 0,
    },
    supervisionMode: 'paranoid',
    rollbackWindowHours: 720, // 30 days
    qualityCheckSampling: 1,
  },
];

/**
 * Trust Cascade Engine
 * Manages agent trust levels based on execution history
 */
export class TrustCascadeEngine {
  private readonly storePath: string;
  private readonly maxHistorySize: number;
  private readonly autoSave: boolean;
  private readonly levelConfigs: TrustLevelConfig[];
  private readonly onLevelChange?: (result: ExecutionRecordResult) => void;

  private agentMetrics: Map<string, TrustMetrics> = new Map();
  private initialized = false;

  constructor(projectRoot: string, options: TrustEngineOptions = {}) {
    this.storePath =
      options.storePath ||
      path.join(projectRoot, '.gemini', 'trust-scores.json');
    this.maxHistorySize = options.maxHistorySize || 100;
    this.autoSave = options.autoSave !== false;
    this.onLevelChange = options.onLevelChange;

    // Merge custom configs with defaults
    this.levelConfigs = this.mergeConfigs(
      DEFAULT_LEVEL_CONFIGS,
      options.levelConfigs,
    );

    this.loadMetrics();
  }

  /**
   * Get the current trust level for an agent
   */
  calculateTrustLevel(agentId: string): TrustLevel {
    const metrics = this.getMetrics(agentId);

    // Check for quarantine triggers first
    if (this.shouldQuarantine(metrics)) {
      return TrustLevel.L0_QUARANTINE;
    }

    const successRate =
      metrics.totalExecutions > 0
        ? metrics.successfulExecutions / metrics.totalExecutions
        : 0;

    // Check from highest to lowest level (excluding L0)
    for (const config of this.levelConfigs.filter(
      (c) => c.level !== TrustLevel.L0_QUARANTINE,
    )) {
      if (this.meetsThreshold(metrics, successRate, config)) {
        return config.level;
      }
    }

    return TrustLevel.L1_SUPERVISED;
  }

  /**
   * Get the configuration for a trust level
   */
  getLevelConfig(level: TrustLevel): TrustLevelConfig {
    const config = this.levelConfigs.find((c) => c.level === level);
    if (!config) {
      throw new Error(`No configuration found for trust level ${level}`);
    }
    return config;
  }

  /**
   * Get the privileges for an agent based on their trust level
   */
  getPrivileges(agentId: string): TrustPrivileges {
    const level = this.calculateTrustLevel(agentId);
    return this.getLevelConfig(level).privileges;
  }

  /**
   * Get the current metrics for an agent
   */
  getMetrics(agentId: string): TrustMetrics {
    if (!this.agentMetrics.has(agentId)) {
      this.agentMetrics.set(agentId, this.createDefaultMetrics());
    }
    return this.agentMetrics.get(agentId)!;
  }

  /**
   * Get all agent IDs with recorded metrics
   */
  getAllAgentIds(): string[] {
    return Array.from(this.agentMetrics.keys());
  }

  /**
   * Get a summary of all agents and their trust levels
   */
  getSummary(): Array<{
    agentId: string;
    level: TrustLevel;
    levelName: string;
    metrics: TrustMetrics;
  }> {
    return this.getAllAgentIds().map((agentId) => {
      const level = this.calculateTrustLevel(agentId);
      const config = this.getLevelConfig(level);
      return {
        agentId,
        level,
        levelName: config.name,
        metrics: this.getMetrics(agentId),
      };
    });
  }

  /**
   * Record an execution result and update trust metrics
   */
  recordExecution(
    agentId: string,
    result: {
      success: boolean;
      qualityScore: number;
      durationMs?: number;
      complexity?: 'simple' | 'moderate' | 'complex';
      isCriticalFailure?: boolean;
      isSecurityIssue?: boolean;
      errorDetails?: string;
    },
  ): ExecutionRecordResult {
    const metrics = this.getMetrics(agentId);
    const previousLevel = this.calculateTrustLevel(agentId);
    const now = new Date().toISOString();

    // Update basic counts
    metrics.totalExecutions++;
    metrics.lastExecution = now;
    if (!metrics.firstExecution) {
      metrics.firstExecution = now;
    }

    if (result.success) {
      metrics.successfulExecutions++;
      metrics.consecutiveSuccesses++;
      metrics.consecutiveFailures = 0;
    } else {
      metrics.failedExecutions++;
      metrics.consecutiveFailures++;
      metrics.consecutiveSuccesses = 0;

      if (result.isCriticalFailure) {
        metrics.criticalFailures.push(
          `[${now}] ${result.errorDetails || 'Critical failure'}`,
        );
      }
      if (result.isSecurityIssue) {
        metrics.securityIssues.push(
          `[${now}] ${result.errorDetails || 'Security issue'}`,
        );
      }
    }

    // Update rolling average quality score
    const totalScores =
      metrics.averageQualityScore * (metrics.totalExecutions - 1) +
      result.qualityScore;
    metrics.averageQualityScore = totalScores / metrics.totalExecutions;

    // Add to execution history
    const record: ExecutionRecord = {
      timestamp: now,
      success: result.success,
      qualityScore: result.qualityScore,
      durationMs: result.durationMs,
      complexity: result.complexity,
      error: result.errorDetails,
    };

    metrics.lastExecutions.push(record);

    // Trim history if needed
    while (metrics.lastExecutions.length > this.maxHistorySize) {
      metrics.lastExecutions.shift();
    }

    // Save and recalculate
    this.agentMetrics.set(agentId, metrics);

    if (this.autoSave) {
      this.saveMetrics();
    }

    const newLevel = this.calculateTrustLevel(agentId);
    const levelChanged = previousLevel !== newLevel;

    const recordResult: ExecutionRecordResult = {
      agentId,
      previousLevel,
      newLevel,
      levelChanged,
      changeDirection: levelChanged
        ? newLevel > previousLevel
          ? 'promoted'
          : 'demoted'
        : undefined,
      metrics,
    };

    // Log and callback on level change
    if (levelChanged) {
      const direction = recordResult.changeDirection === 'promoted' ? '↑' : '↓';
      console.log(
        `[Trust] Agent "${agentId}": ${TrustLevel[previousLevel]} → ${TrustLevel[newLevel]} ${direction}`,
      );

      if (this.onLevelChange) {
        this.onLevelChange(recordResult);
      }
    }

    return recordResult;
  }

  /**
   * Manually set an agent's trust level (for admin override)
   */
  setTrustLevel(agentId: string, level: TrustLevel, reason: string): void {
    const metrics = this.getMetrics(agentId);

    // Record the override
    if (level === TrustLevel.L0_QUARANTINE) {
      metrics.criticalFailures.push(
        `[${new Date().toISOString()}] Manual quarantine: ${reason}`,
      );
    }

    // Reset consecutive counters to force the level
    if (level >= TrustLevel.L3_TRUSTED) {
      metrics.consecutiveSuccesses = 20;
      metrics.consecutiveFailures = 0;
    } else if (level <= TrustLevel.L1_SUPERVISED) {
      metrics.consecutiveFailures = 3;
      metrics.consecutiveSuccesses = 0;
    }

    this.agentMetrics.set(agentId, metrics);

    if (this.autoSave) {
      this.saveMetrics();
    }

    console.log(
      `[Trust] Agent "${agentId}" manually set to ${TrustLevel[level]}: ${reason}`,
    );
  }

  /**
   * Clear quarantine status for an agent (requires reason)
   */
  clearQuarantine(agentId: string, reason: string): boolean {
    const metrics = this.getMetrics(agentId);
    const currentLevel = this.calculateTrustLevel(agentId);

    if (currentLevel !== TrustLevel.L0_QUARANTINE) {
      console.log(`[Trust] Agent "${agentId}" is not in quarantine`);
      return false;
    }

    // Clear the quarantine triggers
    metrics.criticalFailures = [];
    metrics.securityIssues = [];
    metrics.consecutiveFailures = 0;

    // Add a note about the clearance
    const record: ExecutionRecord = {
      timestamp: new Date().toISOString(),
      success: true,
      qualityScore: 50,
      error: `Quarantine cleared: ${reason}`,
    };
    metrics.lastExecutions.push(record);

    this.agentMetrics.set(agentId, metrics);

    if (this.autoSave) {
      this.saveMetrics();
    }

    console.log(`[Trust] Agent "${agentId}" quarantine cleared: ${reason}`);
    return true;
  }

  /**
   * Reset all metrics for an agent
   */
  resetAgent(agentId: string): void {
    this.agentMetrics.set(agentId, this.createDefaultMetrics());

    if (this.autoSave) {
      this.saveMetrics();
    }

    console.log(`[Trust] Agent "${agentId}" metrics reset`);
  }

  /**
   * Force save metrics to disk
   */
  save(): void {
    this.saveMetrics();
  }

  /**
   * Force reload metrics from disk
   */
  reload(): void {
    this.loadMetrics();
  }

  // Private methods

  private shouldQuarantine(metrics: TrustMetrics): boolean {
    return (
      metrics.consecutiveFailures >= 3 ||
      metrics.criticalFailures.length > 0 ||
      metrics.securityIssues.length > 0
    );
  }

  private meetsThreshold(
    metrics: TrustMetrics,
    successRate: number,
    config: TrustLevelConfig,
  ): boolean {
    const { threshold } = config;

    if (metrics.totalExecutions < threshold.minExecutions) return false;
    if (successRate < threshold.successRate) return false;
    if (metrics.averageQualityScore < threshold.averageScore) return false;
    if (threshold.zeroCriticalFailures && metrics.criticalFailures.length > 0)
      return false;

    // Check recent failures (last 5 executions)
    const recentExecutions = metrics.lastExecutions.slice(-5);
    const recentFailures = recentExecutions.filter((e) => !e.success).length;
    if (recentFailures > threshold.maxRecentFailures) return false;

    return true;
  }

  private createDefaultMetrics(): TrustMetrics {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageQualityScore: 50, // Neutral starting score
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      criticalFailures: [],
      securityIssues: [],
      lastExecutions: [],
    };
  }

  private mergeConfigs(
    defaults: TrustLevelConfig[],
    custom?: Array<Partial<TrustLevelConfig>>,
  ): TrustLevelConfig[] {
    if (!custom || custom.length === 0) {
      return defaults;
    }

    return defaults.map((defaultConfig) => {
      const customConfig = custom.find((c) => c.level === defaultConfig.level);
      if (!customConfig) return defaultConfig;

      return {
        ...defaultConfig,
        ...customConfig,
        threshold: { ...defaultConfig.threshold, ...customConfig.threshold },
        privileges: { ...defaultConfig.privileges, ...customConfig.privileges },
      };
    });
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        const store: TrustStore = JSON.parse(content);

        if (store.agents) {
          this.agentMetrics = new Map(Object.entries(store.agents));
        }

        this.initialized = true;
        console.log(
          `[Trust] Loaded metrics for ${this.agentMetrics.size} agents`,
        );
      }
    } catch (error) {
      console.warn(
        '[Trust] Could not load trust metrics, starting fresh:',
        error,
      );
      this.agentMetrics = new Map();
    }
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const store: TrustStore = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        agents: Object.fromEntries(this.agentMetrics),
        metadata: {
          createdAt: this.initialized ? undefined : new Date().toISOString(),
        },
      };

      fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
    } catch (error) {
      console.error('[Trust] Failed to save trust metrics:', error);
    }
  }
}

// Export default level configs for reference
export { DEFAULT_LEVEL_CONFIGS };
