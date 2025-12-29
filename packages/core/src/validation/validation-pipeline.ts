/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ValidationPipeline
 *
 * Integrated validation system that runs:
 * 1. TypeScript type checking
 * 2. ESLint linting
 * 3. Security scanning
 * 4. Unit tests (optional)
 *
 * Used after code generation to ensure quality before commit.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DiffValidator, type DiffValidationResult } from './diff-validator.js';

/**
 * Validation step result
 */
export interface ValidationStepResult {
  /** Step name */
  step: string;
  /** Whether step passed */
  passed: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error/warning count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Raw output from the tool */
  output: string;
  /** Parsed issues */
  issues: PipelineIssue[];
}

/**
 * Individual validation issue for the pipeline
 */
export interface PipelineIssue {
  /** Issue type */
  type: 'error' | 'warning' | 'info';
  /** File path */
  file?: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Issue message */
  message: string;
  /** Rule/code that triggered the issue */
  rule?: string;
}

/**
 * Complete pipeline result
 */
export interface PipelineResult {
  /** Overall success */
  success: boolean;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Number of steps run */
  stepsRun: number;
  /** Number of steps passed */
  stepsPassed: number;
  /** Total errors across all steps */
  totalErrors: number;
  /** Total warnings across all steps */
  totalWarnings: number;
  /** Results for each step */
  steps: ValidationStepResult[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Enable TypeScript type checking */
  enableTypeCheck: boolean;
  /** Enable ESLint linting */
  enableLint: boolean;
  /** Enable security scanning (via DiffValidator) */
  enableSecurity: boolean;
  /** Enable unit tests */
  enableTests: boolean;
  /** Test command (e.g., "npm test", "pnpm test") */
  testCommand: string;
  /** TypeScript config file */
  tsconfigPath: string;
  /** ESLint config file */
  eslintConfigPath?: string;
  /** Timeout for each step in ms */
  stepTimeoutMs: number;
  /** Files to validate (empty = all) */
  files: string[];
  /** Continue on error */
  continueOnError: boolean;
}

/**
 * Default pipeline configuration
 */
const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enableTypeCheck: true,
  enableLint: true,
  enableSecurity: true,
  enableTests: false, // Tests are opt-in
  testCommand: 'npm test',
  tsconfigPath: 'tsconfig.json',
  stepTimeoutMs: 60000, // 1 minute
  files: [],
  continueOnError: true,
};

/**
 * ValidationPipeline class
 */
