/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Handoff Manager
 * Enables inter-agent task delegation during execution.
 * Agents can delegate specific subtasks to other specialized agents.
 */

import type {
  SpecializedAgent,
  AgentContext,
} from '../agents/specialized/types.js';
import {
  getAgentById,
  AgentSelector,
  AGENT_REGISTRY,
} from '../agents/specialized/index.js';
import type { TrustLevel } from '../trust/types.js';

/**
 * Handoff request from one agent to another
 */
export interface HandoffRequest {
  /** ID of the source agent requesting handoff */
  sourceAgentId: string;
  /** ID of the target agent (optional - can be auto-selected) */
  targetAgentId?: string;
  /** Target domain if no specific agent is specified */
  targetDomain?: string;
  /** Subtask to delegate */
  subtask: string;
  /** Context to pass to the target agent */
  context: HandoffContext;
  /** Priority: 'critical' = must succeed, 'normal' = best effort */
  priority: 'critical' | 'normal';
  /** Maximum time to wait for handoff completion (ms) */
  timeoutMs?: number;
}

/**
 * Context passed during handoff
 */
export interface HandoffContext {
  /** Original task description */
  originalTask: string;
  /** Files already modified by source agent */
  modifiedFiles: string[];
  /** Files already read */
  readFiles: string[];
  /** Partial results from source agent */
  partialResults?: string;
  /** Any errors encountered */
  errors: string[];
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

/**
 * Result of a handoff operation
 */
export interface HandoffResult {
  /** Whether handoff succeeded */
  success: boolean;
  /** Target agent that handled the request */
  handledBy: string;
  /** Output from the target agent */
  output: string;
  /** Files modified by target agent */
  modifiedFiles: string[];
  /** Error message if failed */
  error?: string;
  /** Duration of handoff execution */
  durationMs: number;
  /** Whether the result should be merged back */
  shouldMerge: boolean;
}

/**
 * Handoff chain for tracking delegation history
 */
export interface HandoffChain {
  /** Unique chain ID */
  chainId: string;
  /** Original initiating agent */
  originAgent: string;
  /** Chain of handoffs */
  handoffs: Array<{
    from: string;
    to: string;
    subtask: string;
    timestamp: Date;
    success: boolean;
  }>;
  /** Current depth in the chain */
  depth: number;
  /** Maximum allowed depth */
  maxDepth: number;
}

/**
 * Configuration for HandoffManager
 */
export interface HandoffManagerConfig {
  /** Maximum handoff chain depth (prevents infinite loops) */
  maxChainDepth: number;
  /** Default timeout for handoffs in ms */
  defaultTimeoutMs: number;
  /** Enable automatic agent selection based on subtask */
  autoSelectAgent: boolean;
  /** Minimum trust level for handoff targets */
  minTargetTrustLevel: TrustLevel;
  /** Enable handoff logging */
  verbose: boolean;
}

const DEFAULT_CONFIG: HandoffManagerConfig = {
  maxChainDepth: 3,
  defaultTimeoutMs: 60000,
  autoSelectAgent: true,
  minTargetTrustLevel: 1, // L1_SUPERVISED minimum
  verbose: false,
};

/**
 * HandoffManager class
 * Manages inter-agent task delegation
 */
export class HandoffManager {
  private readonly config: HandoffManagerConfig;
  private readonly agentSelector: AgentSelector;
  private activeChains: Map<string, HandoffChain> = new Map();
  private handoffHistory: HandoffResult[] = [];

  constructor(config: Partial<HandoffManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agentSelector = new AgentSelector();
  }

  /**
   * Request a handoff from one agent to another
   */
  async requestHandoff(
    request: HandoffRequest,
    executeAgent: (
      agent: SpecializedAgent,
      task: string,
      context: AgentContext,
    ) => Promise<{
      success: boolean;
      output: string;
      modifiedFiles: string[];
      error?: string;
    }>,
    chainId?: string,
  ): Promise<HandoffResult> {
    const startTime = Date.now();

    // Get or create handoff chain
    const chain = chainId
      ? this.activeChains.get(chainId)
      : this.createChain(request.sourceAgentId);

    if (!chain) {
      return this.createErrorResult(
        'Handoff chain not found',
        request.sourceAgentId,
        startTime,
      );
    }

    // Check chain depth
    if (chain.depth >= this.config.maxChainDepth) {
      return this.createErrorResult(
        `Maximum handoff depth (${this.config.maxChainDepth}) exceeded`,
        request.sourceAgentId,
        startTime,
      );
    }

    // Select target agent
    const targetAgent = await this.selectTargetAgent(request);
    if (!targetAgent) {
      return this.createErrorResult(
        `No suitable agent found for handoff${request.targetDomain ? ` in domain: ${request.targetDomain}` : ''}`,
        request.sourceAgentId,
        startTime,
      );
    }

    // Prevent self-handoff
    if (targetAgent.id === request.sourceAgentId) {
      return this.createErrorResult(
        'Agent cannot hand off to itself',
        request.sourceAgentId,
        startTime,
      );
    }

    // Check for circular handoffs in the chain
    if (this.hasCircularHandoff(chain, targetAgent.id)) {
      return this.createErrorResult(
        `Circular handoff detected: ${targetAgent.id} is already in the chain`,
        request.sourceAgentId,
        startTime,
      );
    }

    if (this.config.verbose) {
      console.log(
        `[HandoffManager] Handoff: ${request.sourceAgentId} -> ${targetAgent.id} for: ${request.subtask.substring(0, 50)}...`,
      );
    }

    // Update chain
    chain.depth++;
    chain.handoffs.push({
      from: request.sourceAgentId,
      to: targetAgent.id,
      subtask: request.subtask,
      timestamp: new Date(),
      success: false, // Will be updated
    });

    // Build agent context
    const agentContext: AgentContext = {
      originalTask: request.context.originalTask,
      currentSubtask: request.subtask,
      previousContext: request.context.partialResults,
      modifiedFiles: [...request.context.modifiedFiles],
      readFiles: [...request.context.readFiles],
      errors: [...request.context.errors],
      warnings: [],
      metadata: {
        ...request.context.metadata,
        handoffChainId: chain.chainId,
        handoffDepth: chain.depth,
        handoffFrom: request.sourceAgentId,
      },
    };

    try {
      // Execute target agent with timeout
      const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
      const result = await this.executeWithTimeout(
        executeAgent(targetAgent, request.subtask, agentContext),
        timeoutMs,
        targetAgent.id,
      );

      // Update chain status
      const lastHandoff = chain.handoffs[chain.handoffs.length - 1];
      if (lastHandoff) {
        lastHandoff.success = result.success;
      }

      const handoffResult: HandoffResult = {
        success: result.success,
        handledBy: targetAgent.id,
        output: result.output,
        modifiedFiles: result.modifiedFiles,
        error: result.error,
        durationMs: Date.now() - startTime,
        shouldMerge: result.success,
      };

      this.handoffHistory.push(handoffResult);
      return handoffResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return this.createErrorResult(errorMessage, targetAgent.id, startTime);
    }
  }

