/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FeedbackLoop
 *
 * Intelligent retry system with:
 * 1. Max iteration limits
 * 2. Exponential backoff
 * 3. Error classification
 * 4. Adaptive retry strategies
 * 5. Progress tracking
 */

import type { PipelineIssue } from '../validation/validation-pipeline.js';

/**
 * Feedback loop iteration result
 */
export interface IterationResult {
  /** Iteration number (1-based) */
  iteration: number;
  /** Whether this iteration succeeded */
  success: boolean;
  /** Errors found in this iteration */
  errors: FeedbackError[];
  /** Actions taken to fix errors */
  actionsTaken: FixAction[];
  /** Duration of this iteration in ms */
  durationMs: number;
  /** Agent that performed the iteration */
  agentId?: string;
}

/**
 * Categorized error from feedback
 */
export interface FeedbackError {
  /** Unique error ID for tracking */
  id: string;
  /** Error category */
  category: ErrorCategory;
  /** Error message */
  message: string;
  /** File affected */
  file?: string;
  /** Line number */
  line?: number;
  /** Suggested fix */
  suggestedFix?: string;
  /** Number of times this error has occurred */
  occurrenceCount: number;
  /** Whether this error is fixable automatically */
  autoFixable: boolean;
}

/**
 * Error categories for classification
 */
export type ErrorCategory =
  | 'type_error'
  | 'syntax_error'
  | 'lint_error'
  | 'security_error'
  | 'test_failure'
  | 'runtime_error'
  | 'dependency_error'
  | 'configuration_error'
  | 'unknown';

/**
 * Action taken to fix an error
 */
export interface FixAction {
  /** Error ID this action addresses */
  errorId: string;
  /** Type of fix */
  type:
    | 'code_change'
    | 'config_change'
    | 'dependency_add'
    | 'file_create'
    | 'file_delete'
    | 'manual';
  /** Description of the fix */
  description: string;
  /** File modified */
  file?: string;
  /** Line range affected */
  lineRange?: { start: number; end: number };
  /** Whether the fix was successful */
  success: boolean;
}

/**
 * Complete feedback loop result
 */
export interface FeedbackLoopResult {
  /** Overall success */
  success: boolean;
  /** Total iterations performed */
  iterations: number;
  /** Maximum iterations allowed */
  maxIterations: number;
  /** Whether max iterations was reached */
  maxIterationsReached: boolean;
  /** Total duration in ms */
  totalDurationMs: number;
  /** All iteration results */
  iterationResults: IterationResult[];
  /** Remaining unresolved errors */
  unresolvedErrors: FeedbackError[];
  /** Errors that were fixed */
  resolvedErrors: FeedbackError[];
  /** Summary message */
  summary: string;
}

/**
 * Feedback loop configuration
 */
export interface FeedbackLoopConfig {
  /** Maximum number of iterations */
  maxIterations: number;
  /** Base delay between iterations in ms */
  baseDelayMs: number;
  /** Maximum delay between iterations in ms */
  maxDelayMs: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Stop on first success */
  stopOnSuccess: boolean;
  /** Error categories to retry */
  retryCategories: ErrorCategory[];
  /** Error categories to NOT retry (fail immediately) */
  noRetryCategories: ErrorCategory[];
  /** Callback for progress updates */
  onProgress?: (
    iteration: number,
    result: IterationResult,
  ) => void | Promise<void>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FeedbackLoopConfig = {
  maxIterations: 5,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  exponentialBackoff: true,
  stopOnSuccess: true,
  retryCategories: ['type_error', 'syntax_error', 'lint_error', 'test_failure'],
  noRetryCategories: ['security_error', 'configuration_error'],
};

/**
 * Retry strategy function type
 */
export type RetryStrategy = (
  errors: FeedbackError[],
  iteration: number,
  context: RetryContext,
) => Promise<FixAction[]>;

/**
 * Context passed to retry strategies
 */
export interface RetryContext {
  /** Previous iteration results */
  previousIterations: IterationResult[];
  /** Original task description */
  taskDescription: string;
  /** Working directory */
  workingDirectory: string;
  /** Error memory for learning */
  errorMemory?: Map<string, FeedbackError>;
}

/**
 * FeedbackLoop class for intelligent retries
 */
export class FeedbackLoop {
  private readonly config: FeedbackLoopConfig;
  private errorCounter = 0;

