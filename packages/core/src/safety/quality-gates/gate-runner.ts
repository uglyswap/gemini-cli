/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quality Gate Runner
 * Executes quality gates before and after agent operations
 */

import { spawn } from 'node:child_process';
import type {
  QualityGate,
  GateContext,
  GateCheckResult,
  GateExecutionResult,
  GateTiming,
  GateRunnerOptions,
  GateIssue,
} from './types.js';
import { BUILT_IN_GATES } from './built-in-gates.js';
import type { AgentDomain } from '../../agents/specialized/types.js';

const DEFAULT_OPTIONS: Required<GateRunnerOptions> = {
  continueOnFailure: true,
  skipGates: [],
  strictMode: false,
  timeout: 60000, // 1 minute
  verbose: false,
};

/**
 * Quality Gate Runner
 * Manages and executes quality gates
 */
export class GateRunner {
  private gates: Map<string, QualityGate> = new Map();
  private options: Required<GateRunnerOptions>;

  constructor(options: GateRunnerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Register built-in gates
    for (const gate of BUILT_IN_GATES) {
      this.registerGate(gate);
    }
  }

  /**
   * Register a custom quality gate
   */
  registerGate(gate: QualityGate): void {
    this.gates.set(gate.id, gate);
    if (this.options.verbose) {
      console.log(`[QualityGates] Registered gate: ${gate.id}`);
    }
  }

  /**
   * Unregister a gate
   */
  unregisterGate(gateId: string): boolean {
    return this.gates.delete(gateId);
  }

  /**
   * Get all registered gates
   */
  getGates(): QualityGate[] {
    return Array.from(this.gates.values());
  }

  /**
   * Get gates applicable to a domain
   */
  getGatesForDomain(domain: AgentDomain): QualityGate[] {
    return this.getGates().filter((gate) => {
      if (gate.applicableDomains === 'all') return true;
      return gate.applicableDomains.includes(domain);
    });
  }

  /**
   * Run gates for a specific timing
   */
  async runGates(
    timing: GateTiming,
    context: GateContext,
    domain?: AgentDomain,
  ): Promise<GateExecutionResult> {
    const startTime = Date.now();
    const results: GateCheckResult[] = [];
    const blockingIssues: GateIssue[] = [];

    // Get applicable gates
    let gates = domain ? this.getGatesForDomain(domain) : this.getGates();

    // Filter by timing
    gates = gates.filter(
      (gate) => gate.timing === timing || gate.timing === 'both',
    );

    // Filter out skipped gates
    gates = gates.filter((gate) => !this.options.skipGates.includes(gate.id));

    if (this.options.verbose) {
      console.log(
        `[QualityGates] Running ${gates.length} ${timing} gates for ${domain || 'all'} domain`,
      );
    }

    let allPassed = true;

    for (const gate of gates) {
      try {
        const result = await this.runSingleGate(gate, context);
        results.push(result);

        if (!result.passed) {
          if (
            result.severity === 'error' ||
            (this.options.strictMode && result.severity === 'warning')
          ) {
            allPassed = false;
            blockingIssues.push(
              ...result.issues.filter((i) => i.severity === 'error'),
            );

            if (!this.options.continueOnFailure) {
              console.log(
                `[QualityGates] Stopping on gate failure: ${gate.id}`,
              );
              break;
            }
          }
        }
      } catch (error) {
        const errorResult: GateCheckResult = {
          gateId: gate.id,
          gateName: gate.name,
          passed: false,
          severity: 'error',
          message: `Gate execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          issues: [
            {
              severity: 'error',
              message: error instanceof Error ? error.message : 'Unknown error',
              rule: 'gate-execution',
            },
          ],
          durationMs: 0,
          skippable: gate.skippable,
        };
        results.push(errorResult);
        allPassed = false;

        if (!this.options.continueOnFailure) {
          break;
        }
      }
    }

    // Calculate summary
    const summary = {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      skipped: gates.length - results.length,
      errors: results.filter((r) => r.severity === 'error' && !r.passed).length,
      warnings: results.filter((r) => r.severity === 'warning' && !r.passed)
        .length,
    };

    const totalDurationMs = Date.now() - startTime;

    if (this.options.verbose) {
      console.log(
        `[QualityGates] Completed: ${summary.passed}/${summary.total} passed, ` +
          `${summary.errors} errors, ${summary.warnings} warnings (${totalDurationMs}ms)`,
      );
    }

    return {
      passed: allPassed,
      gates: results,
      summary,
      totalDurationMs,
      blockingIssues,
    };
  }

  /**
   * Run pre-execution gates
   */
  async runPreGates(
    context: GateContext,
    domain?: AgentDomain,
  ): Promise<GateExecutionResult> {
    console.log('[QualityGates] Running pre-execution gates...');
    return this.runGates('pre', context, domain);
  }

  /**
   * Run post-execution gates
   */
  async runPostGates(
    context: GateContext,
    domain?: AgentDomain,
  ): Promise<GateExecutionResult> {
    console.log('[QualityGates] Running post-execution gates...');
    return this.runGates('post', context, domain);
  }

  // Private methods

  private async runSingleGate(
    gate: QualityGate,
    context: GateContext,
  ): Promise<GateCheckResult> {
    const startTime = Date.now();

    if (this.options.verbose) {
      console.log(`[QualityGates] Running gate: ${gate.id}`);
    }

    // If gate has a custom function, use it
    if (gate.checkFn) {
      const result = await Promise.race([
        gate.checkFn(context),
        this.timeout(gate.id),
      ]);
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // If gate has a command, execute it
    if (gate.command) {
      return this.runCommandGate(gate, context, startTime);
    }

    // No check method defined
    return {
      gateId: gate.id,
      gateName: gate.name,
      passed: true,
      severity: 'info',
      message: 'Gate has no check method defined, skipping',
      issues: [],
      durationMs: Date.now() - startTime,
      skippable: true,
    };
  }

  private async runCommandGate(
    gate: QualityGate,
    context: GateContext,
    startTime: number,
  ): Promise<GateCheckResult> {
    return new Promise((resolve) => {
      const issues: GateIssue[] = [];
      let stdout = '';
      let stderr = '';

      const child = spawn(gate.command!, {
        cwd: context.projectRoot,
        shell: true,
        timeout: this.options.timeout,
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const passed = code === 0;

        if (!passed) {
          // Parse output for issues (simplified)
          const output = stdout + stderr;
          const lines = output.split('\n').filter((l) => l.trim());

          for (const line of lines.slice(0, 10)) {
            // Limit to 10 issues
            issues.push({
              severity: gate.defaultSeverity,
              message: line.trim(),
              rule: gate.id,
            });
          }
        }

        resolve({
          gateId: gate.id,
          gateName: gate.name,
          passed,
          severity: passed ? 'info' : gate.defaultSeverity,
          message: passed
            ? `${gate.name} passed`
            : `${gate.name} failed with exit code ${code}`,
          issues,
          durationMs: Date.now() - startTime,
          skippable: gate.skippable,
        });
      });

      child.on('error', (error) => {
        resolve({
          gateId: gate.id,
          gateName: gate.name,
          passed: false,
          severity: 'error',
          message: `Failed to execute: ${error.message}`,
          issues: [
            {
              severity: 'error',
              message: error.message,
              rule: 'command-execution',
            },
          ],
          durationMs: Date.now() - startTime,
          skippable: gate.skippable,
        });
      });
    });
  }

  private timeout(gateId: string): Promise<GateCheckResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`Gate ${gateId} timed out after ${this.options.timeout}ms`),
        );
      }, this.options.timeout);
    });
  }
}
