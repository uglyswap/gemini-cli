/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Performance Telemetry
 * Captures metrics for latency, success rates, token usage, and agent performance.
 * Enables monitoring and optimization of the agent orchestration system.
 */

import type { AgentDomain } from '../agents/specialized/types.js';

/**
 * Metric types supported by telemetry
 */
export type MetricType =
  | 'latency'
  | 'success'
  | 'failure'
  | 'token_usage'
  | 'retry'
  | 'handoff'
  | 'gate_check'
  | 'cache_hit'
  | 'cache_miss';

/**
 * Single metric entry
 */
export interface TelemetryMetric {
  /** Unique metric ID */
  id: string;
  /** Metric type */
  type: MetricType;
  /** Timestamp */
  timestamp: Date;
  /** Associated agent ID */
  agentId?: string;
  /** Agent domain */
  domain?: AgentDomain;
  /** Task description (truncated) */
  task?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Token count (input) */
  inputTokens?: number;
  /** Token count (output) */
  outputTokens?: number;
  /** Total token count */
  totalTokens?: number;
  /** Success indicator */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Retry attempt number */
  retryAttempt?: number;
  /** Gate ID for gate checks */
  gateId?: string;
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

/**
 * Aggregated statistics for a time period
 */
export interface AggregatedStats {
  /** Time period start */
  periodStart: Date;
  /** Time period end */
  periodEnd: Date;
  /** Total metrics in period */
  totalMetrics: number;
  /** Latency statistics */
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  /** Success statistics */
  success: {
    total: number;
    successful: number;
    failed: number;
    rate: number;
  };
  /** Token usage statistics */
  tokens: {
    totalInput: number;
    totalOutput: number;
    total: number;
    avgPerRequest: number;
  };
  /** Per-agent statistics */
  byAgent: Map<
    string,
    {
      executions: number;
      successRate: number;
      avgLatency: number;
      totalTokens: number;
    }
  >;
  /** Per-domain statistics */
  byDomain: Map<
    AgentDomain,
    {
      executions: number;
      successRate: number;
      avgLatency: number;
    }
  >;
  /** Retry statistics */
  retries: {
    total: number;
    retriesNeeded: number;
    maxRetries: number;
  };
  /** Cache statistics */
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  /** Maximum metrics to retain in memory */
  maxMetrics: number;
  /** Auto-flush interval in ms (0 = disabled) */
  flushIntervalMs: number;
  /** Enable detailed logging */
  verbose: boolean;
  /** Sampling rate (0-1, 1 = capture all) */
  samplingRate: number;
  /** Custom flush handler */
  onFlush?: (metrics: TelemetryMetric[]) => Promise<void>;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  maxMetrics: 10000,
  flushIntervalMs: 60000, // 1 minute
  verbose: false,
  samplingRate: 1.0,
};

/**
 * PerformanceTelemetry class
 * Centralized telemetry collection and aggregation
 */
export class PerformanceTelemetry {
  private readonly config: TelemetryConfig;
  private metrics: TelemetryMetric[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private metricIdCounter = 0;

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Setup auto-flush if configured
    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(console.error);
      }, this.config.flushIntervalMs);
    }
  }

  /**
   * Generate unique metric ID
   */
  private generateId(): string {
    return `metric-${Date.now()}-${++this.metricIdCounter}`;
  }

  /**
   * Check if metric should be sampled
   */
  private shouldSample(): boolean {
    return Math.random() < this.config.samplingRate;
  }

  /**
   * Record a metric
   */
  record(metric: Omit<TelemetryMetric, 'id' | 'timestamp'>): void {
    if (!this.shouldSample()) return;

    const fullMetric: TelemetryMetric = {
      ...metric,
      id: this.generateId(),
      timestamp: new Date(),
    };

    this.metrics.push(fullMetric);

    // Trim if over limit
    if (this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxMetrics);
    }

    if (this.config.verbose) {
      console.log(
        `[Telemetry] ${metric.type}: ${metric.agentId ?? 'system'}`,
        metric,
      );
    }
  }

  /**
   * Record agent execution start (returns a function to record completion)
   */
  startExecution(
    agentId: string,
    domain: AgentDomain,
    task: string,
  ): (
    success: boolean,
    tokens?: { input: number; output: number },
    error?: string,
  ) => void {
    const startTime = Date.now();

    return (
      success: boolean,
      tokens?: { input: number; output: number },
      error?: string,
    ) => {
      const durationMs = Date.now() - startTime;

      this.record({
        type: success ? 'success' : 'failure',
        agentId,
        domain,
        task: task.substring(0, 100),
        durationMs,
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        totalTokens: tokens ? tokens.input + tokens.output : undefined,
        success,
        error,
        metadata: {},
      });

      // Also record latency
      this.record({
        type: 'latency',
        agentId,
        domain,
        durationMs,
        metadata: {},
      });
    };
  }

  /**
   * Record retry attempt
   */
  recordRetry(
    agentId: string,
    domain: AgentDomain,
    attempt: number,
    error: string,
  ): void {
    this.record({
      type: 'retry',
      agentId,
      domain,
      retryAttempt: attempt,
      error,
      metadata: {},
    });
  }

  /**
   * Record handoff between agents
   */
  recordHandoff(
    sourceAgentId: string,
    targetAgentId: string,
    success: boolean,
    durationMs: number,
  ): void {
    this.record({
      type: 'handoff',
      agentId: sourceAgentId,
      durationMs,
      success,
      metadata: {
        targetAgent: targetAgentId,
      },
    });
  }

  /**
   * Record quality gate check
   */
  recordGateCheck(
    gateId: string,
    passed: boolean,
    durationMs: number,
    issues?: number,
  ): void {
    this.record({
      type: 'gate_check',
      gateId,
      durationMs,
      success: passed,
      metadata: {
        issueCount: issues,
      },
    });
  }

  /**
   * Record cache hit/miss
   */
  recordCacheEvent(hit: boolean, agentId?: string): void {
    this.record({
      type: hit ? 'cache_hit' : 'cache_miss',
      agentId,
      metadata: {},
    });
  }

  /**
   * Record token usage
   */
  recordTokenUsage(
    agentId: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.record({
      type: 'token_usage',
      agentId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      metadata: {},
    });
  }

  /**
   * Get all metrics (optionally filtered)
   */
  getMetrics(filter?: {
    type?: MetricType;
    agentId?: string;
    domain?: AgentDomain;
    since?: Date;
    until?: Date;
  }): TelemetryMetric[] {
    let result = [...this.metrics];

    if (filter?.type) {
      result = result.filter((m) => m.type === filter.type);
    }
    if (filter?.agentId) {
      result = result.filter((m) => m.agentId === filter.agentId);
    }
    if (filter?.domain) {
      result = result.filter((m) => m.domain === filter.domain);
    }
    if (filter?.since) {
      result = result.filter((m) => m.timestamp >= filter.since!);
    }
    if (filter?.until) {
      result = result.filter((m) => m.timestamp <= filter.until!);
    }

    return result;
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * Get aggregated statistics
   */
  getAggregatedStats(since?: Date, until?: Date): AggregatedStats {
    const now = new Date();
    const periodStart = since ?? new Date(now.getTime() - 3600000); // Default: last hour
    const periodEnd = until ?? now;

    const filtered = this.getMetrics({ since: periodStart, until: periodEnd });

    // Latency calculations
    const latencies = filtered
      .filter((m) => m.durationMs !== undefined)
      .map((m) => m.durationMs!)
      .sort((a, b) => a - b);

    const latencyStats = {
      min: latencies.length > 0 ? Math.min(...latencies) : 0,
      max: latencies.length > 0 ? Math.max(...latencies) : 0,
      avg:
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0,
      p50: this.percentile(latencies, 50),
      p90: this.percentile(latencies, 90),
      p99: this.percentile(latencies, 99),
    };

    // Success calculations
    const successMetrics = filtered.filter(
      (m) => m.type === 'success' || m.type === 'failure',
    );
    const successCount = successMetrics.filter((m) => m.success).length;
    const failCount = successMetrics.filter((m) => !m.success).length;

    // Token calculations
    const tokenMetrics = filtered.filter((m) => m.totalTokens !== undefined);
    const totalInput = tokenMetrics.reduce(
      (sum, m) => sum + (m.inputTokens ?? 0),
      0,
    );
    const totalOutput = tokenMetrics.reduce(
      (sum, m) => sum + (m.outputTokens ?? 0),
      0,
    );

    // Per-agent stats
    const byAgent = new Map<
      string,
      {
        executions: number;
        successRate: number;
        avgLatency: number;
        totalTokens: number;
      }
    >();

    const agentMetrics = filtered.filter((m) => m.agentId);
    const agentIds = [...new Set(agentMetrics.map((m) => m.agentId!))];

    for (const agentId of agentIds) {
      const agentData = filtered.filter((m) => m.agentId === agentId);
      const agentSuccess = agentData.filter(
        (m) => m.type === 'success' || m.type === 'failure',
      );
      const agentLatencies = agentData.filter(
        (m) => m.durationMs !== undefined,
      );
      const agentTokens = agentData.filter((m) => m.totalTokens !== undefined);

      byAgent.set(agentId, {
        executions: agentSuccess.length,
        successRate:
          agentSuccess.length > 0
            ? agentSuccess.filter((m) => m.success).length / agentSuccess.length
            : 0,
        avgLatency:
          agentLatencies.length > 0
            ? agentLatencies.reduce((sum, m) => sum + m.durationMs!, 0) /
              agentLatencies.length
            : 0,
        totalTokens: agentTokens.reduce(
          (sum, m) => sum + (m.totalTokens ?? 0),
          0,
        ),
      });
    }

    // Per-domain stats
    const byDomain = new Map<
      AgentDomain,
      {
        executions: number;
        successRate: number;
        avgLatency: number;
      }
    >();

    const domainMetrics = filtered.filter((m) => m.domain);
    const domains = [
      ...new Set(domainMetrics.map((m) => m.domain!)),
    ] as AgentDomain[];

    for (const domain of domains) {
      const domainData = filtered.filter((m) => m.domain === domain);
      const domainSuccess = domainData.filter(
        (m) => m.type === 'success' || m.type === 'failure',
      );
      const domainLatencies = domainData.filter(
        (m) => m.durationMs !== undefined,
      );

      byDomain.set(domain, {
        executions: domainSuccess.length,
        successRate:
          domainSuccess.length > 0
            ? domainSuccess.filter((m) => m.success).length /
              domainSuccess.length
            : 0,
        avgLatency:
          domainLatencies.length > 0
            ? domainLatencies.reduce((sum, m) => sum + m.durationMs!, 0) /
              domainLatencies.length
            : 0,
      });
    }

    // Retry stats
    const retryMetrics = filtered.filter((m) => m.type === 'retry');
    const maxRetries =
      retryMetrics.length > 0
        ? Math.max(...retryMetrics.map((m) => m.retryAttempt ?? 0))
        : 0;

    // Cache stats
    const cacheHits = filtered.filter((m) => m.type === 'cache_hit').length;
    const cacheMisses = filtered.filter((m) => m.type === 'cache_miss').length;
    const totalCacheOps = cacheHits + cacheMisses;

    return {
      periodStart,
      periodEnd,
      totalMetrics: filtered.length,
      latency: latencyStats,
      success: {
        total: successMetrics.length,
        successful: successCount,
        failed: failCount,
        rate:
          successMetrics.length > 0 ? successCount / successMetrics.length : 0,
      },
      tokens: {
        totalInput,
        totalOutput,
        total: totalInput + totalOutput,
        avgPerRequest:
          tokenMetrics.length > 0
            ? (totalInput + totalOutput) / tokenMetrics.length
            : 0,
      },
      byAgent,
      byDomain,
      retries: {
        total: successMetrics.length,
        retriesNeeded: retryMetrics.length,
        maxRetries,
      },
      cache: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: totalCacheOps > 0 ? cacheHits / totalCacheOps : 0,
      },
    };
  }

  /**
   * Get a summary report string
   */
  getSummaryReport(since?: Date): string {
    const stats = this.getAggregatedStats(since);
    const lines: string[] = [
      '═══════════════════════════════════════════════════════════════',
      '                   PERFORMANCE TELEMETRY REPORT                 ',
      '═══════════════════════════════════════════════════════════════',
      `Period: ${stats.periodStart.toISOString()} - ${stats.periodEnd.toISOString()}`,
      `Total Metrics: ${stats.totalMetrics}`,
      '',
      '📊 LATENCY',
      `   Min: ${stats.latency.min}ms | Max: ${stats.latency.max}ms | Avg: ${Math.round(stats.latency.avg)}ms`,
      `   P50: ${stats.latency.p50}ms | P90: ${stats.latency.p90}ms | P99: ${stats.latency.p99}ms`,
      '',
      '✅ SUCCESS RATE',
      `   Total: ${stats.success.total} | Success: ${stats.success.successful} | Failed: ${stats.success.failed}`,
      `   Rate: ${(stats.success.rate * 100).toFixed(1)}%`,
      '',
      '🪙 TOKEN USAGE',
      `   Input: ${stats.tokens.totalInput} | Output: ${stats.tokens.totalOutput}`,
      `   Total: ${stats.tokens.total} | Avg/Request: ${Math.round(stats.tokens.avgPerRequest)}`,
      '',
      '🔄 RETRIES',
      `   Operations: ${stats.retries.total} | Retries Needed: ${stats.retries.retriesNeeded}`,
      `   Max Retries: ${stats.retries.maxRetries}`,
      '',
      '💾 CACHE',
      `   Hits: ${stats.cache.hits} | Misses: ${stats.cache.misses}`,
      `   Hit Rate: ${(stats.cache.hitRate * 100).toFixed(1)}%`,
      '',
    ];

    // Per-agent stats
    if (stats.byAgent.size > 0) {
      lines.push('🤖 PER-AGENT STATS');
      for (const [agentId, agentStats] of stats.byAgent) {
        lines.push(`   ${agentId}:`);
        lines.push(
          `      Executions: ${agentStats.executions} | Success: ${(agentStats.successRate * 100).toFixed(1)}%`,
        );
        lines.push(
          `      Avg Latency: ${Math.round(agentStats.avgLatency)}ms | Tokens: ${agentStats.totalTokens}`,
        );
      }
      lines.push('');
    }

    // Per-domain stats
    if (stats.byDomain.size > 0) {
      lines.push('🏷️ PER-DOMAIN STATS');
      for (const [domain, domainStats] of stats.byDomain) {
        lines.push(
          `   ${domain}: ${domainStats.executions} exec | ${(domainStats.successRate * 100).toFixed(1)}% success | ${Math.round(domainStats.avgLatency)}ms avg`,
        );
      }
      lines.push('');
    }

    lines.push(
      '═══════════════════════════════════════════════════════════════',
    );

    return lines.join('\n');
  }

  /**
   * Flush metrics (call onFlush handler if configured)
   */
  async flush(): Promise<void> {
    if (this.config.onFlush && this.metrics.length > 0) {
      const toFlush = [...this.metrics];
      try {
        await this.config.onFlush(toFlush);
        if (this.config.verbose) {
          console.log(`[Telemetry] Flushed ${toFlush.length} metrics`);
        }
      } catch (error) {
        console.error('[Telemetry] Flush error:', error);
      }
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Stop telemetry (cleanup timers)
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get metric count
   */
  get count(): number {
    return this.metrics.length;
  }
}

/**
 * Global telemetry instance
 */
let globalTelemetry: PerformanceTelemetry | null = null;

/**
 * Get or create the global telemetry instance
 */
export function getTelemetry(
  config?: Partial<TelemetryConfig>,
): PerformanceTelemetry {
  if (!globalTelemetry) {
    globalTelemetry = new PerformanceTelemetry(config);
  }
  return globalTelemetry;
}

/**
 * Create a new telemetry instance (not global)
 */
export function createTelemetry(
  config?: Partial<TelemetryConfig>,
): PerformanceTelemetry {
  return new PerformanceTelemetry(config);
}

/**
 * Reset global telemetry instance
 */
export function resetTelemetry(): void {
  if (globalTelemetry) {
    globalTelemetry.stop();
    globalTelemetry = null;
  }
}