  constructor(config: Partial<FeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the feedback loop
   */
  async run(
    executeIteration: () => Promise<{
      success: boolean;
      errors: PipelineIssue[];
    }>,
    retryStrategy: RetryStrategy,
    context: RetryContext,
  ): Promise<FeedbackLoopResult> {
    const startTime = Date.now();
    const iterationResults: IterationResult[] = [];
    const resolvedErrors: FeedbackError[] = [];
    let currentErrors: FeedbackError[] = [];

    for (let i = 1; i <= this.config.maxIterations; i++) {
      const iterationStart = Date.now();

      // Execute the iteration
      const { success, errors } = await executeIteration();

      // Convert validation issues to feedback errors
      const feedbackErrors = this.convertToFeedbackErrors(errors);

      // Track which errors were resolved
      for (const prevError of currentErrors) {
        if (!feedbackErrors.some((e) => e.id === prevError.id)) {
          resolvedErrors.push(prevError);
        }
      }

      currentErrors = feedbackErrors;

      // Check for success
      if (success || currentErrors.length === 0) {
        const result: IterationResult = {
          iteration: i,
          success: true,
          errors: [],
          actionsTaken: [],
          durationMs: Date.now() - iterationStart,
        };
        iterationResults.push(result);

        if (this.config.onProgress) {
          await this.config.onProgress(i, result);
        }

        if (this.config.stopOnSuccess) {
          return this.buildResult(
            true,
            i,
            startTime,
            iterationResults,
            [],
            resolvedErrors,
          );
        }
      }

      // Check for non-retryable errors
      const nonRetryable = currentErrors.filter((e) =>
        this.config.noRetryCategories.includes(e.category),
      );
      if (nonRetryable.length > 0) {
        const result: IterationResult = {
          iteration: i,
          success: false,
          errors: currentErrors,
          actionsTaken: [],
          durationMs: Date.now() - iterationStart,
        };
        iterationResults.push(result);

        return this.buildResult(
          false,
          i,
          startTime,
          iterationResults,
          currentErrors,
          resolvedErrors,
        );
      }

      // Filter to retryable errors only
      const retryableErrors = currentErrors.filter((e) =>
        this.config.retryCategories.includes(e.category),
      );

      if (retryableErrors.length === 0) {
        // Only non-categorized errors remain, treat as unresolvable
        const result: IterationResult = {
          iteration: i,
          success: false,
          errors: currentErrors,
          actionsTaken: [],
          durationMs: Date.now() - iterationStart,
        };
        iterationResults.push(result);

        return this.buildResult(
          false,
          i,
          startTime,
          iterationResults,
          currentErrors,
          resolvedErrors,
        );
      }

      // Apply retry strategy
      const actions = await retryStrategy(retryableErrors, i, {
        ...context,
        previousIterations: iterationResults,
      });

      const result: IterationResult = {
        iteration: i,
        success: false,
        errors: retryableErrors,
        actionsTaken: actions,
        durationMs: Date.now() - iterationStart,
      };
      iterationResults.push(result);

      if (this.config.onProgress) {
        await this.config.onProgress(i, result);
      }

      // Wait before next iteration
      if (i < this.config.maxIterations) {
        await this.delay(i);
      }
    }

    // Max iterations reached
    return this.buildResult(
      false,
      this.config.maxIterations,
      startTime,
      iterationResults,
      currentErrors,
      resolvedErrors,
    );
  }

  /**
   * Convert validation issues to feedback errors
   */
  private convertToFeedbackErrors(issues: PipelineIssue[]): FeedbackError[] {
    const errors: FeedbackError[] = [];
    const seen = new Map<string, FeedbackError>();

    for (const issue of issues) {
      // Create a unique key for deduplication
      const key = `${issue.file}:${issue.line}:${issue.rule}:${issue.message}`;

      if (seen.has(key)) {
        seen.get(key)!.occurrenceCount++;
        continue;
      }

      const error: FeedbackError = {
        id: `err_${++this.errorCounter}`,
        category: this.categorizeError(issue),
        message: issue.message,
        file: issue.file,
        line: issue.line,
        occurrenceCount: 1,
        autoFixable: this.isAutoFixable(issue),
        suggestedFix: this.suggestFix(issue),
      };

      seen.set(key, error);
      errors.push(error);
    }

    return errors;
  }

  /**
   * Categorize an error based on its properties
   */
  private categorizeError(issue: PipelineIssue): ErrorCategory {
    const rule = issue.rule?.toLowerCase() || '';
    const message = issue.message.toLowerCase();

    // Type errors
    if (
      rule.startsWith('ts') ||
      message.includes('type') ||
      message.includes('is not assignable')
    ) {
      return 'type_error';
    }

    // Syntax errors
    if (
      message.includes('syntax') ||
      message.includes('unexpected token') ||
      message.includes('parsing error')
    ) {
      return 'syntax_error';
    }

    // Security errors
    if (
      rule.includes('security') ||
      message.includes('xss') ||
      message.includes('injection') ||
      message.includes('secret') ||
      message.includes('eval')
    ) {
      return 'security_error';
    }

    // Test failures
    if (
      message.includes('test failed') ||
      message.includes('assertion') ||
      message.includes('expect')
    ) {
      return 'test_failure';
    }

    // Dependency errors
    if (
      message.includes('module not found') ||
      message.includes('cannot find module') ||
      message.includes('dependency')
    ) {
      return 'dependency_error';
    }

    // Configuration errors
    if (
      message.includes('config') ||
      message.includes('tsconfig') ||
      message.includes('eslintrc')
    ) {
      return 'configuration_error';
    }

    // Lint errors (most common fallback)
    if (rule && !rule.startsWith('ts')) {
      return 'lint_error';
    }

    return 'unknown';
  }

  /**
   * Check if an error can be auto-fixed
   */
  private isAutoFixable(issue: PipelineIssue): boolean {
    const rule = issue.rule?.toLowerCase() || '';

    // Common auto-fixable ESLint rules
    const autoFixableRules = [
      'semi',
      'quotes',
      'indent',
      'comma-dangle',
      'no-trailing-spaces',
      'eol-last',
      'prettier',
      '@typescript-eslint/semi',
      '@typescript-eslint/quotes',
    ];

    return autoFixableRules.some((r) => rule.includes(r));
  }

  /**
   * Suggest a fix for an error
   */
  private suggestFix(issue: PipelineIssue): string | undefined {
    const rule = issue.rule?.toLowerCase() || '';
    const message = issue.message.toLowerCase();

    if (rule.includes('semi')) {
      return 'Add or remove semicolon';
    }
    if (rule.includes('quotes')) {
      return 'Change quote style';
    }
    if (message.includes('is not assignable')) {
      return 'Update type annotation or cast';
    }
    if (message.includes('cannot find name')) {
      return 'Import the missing symbol or define it';
    }
    if (message.includes('unused')) {
      return 'Remove unused variable or prefix with underscore';
    }

    return undefined;
  }

  /**
   * Calculate delay for exponential backoff
   */
  private async delay(iteration: number): Promise<void> {
    let delayMs = this.config.baseDelayMs;

    if (this.config.exponentialBackoff) {
      delayMs = Math.min(
        this.config.baseDelayMs * Math.pow(2, iteration - 1),
        this.config.maxDelayMs,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Build the final result
   */
  private buildResult(
    success: boolean,
    iterations: number,
    startTime: number,
    iterationResults: IterationResult[],
    unresolvedErrors: FeedbackError[],
    resolvedErrors: FeedbackError[],
  ): FeedbackLoopResult {
    const maxIterationsReached =
      iterations >= this.config.maxIterations && !success;

    let summary = '';
    if (success) {
      summary = `✅ Fixed all errors in ${iterations} iteration${iterations > 1 ? 's' : ''}`;
      if (resolvedErrors.length > 0) {
        summary += ` (resolved ${resolvedErrors.length} error${resolvedErrors.length > 1 ? 's' : ''})`;
      }
    } else if (maxIterationsReached) {
      summary = `❌ Max iterations (${this.config.maxIterations}) reached with ${unresolvedErrors.length} unresolved errors`;
    } else {
      summary = `❌ Failed after ${iterations} iterations: ${unresolvedErrors.length} unresolved errors`;
    }

    return {
      success,
      iterations,
      maxIterations: this.config.maxIterations,
      maxIterationsReached,
      totalDurationMs: Date.now() - startTime,
      iterationResults,
      unresolvedErrors,
      resolvedErrors,
      summary,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<FeedbackLoopConfig> {
    return this.config;
  }
}

/**
 * Create a FeedbackLoop with custom configuration
 */
export function createFeedbackLoop(
  config?: Partial<FeedbackLoopConfig>,
): FeedbackLoop {
  return new FeedbackLoop(config);
}

/**
 * Default retry strategy that logs errors
 */
export const defaultRetryStrategy: RetryStrategy = async (
  errors,
  iteration,
  _context,
) => {
  console.log(
    `[FeedbackLoop] Iteration ${iteration}: ${errors.length} errors to fix`,
  );

  // Return empty actions - actual fix implementation is task-specific
  return errors.map((error) => ({
    errorId: error.id,
    type: 'manual' as const,
    description: error.suggestedFix || 'Manual fix required',
    file: error.file,
    success: false,
  }));
};

/**
 * Simple retry that just re-executes without changes
 */
export const simpleRetryStrategy: RetryStrategy = async () => 
  // No actions taken, just retry
   []
;