  /**
   * Select the best target agent for a handoff
   */
  private async selectTargetAgent(
    request: HandoffRequest,
  ): Promise<SpecializedAgent | undefined> {
    // If specific agent ID is provided, use it
    if (request.targetAgentId) {
      return getAgentById(request.targetAgentId);
    }

    // If auto-selection is enabled, select based on subtask
    if (this.config.autoSelectAgent) {
      const selectionResult = this.agentSelector.selectAgents(request.subtask);

      // Filter by domain if specified
      let candidates = selectionResult.agents;
      if (request.targetDomain) {
        candidates = candidates.filter(
          (a) => a.domain === request.targetDomain,
        );
      }

      // Return the best matching agent
      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    // Fallback: if domain is specified, get any agent from that domain
    if (request.targetDomain) {
      return AGENT_REGISTRY.find((a) => a.domain === request.targetDomain);
    }

    return undefined;
  }

  /**
   * Create a new handoff chain
   */
  private createChain(originAgent: string): HandoffChain {
    const chainId = `handoff-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const chain: HandoffChain = {
      chainId,
      originAgent,
      handoffs: [],
      depth: 0,
      maxDepth: this.config.maxChainDepth,
    };
    this.activeChains.set(chainId, chain);
    return chain;
  }

  /**
   * Check if adding an agent would create a circular handoff
   */
  private hasCircularHandoff(chain: HandoffChain, agentId: string): boolean {
    // Check if this agent is already in the chain
    for (const handoff of chain.handoffs) {
      if (handoff.from === agentId || handoff.to === agentId) {
        return true;
      }
    }
    return chain.originAgent === agentId;
  }

  /**
   * Execute with timeout
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
          new Error(`Handoff to ${agentId} timed out after ${timeoutMs}ms`),
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
   * Create an error result
   */
  private createErrorResult(
    error: string,
    handledBy: string,
    startTime: number,
  ): HandoffResult {
    return {
      success: false,
      handledBy,
      output: '',
      modifiedFiles: [],
      error,
      durationMs: Date.now() - startTime,
      shouldMerge: false,
    };
  }

  /**
   * Get handoff chain by ID
   */
  getChain(chainId: string): HandoffChain | undefined {
    return this.activeChains.get(chainId);
  }

  /**
   * Close a handoff chain
   */
  closeChain(chainId: string): void {
    this.activeChains.delete(chainId);
  }

  /**
   * Get handoff history
   */
  getHistory(): HandoffResult[] {
    return [...this.handoffHistory];
  }

  /**
   * Get handoff statistics
   */
  getStats(): {
    totalHandoffs: number;
    successfulHandoffs: number;
    failedHandoffs: number;
    averageDurationMs: number;
    activeChains: number;
  } {
    const successful = this.handoffHistory.filter((h) => h.success).length;
    const avgDuration =
      this.handoffHistory.length > 0
        ? this.handoffHistory.reduce((sum, h) => sum + h.durationMs, 0) /
          this.handoffHistory.length
        : 0;

    return {
      totalHandoffs: this.handoffHistory.length,
      successfulHandoffs: successful,
      failedHandoffs: this.handoffHistory.length - successful,
      averageDurationMs: Math.round(avgDuration),
      activeChains: this.activeChains.size,
    };
  }

  /**
   * Clear history and active chains
   */
  clear(): void {
    this.handoffHistory = [];
    this.activeChains.clear();
  }
}

/**
 * Create a HandoffManager with custom configuration
 */
export function createHandoffManager(
  config?: Partial<HandoffManagerConfig>,
): HandoffManager {
  return new HandoffManager(config);
}
