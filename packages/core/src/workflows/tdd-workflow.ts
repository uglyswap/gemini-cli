/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TDDWorkflow
 *
 * Test-Driven Development workflow implementation:
 * 1. RED - Write failing tests first
 * 2. GREEN - Implement code to pass tests
 * 3. REFACTOR - Improve code while keeping tests green
 *
 * Supports:
 * - Automatic test generation from specifications
 * - Progressive implementation guided by test results
 * - Refactoring suggestions after tests pass
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * TDD Phase enum
 */
export enum TDDPhase {
  /** Write failing tests */
  RED = 'red',
  /** Implement code to pass tests */
  GREEN = 'green',
  /** Refactor while keeping tests green */
  REFACTOR = 'refactor',
  /** All phases complete */
  COMPLETE = 'complete',
}

/**
 * Test specification for generating tests
 */
export interface TestSpecification {
  /** Name of the test suite */
  suiteName: string;
  /** Description of what to test */
  description: string;
  /** Expected behaviors to test */
  behaviors: TestBehavior[];
  /** Target file to be tested */
  targetFile?: string;
  /** Test file path */
  testFile: string;
}

/**
 * Single behavior to test
 */
export interface TestBehavior {
  /** Behavior description */
  description: string;
  /** Input for the test */
  input?: unknown;
  /** Expected output */
  expectedOutput?: unknown;
  /** Should this test throw? */
  shouldThrow?: boolean;
  /** Expected error message pattern */
  errorPattern?: string;
}

/**
 * Test run result
 */
export interface TestRunResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Total tests */
  total: number;
  /** Passing tests */
  passing: number;
  /** Failing tests */
  failing: number;
  /** Skipped tests */
  skipped: number;
  /** Duration in ms */
  durationMs: number;
  /** Individual test results */
  tests: IndividualTestResult[];
  /** Raw output */
  output: string;
}

/**
 * Individual test result
 */
export interface IndividualTestResult {
  /** Test name */
  name: string;
  /** Pass/fail status */
  passed: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs?: number;
}

/**
 * TDD cycle result
 */
export interface TDDCycleResult {
  /** Current phase */
  phase: TDDPhase;
  /** Whether phase completed successfully */
  success: boolean;
  /** Test results for this phase */
  testResults?: TestRunResult;
  /** Generated/modified files */
  files: ModifiedFile[];
  /** Suggestions for next steps */
  suggestions: string[];
  /** Duration of this phase in ms */
  durationMs: number;
}

/**
 * Modified file tracking
 */
export interface ModifiedFile {
  /** File path */
  path: string;
  /** Type of modification */
  type: 'created' | 'modified' | 'deleted';
  /** Content (for created/modified) */
  content?: string;
}

/**
 * Complete TDD workflow result
 */
export interface TDDWorkflowResult {
  /** Overall success */
  success: boolean;
  /** Phases completed */
  phasesCompleted: TDDPhase[];
  /** Results for each cycle */
  cycles: TDDCycleResult[];
  /** Total iterations */
  totalIterations: number;
  /** Final test results */
  finalTestResults?: TestRunResult;
  /** All modified files */
  modifiedFiles: ModifiedFile[];
  /** Summary message */
  summary: string;
  /** Total duration in ms */
  totalDurationMs: number;
}

/**
 * TDD configuration
 */
export interface TDDConfig {
  /** Test command to run */
  testCommand: string;
  /** Test file pattern */
  testPattern: string;
  /** Maximum iterations per phase */
  maxIterationsPerPhase: number;
  /** Test framework */
  framework: 'jest' | 'vitest' | 'mocha' | 'auto';
  /** Working directory */
  workingDirectory: string;
  /** Enable refactor phase */
  enableRefactor: boolean;
  /** Timeout for tests in ms */
  testTimeoutMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TDDConfig = {
  testCommand: 'npm test',
  testPattern: '*.test.ts',
  maxIterationsPerPhase: 5,
  framework: 'auto',
  workingDirectory: process.cwd(),
  enableRefactor: true,
  testTimeoutMs: 60000,
};

/**
 * TDDWorkflow class for test-driven development
 */
export class TDDWorkflow {
  private readonly config: TDDConfig;
  private currentPhase: TDDPhase = TDDPhase.RED;

