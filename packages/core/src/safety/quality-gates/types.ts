/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quality Gates Types
 * For pre/post execution validation
 */

import type {
  AgentDomain,
  QualityCheck,
} from '../../agents/specialized/types.js';

/**
 * Severity levels for gate results
 */
export type GateSeverity = 'error' | 'warning' | 'info';

/**
 * Gate execution timing
 */
export type GateTiming = 'pre' | 'post' | 'both';

/**
 * Result of a single gate check
 */
export interface GateCheckResult {
  /** Gate identifier */
  gateId: string;
  /** Gate display name */
  gateName: string;
  /** Whether gate passed */
  passed: boolean;
  /** Severity if failed */
  severity: GateSeverity;
  /** Human-readable message */
  message: string;
  /** Detailed issues found */
  issues: GateIssue[];
  /** Execution duration in ms */
  durationMs: number;
  /** Whether this gate can be skipped */
  skippable: boolean;
}

/**
 * Individual issue found by a gate
 */
export interface GateIssue {
  /** Issue severity */
  severity: GateSeverity;
  /** Issue message */
  message: string;
  /** File path if applicable */
  file?: string;
  /** Line number if applicable */
  line?: number;
  /** Column number if applicable */
  column?: number;
  /** Rule or check that found this issue */
  rule?: string;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Complete gate execution result
 */
export interface GateExecutionResult {
  /** Whether all required gates passed */
  passed: boolean;
  /** Individual gate results */
  gates: GateCheckResult[];
  /** Summary statistics */
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    warnings: number;
  };
  /** Total execution time */
  totalDurationMs: number;
  /** Blocking issues (errors that must be fixed) */
  blockingIssues: GateIssue[];
}

/**
 * Gate definition
 */
export interface QualityGate {
  /** Unique gate identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** When to run this gate */
  timing: GateTiming;
  /** Default severity if gate fails */
  defaultSeverity: GateSeverity;
  /** Domains this gate applies to */
  applicableDomains: AgentDomain[] | 'all';
  /** Quality check type this implements */
  checkType: QualityCheck;
  /** Whether this gate can be skipped */
  skippable: boolean;
  /** Shell command to execute (if command-based) */
  command?: string;
  /** Function to execute (if function-based) */
  checkFn?: (context: GateContext) => Promise<GateCheckResult>;
  /** Function to parse command output (for test result parsing) */
  parseOutput?: (output: string) => Record<string, unknown> | null;
}

/**
 * Context provided to gate checks
 */
export interface GateContext {
  /** Project root directory */
  projectRoot: string;
  /** Files being modified */
  modifiedFiles: string[];
  /** Agent that triggered the check */
  agentId: string;
  /** Task description */
  taskDescription: string;
  /** Trust level */
  trustLevel: number;
  /** Additional options */
  options: Record<string, unknown>;
}

/**
 * Options for gate runner
 */
export interface GateRunnerOptions {
  /** Continue running gates after first failure */
  continueOnFailure?: boolean;
  /** Gates to skip */
  skipGates?: string[];
  /** Treat warnings as errors */
  strictMode?: boolean;
  /** Custom timeout per gate (ms) */
  timeout?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Alias for GateCheckResult (backward compatibility)
 */
export type GateResult = GateCheckResult;

/**
 * Alias for GateRunnerOptions (backward compatibility)
 */
export type GateRunnerConfig = GateRunnerOptions;