export class ValidationPipeline {
  private readonly config: PipelineConfig;
  private readonly diffValidator: DiffValidator;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.diffValidator = new DiffValidator();
  }

  /**
   * Run the complete validation pipeline
   */
  async run(workingDirectory: string): Promise<PipelineResult> {
    const startTime = Date.now();
    const steps: ValidationStepResult[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    // Step 1: TypeScript Type Checking
    if (this.config.enableTypeCheck) {
      const typeCheckResult = await this.runTypeCheck(workingDirectory);
      steps.push(typeCheckResult);
      totalErrors += typeCheckResult.errorCount;
      totalWarnings += typeCheckResult.warningCount;

      if (!typeCheckResult.passed && !this.config.continueOnError) {
        return this.buildResult(steps, startTime, totalErrors, totalWarnings);
      }
    }

    // Step 2: ESLint Linting
    if (this.config.enableLint) {
      const lintResult = await this.runLint(workingDirectory);
      steps.push(lintResult);
      totalErrors += lintResult.errorCount;
      totalWarnings += lintResult.warningCount;

      if (!lintResult.passed && !this.config.continueOnError) {
        return this.buildResult(steps, startTime, totalErrors, totalWarnings);
      }
    }

    // Step 3: Security Scanning
    if (this.config.enableSecurity) {
      const securityResult = await this.runSecurityScan(workingDirectory);
      steps.push(securityResult);
      totalErrors += securityResult.errorCount;
      totalWarnings += securityResult.warningCount;

      if (!securityResult.passed && !this.config.continueOnError) {
        return this.buildResult(steps, startTime, totalErrors, totalWarnings);
      }
    }

    // Step 4: Unit Tests (optional)
    if (this.config.enableTests) {
      const testResult = await this.runTests(workingDirectory);
      steps.push(testResult);
      totalErrors += testResult.errorCount;
      totalWarnings += testResult.warningCount;
    }

    return this.buildResult(steps, startTime, totalErrors, totalWarnings);
  }

  /**
   * Run TypeScript type checking
   */
  private async runTypeCheck(
    workingDirectory: string,
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();
    const tsconfigPath = path.join(workingDirectory, this.config.tsconfigPath);

    // Check if tsconfig exists
    if (!fs.existsSync(tsconfigPath)) {
      return {
        step: 'typecheck',
        passed: true,
        durationMs: Date.now() - startTime,
        errorCount: 0,
        warningCount: 0,
        output: 'No tsconfig.json found, skipping type check',
        issues: [],
      };
    }

    try {
      const output = await this.runCommand(
        'npx',
        ['tsc', '--noEmit', '--pretty', 'false'],
        workingDirectory,
      );

      const issues = this.parseTypeScriptOutput(output);
      const errorCount = issues.filter((i) => i.type === 'error').length;
      const warningCount = issues.filter((i) => i.type === 'warning').length;

      return {
        step: 'typecheck',
        passed: errorCount === 0,
        durationMs: Date.now() - startTime,
        errorCount,
        warningCount,
        output,
        issues,
      };
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      const issues = this.parseTypeScriptOutput(output);

      return {
        step: 'typecheck',
        passed: false,
        durationMs: Date.now() - startTime,
        errorCount: issues.filter((i) => i.type === 'error').length || 1,
        warningCount: issues.filter((i) => i.type === 'warning').length,
        output,
        issues,
      };
    }
  }

  /**
   * Run ESLint linting
   */
  private async runLint(
    workingDirectory: string,
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    // Check if eslint is available
    const eslintConfigExists =
      fs.existsSync(path.join(workingDirectory, '.eslintrc.js')) ||
      fs.existsSync(path.join(workingDirectory, '.eslintrc.json')) ||
      fs.existsSync(path.join(workingDirectory, '.eslintrc.cjs')) ||
      fs.existsSync(path.join(workingDirectory, 'eslint.config.js')) ||
      fs.existsSync(path.join(workingDirectory, 'eslint.config.mjs'));

    if (!eslintConfigExists) {
      return {
        step: 'lint',
        passed: true,
        durationMs: Date.now() - startTime,
        errorCount: 0,
        warningCount: 0,
        output: 'No ESLint config found, skipping lint',
        issues: [],
      };
    }

    try {
      const args = ['eslint', '.', '--format', 'json', '--max-warnings', '0'];
      if (this.config.files.length > 0) {
        args[1] = this.config.files.join(' ');
      }

      const output = await this.runCommand('npx', args, workingDirectory);
      const issues = this.parseEslintOutput(output);
      const errorCount = issues.filter((i) => i.type === 'error').length;
      const warningCount = issues.filter((i) => i.type === 'warning').length;

      return {
        step: 'lint',
        passed: errorCount === 0,
        durationMs: Date.now() - startTime,
        errorCount,
        warningCount,
        output,
        issues,
      };
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      const issues = this.parseEslintOutput(output);

      return {
        step: 'lint',
        passed: false,
        durationMs: Date.now() - startTime,
        errorCount: issues.filter((i) => i.type === 'error').length || 1,
        warningCount: issues.filter((i) => i.type === 'warning').length,
        output,
        issues,
      };
    }
  }

  /**
   * Run security scanning using DiffValidator
   */
  private async runSecurityScan(
    workingDirectory: string,
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    try {
      // Get files to scan
      let filesToScan = this.config.files;
      if (filesToScan.length === 0) {
        // Scan all TypeScript/JavaScript files
        filesToScan = await this.collectSourceFiles(workingDirectory);
      }

      const result: DiffValidationResult =
        await this.diffValidator.validateChanges(filesToScan, workingDirectory);

      const issues: PipelineIssue[] = result.fileResults.flatMap((fr) =>
        fr.issues.map((issue) => ({
          type: issue.type,
          file: fr.filePath,
          line: issue.line,
          column: issue.column,
          message: issue.message,
          rule: issue.rule,
        })),
      );

      return {
        step: 'security',
        passed: result.valid,
        durationMs: Date.now() - startTime,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        output: result.summary,
        issues,
      };
    } catch (error) {
      return {
        step: 'security',
        passed: false,
        durationMs: Date.now() - startTime,
        errorCount: 1,
        warningCount: 0,
        output: error instanceof Error ? error.message : String(error),
        issues: [
          {
            type: 'error',
            message: `Security scan failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  /**
   * Run unit tests
   */
  private async runTests(
    workingDirectory: string,
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    try {
      const [cmd, ...args] = this.config.testCommand.split(' ');
      const output = await this.runCommand(cmd, args, workingDirectory);

      // Parse test output for failures
      const hasFailures =
        output.includes('FAIL') ||
        output.includes('failed') ||
        output.includes('Error:');

      return {
        step: 'tests',
        passed: !hasFailures,
        durationMs: Date.now() - startTime,
        errorCount: hasFailures ? 1 : 0,
        warningCount: 0,
        output,
        issues: hasFailures
          ? [{ type: 'error', message: 'One or more tests failed' }]
          : [],
      };
    } catch (error) {
      return {
        step: 'tests',
        passed: false,
        durationMs: Date.now() - startTime,
        errorCount: 1,
        warningCount: 0,
        output: error instanceof Error ? error.message : String(error),
        issues: [
          {
            type: 'error',
            message: `Tests failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  /**
   * Run a command and capture output
   */
  private runCommand(
    cmd: string,
    args: string[],
    cwd: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        shell: true,
        timeout: this.config.stepTimeoutMs,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const output = stdout + stderr;
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(output || `Command exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Parse TypeScript compiler output
   */
  private parseTypeScriptOutput(output: string): PipelineIssue[] {
    const issues: PipelineIssue[] = [];
    const lines = output.split('\n');

    // TypeScript output format: file(line,col): error TS1234: message
    const tsErrorRegex =
      /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(\w+):\s*(.+)$/;

    for (const line of lines) {
      const match = line.match(tsErrorRegex);
      if (match) {
        issues.push({
          type: match[4] === 'error' ? 'error' : 'warning',
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          rule: match[5],
          message: match[6],
        });
      }
    }

    return issues;
  }

  /**
   * Parse ESLint JSON output
   */
  private parseEslintOutput(output: string): PipelineIssue[] {
    const issues: PipelineIssue[] = [];

    try {
      // Try to parse as JSON (ESLint --format json)
      const results = JSON.parse(output);
      if (Array.isArray(results)) {
        for (const result of results) {
          if (result.messages && Array.isArray(result.messages)) {
            for (const msg of result.messages) {
              issues.push({
                type: msg.severity === 2 ? 'error' : 'warning',
                file: result.filePath,
                line: msg.line,
                column: msg.column,
                rule: msg.ruleId,
                message: msg.message,
              });
            }
          }
        }
      }
    } catch {
      // Not JSON, try to parse text output
      const lines = output.split('\n');
      const eslintRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/;

      let currentFile = '';
      for (const line of lines) {
        // Check for file path line
        if (line.startsWith('/') || line.match(/^[A-Z]:\\/)) {
          currentFile = line.trim();
          continue;
        }

        const match = line.match(eslintRegex);
        if (match) {
          issues.push({
            type: match[3] === 'error' ? 'error' : 'warning',
            file: currentFile,
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
            message: match[4],
            rule: match[5],
          });
        }
      }
    }

    return issues;
  }

  /**
   * Collect source files for scanning
   */
  private async collectSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage'];
    const includeExts = ['.ts', '.tsx', '.js', '.jsx'];

    const walk = async (currentDir: string): Promise<void> => {
      if (files.length >= 200) return; // Limit for performance

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, {
          withFileTypes: true,
        });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (includeExts.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    await walk(dir);
    return files;
  }

  /**
   * Build the final pipeline result
   */
  private buildResult(
    steps: ValidationStepResult[],
    startTime: number,
    totalErrors: number,
    totalWarnings: number,
  ): PipelineResult {
    const stepsPassed = steps.filter((s) => s.passed).length;
    const success = totalErrors === 0;

    let summary = '';
    if (success) {
      summary = `✅ All ${steps.length} validation steps passed`;
    } else {
      const failedSteps = steps.filter((s) => !s.passed).map((s) => s.step);
      summary = `❌ Validation failed: ${failedSteps.join(', ')} (${totalErrors} errors, ${totalWarnings} warnings)`;
    }

    return {
      success,
      totalDurationMs: Date.now() - startTime,
      stepsRun: steps.length,
      stepsPassed,
      totalErrors,
      totalWarnings,
      steps,
      summary,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<PipelineConfig> {
    return this.config;
  }
}

/**
 * Create a ValidationPipeline with custom configuration
 */
export function createValidationPipeline(
  config?: Partial<PipelineConfig>,
): ValidationPipeline {
  return new ValidationPipeline(config);
}

/**
 * Quick validation for a set of files
 */
export async function quickValidate(
  files: string[],
  workingDirectory: string,
): Promise<PipelineResult> {
  const pipeline = new ValidationPipeline({
    files,
    enableTests: false,
    enableSecurity: true,
  });
  return pipeline.run(workingDirectory);
}