  constructor(config: Partial<TDDConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the complete TDD workflow
   */
  async run(
    spec: TestSpecification,
    implementCode: (
      phase: TDDPhase,
      testResults: TestRunResult | null,
      iteration: number,
    ) => Promise<ModifiedFile[]>,
  ): Promise<TDDWorkflowResult> {
    const startTime = Date.now();
    const cycles: TDDCycleResult[] = [];
    const allModifiedFiles: ModifiedFile[] = [];
    const phasesCompleted: TDDPhase[] = [];

    // PHASE 1: RED - Write failing tests
    this.currentPhase = TDDPhase.RED;
    const redResult = await this.executeRedPhase(spec, implementCode);
    cycles.push(redResult);
    allModifiedFiles.push(...redResult.files);

    if (!redResult.success) {
      return this.buildResult(
        false,
        phasesCompleted,
        cycles,
        allModifiedFiles,
        startTime,
        'Failed to create failing tests',
      );
    }
    phasesCompleted.push(TDDPhase.RED);

    // PHASE 2: GREEN - Implement to pass tests
    this.currentPhase = TDDPhase.GREEN;
    const greenResult = await this.executeGreenPhase(
      spec,
      implementCode,
      redResult.testResults!,
    );
    cycles.push(greenResult);
    allModifiedFiles.push(...greenResult.files);

    if (!greenResult.success) {
      return this.buildResult(
        false,
        phasesCompleted,
        cycles,
        allModifiedFiles,
        startTime,
        `Failed to make tests pass after ${this.config.maxIterationsPerPhase} iterations`,
      );
    }
    phasesCompleted.push(TDDPhase.GREEN);

    // PHASE 3: REFACTOR (optional)
    if (this.config.enableRefactor) {
      this.currentPhase = TDDPhase.REFACTOR;
      const refactorResult = await this.executeRefactorPhase(
        spec,
        implementCode,
        greenResult.testResults!,
      );
      cycles.push(refactorResult);
      allModifiedFiles.push(...refactorResult.files);

      if (!refactorResult.success) {
        return this.buildResult(
          false,
          phasesCompleted,
          cycles,
          allModifiedFiles,
          startTime,
          'Refactoring broke tests',
        );
      }
      phasesCompleted.push(TDDPhase.REFACTOR);
    }

    phasesCompleted.push(TDDPhase.COMPLETE);
    this.currentPhase = TDDPhase.COMPLETE;

    const finalTests =
      cycles[cycles.length - 1].testResults || greenResult.testResults;

    return this.buildResult(
      true,
      phasesCompleted,
      cycles,
      allModifiedFiles,
      startTime,
      `TDD complete: ${finalTests?.passing}/${finalTests?.total} tests passing`,
    );
  }

  /**
   * Execute RED phase - write failing tests
   */
  private async executeRedPhase(
    spec: TestSpecification,
    _implementCode: (
      phase: TDDPhase,
      testResults: TestRunResult | null,
      iteration: number,
    ) => Promise<ModifiedFile[]>,
  ): Promise<TDDCycleResult> {
    const startTime = Date.now();

    // Generate test file
    const testContent = this.generateTestFile(spec);
    const testFile: ModifiedFile = {
      path: spec.testFile,
      type: 'created',
      content: testContent,
    };

    // Write test file
    await this.writeFile(testFile);

    // Run tests - they should fail
    const testResults = await this.runTests(spec.testFile);

    // In RED phase, we expect tests to fail
    const success = testResults.failing > 0 || testResults.total > 0;

    return {
      phase: TDDPhase.RED,
      success,
      testResults,
      files: [testFile],
      suggestions: success
        ? ['Tests are failing as expected. Proceed to GREEN phase.']
        : ['No tests were created. Check test specification.'],
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Execute GREEN phase - implement code to pass tests
   */
  private async executeGreenPhase(
    spec: TestSpecification,
    implementCode: (
      phase: TDDPhase,
      testResults: TestRunResult | null,
      iteration: number,
    ) => Promise<ModifiedFile[]>,
    initialResults: TestRunResult,
  ): Promise<TDDCycleResult> {
    const startTime = Date.now();
    const allFiles: ModifiedFile[] = [];
    let currentResults = initialResults;

    for (let i = 1; i <= this.config.maxIterationsPerPhase; i++) {
      // Let the implementer write code
      const files = await implementCode(TDDPhase.GREEN, currentResults, i);
      allFiles.push(...files);

      // Write the files
      for (const file of files) {
        await this.writeFile(file);
      }

      // Run tests
      currentResults = await this.runTests(spec.testFile);

      // Check if all tests pass
      if (currentResults.passed) {
        return {
          phase: TDDPhase.GREEN,
          success: true,
          testResults: currentResults,
          files: allFiles,
          suggestions: [
            'All tests passing!',
            this.config.enableRefactor
              ? 'Proceed to REFACTOR phase.'
              : 'TDD cycle complete.',
          ],
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Max iterations reached
    return {
      phase: TDDPhase.GREEN,
      success: false,
      testResults: currentResults,
      files: allFiles,
      suggestions: [
        `Still ${currentResults.failing} failing tests after ${this.config.maxIterationsPerPhase} iterations`,
        'Consider simplifying the implementation or reviewing test expectations',
      ],
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Execute REFACTOR phase - improve code while keeping tests green
   */
  private async executeRefactorPhase(
    spec: TestSpecification,
    implementCode: (
      phase: TDDPhase,
      testResults: TestRunResult | null,
      iteration: number,
    ) => Promise<ModifiedFile[]>,
    greenResults: TestRunResult,
  ): Promise<TDDCycleResult> {
    const startTime = Date.now();
    const allFiles: ModifiedFile[] = [];

    // Let the implementer refactor
    const files = await implementCode(TDDPhase.REFACTOR, greenResults, 1);
    allFiles.push(...files);

    // Write refactored files
    for (const file of files) {
      await this.writeFile(file);
    }

    // Run tests to ensure they still pass
    const testResults = await this.runTests(spec.testFile);

    return {
      phase: TDDPhase.REFACTOR,
      success: testResults.passed,
      testResults,
      files: allFiles,
      suggestions: testResults.passed
        ? ['Refactoring complete. All tests still passing.']
        : ['Refactoring broke some tests. Reverting recommended.'],
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Generate a test file from specification
   */
  generateTestFile(spec: TestSpecification): string {
    const framework = this.detectFramework();
    const lines: string[] = [];

    // Imports based on framework
    if (framework === 'vitest') {
      lines.push(
        "import { describe, it, expect, beforeEach, afterEach } from 'vitest';",
      );
    } else if (framework === 'jest') {
      lines.push('// Jest globals are available');
    }

    // Import target if specified
    if (spec.targetFile) {
      const relativePath = this.getRelativeImport(
        spec.testFile,
        spec.targetFile,
      );
      lines.push(`import { /* TODO: import from */ } from '${relativePath}';`);
    }

    lines.push('');
    lines.push(`describe('${spec.suiteName}', () => {`);

    // Generate test cases
    for (const behavior of spec.behaviors) {
      lines.push(`  it('${behavior.description}', () => {`);

      if (behavior.shouldThrow) {
        lines.push(
          `    // Expect error: ${behavior.errorPattern || 'any error'}`,
        );
        lines.push('    expect(() => {');
        lines.push('      // TODO: Call function that should throw');
        lines.push('    }).toThrow();');
      } else if (behavior.expectedOutput !== undefined) {
        lines.push(`    // Input: ${JSON.stringify(behavior.input)}`);
        lines.push(
          `    // Expected: ${JSON.stringify(behavior.expectedOutput)}`,
        );
        lines.push('    const result = undefined; // TODO: Implement');
        lines.push(
          `    expect(result).toEqual(${JSON.stringify(behavior.expectedOutput)});`,
        );
      } else {
        lines.push('    // TODO: Implement test');
        lines.push('    expect(true).toBe(false); // Placeholder');
      }

      lines.push('  });');
      lines.push('');
    }

    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Run tests and parse results
   */
  async runTests(testFile?: string): Promise<TestRunResult> {
    const startTime = Date.now();

    try {
      const args = this.config.testCommand.split(' ');
      const cmd = args.shift()!;

      // Add test file filter if specified
      if (testFile) {
        args.push('--', testFile);
      }

      const output = await this.runCommand(cmd, args);
      return this.parseTestOutput(output, Date.now() - startTime);
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      return this.parseTestOutput(output, Date.now() - startTime);
    }
  }

  /**
   * Parse test output into structured results
   */
  private parseTestOutput(output: string, durationMs: number): TestRunResult {
    const tests: IndividualTestResult[] = [];
    let passing = 0;
    let failing = 0;
    let skipped = 0;

    // Parse Jest/Vitest style output
    const passMatch = output.match(/(\d+)\s+pass/i);
    const failMatch = output.match(/(\d+)\s+fail/i);
    const skipMatch = output.match(/(\d+)\s+skip/i);

    if (passMatch) passing = parseInt(passMatch[1], 10);
    if (failMatch) failing = parseInt(failMatch[1], 10);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);

    // Parse individual test results
    const testLines = output.split('\n');
    for (const line of testLines) {
      // Match: ✓ test name (duration)
      const passLine = line.match(/[✓✔]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
      if (passLine) {
        tests.push({
          name: passLine[1].trim(),
          passed: true,
          durationMs: passLine[2] ? parseInt(passLine[2], 10) : undefined,
        });
        continue;
      }

      // Match: ✕ test name or × test name
      const failLine = line.match(/[✕✗×]\s+(.+)/);
      if (failLine) {
        tests.push({
          name: failLine[1].trim(),
          passed: false,
        });
      }
    }

    const total = passing + failing + skipped;

    return {
      passed: failing === 0 && passing > 0,
      total,
      passing,
      failing,
      skipped,
      durationMs,
      tests,
      output,
    };
  }

  /**
   * Detect test framework from project
   */
  private detectFramework(): 'jest' | 'vitest' | 'mocha' {
    if (this.config.framework !== 'auto') {
      return this.config.framework;
    }

    const packagePath = path.join(this.config.workingDirectory, 'package.json');

    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps['vitest']) return 'vitest';
        if (deps['jest']) return 'jest';
        if (deps['mocha']) return 'mocha';
      } catch {
        // Ignore
      }
    }

    return 'jest'; // Default
  }

  /**
   * Get relative import path between two files
   */
  private getRelativeImport(from: string, to: string): string {
    const fromDir = path.dirname(from);
    let relative = path.relative(fromDir, to);

    // Remove extension
    relative = relative.replace(/\.[^.]+$/, '');

    // Ensure starts with ./
    if (!relative.startsWith('.')) {
      relative = './' + relative;
    }

    // Convert Windows separators
    relative = relative.replace(/\\/g, '/');

    return relative;
  }

  /**
   * Write a file to disk
   */
  private async writeFile(file: ModifiedFile): Promise<void> {
    if (file.type === 'deleted') {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return;
    }

    if (file.content !== undefined) {
      const dir = path.dirname(file.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(file.path, file.content);
    }
  }

  /**
   * Run a command and capture output
   */
  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: this.config.workingDirectory,
        shell: true,
        timeout: this.config.testTimeoutMs,
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

      proc.on('error', reject);
    });
  }

  /**
   * Build the final workflow result
   */
  private buildResult(
    success: boolean,
    phasesCompleted: TDDPhase[],
    cycles: TDDCycleResult[],
    modifiedFiles: ModifiedFile[],
    startTime: number,
    summary: string,
  ): TDDWorkflowResult {
    const finalCycle = cycles[cycles.length - 1];

    return {
      success,
      phasesCompleted,
      cycles,
      totalIterations: cycles.reduce(
        (sum, c) => sum + (c.testResults?.total || 0),
        0,
      ),
      finalTestResults: finalCycle?.testResults,
      modifiedFiles: this.deduplicateFiles(modifiedFiles),
      summary,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Deduplicate modified files (keep latest)
   */
  private deduplicateFiles(files: ModifiedFile[]): ModifiedFile[] {
    const fileMap = new Map<string, ModifiedFile>();
    for (const file of files) {
      fileMap.set(file.path, file);
    }
    return [...fileMap.values()];
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): TDDPhase {
    return this.currentPhase;
  }
}

/**
 * Create a TDDWorkflow with custom configuration
 */
export function createTDDWorkflow(config?: Partial<TDDConfig>): TDDWorkflow {
  return new TDDWorkflow(config);
}

/**
 * Create a test specification from natural language description
 */
export function createTestSpec(
  name: string,
  description: string,
  behaviors: string[],
  targetFile?: string,
  testFile?: string,
): TestSpecification {
  return {
    suiteName: name,
    description,
    behaviors: behaviors.map((b) => ({
      description: b,
    })),
    targetFile,
    testFile: testFile || `${name.toLowerCase().replace(/\s+/g, '-')}.test.ts`,
  };
}
