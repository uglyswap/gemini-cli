/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DiffValidator
 * Validates changes made by agents to ensure code quality
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Validation result for a single file
 */
export interface FileValidationResult {
  filePath: string;
  valid: boolean;
  issues: ValidationIssue[];
  metrics: FileMetrics;
}

/**
 * Validation issue found in a file
 */
export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  rule?: string;
}

/**
 * Metrics for a validated file
 */
export interface FileMetrics {
  linesAdded: number;
  linesRemoved: number;
  complexity?: number;
  hasTodoComments: boolean;
  hasConsoleStatements: boolean;
  hasDebugCode: boolean;
}

/**
 * Overall validation result
 */
export interface DiffValidationResult {
  valid: boolean;
  filesValidated: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  fileResults: FileValidationResult[];
  summary: string;
}

/**
 * Configuration for the DiffValidator
 */
export interface DiffValidatorConfig {
  /** Maximum allowed complexity per function */
  maxComplexity: number;
  /** Allow console statements in production code */
  allowConsole: boolean;
  /** Allow TODO comments */
  allowTodos: boolean;
  /** Allow debug code (debugger statements) */
  allowDebugCode: boolean;
  /** File patterns to exclude from validation */
  excludePatterns: string[];
  /** Enable TypeScript type checking validation */
  validateTypes: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DiffValidatorConfig = {
  maxComplexity: 15,
  allowConsole: false,
  allowTodos: true,
  allowDebugCode: false,
  excludePatterns: ['*.test.ts', '*.spec.ts', '*.d.ts', 'node_modules/**'],
  validateTypes: true,
};

/**
 * DiffValidator class for validating code changes
 */
export class DiffValidator {
  private readonly config: DiffValidatorConfig;

  constructor(config: Partial<DiffValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate a set of modified files
   */
  async validateChanges(
    modifiedFiles: string[],
    workingDirectory: string,
  ): Promise<DiffValidationResult> {
    const fileResults: FileValidationResult[] = [];
    let totalIssues = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const filePath of modifiedFiles) {
      // Skip excluded files
      if (this.isExcluded(filePath)) {
        continue;
      }

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workingDirectory, filePath);

      // Skip non-existent files (might have been deleted)
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const result = await this.validateFile(fullPath);
      fileResults.push(result);

      totalIssues += result.issues.length;
      errorCount += result.issues.filter((i) => i.type === 'error').length;
      warningCount += result.issues.filter((i) => i.type === 'warning').length;
    }

    const valid = errorCount === 0;

    return {
      valid,
      filesValidated: fileResults.length,
      totalIssues,
      errorCount,
      warningCount,
      fileResults,
      summary: this.generateSummary(fileResults, errorCount, warningCount),
    };
  }

  /**
   * Validate a single file
   */
  async validateFile(filePath: string): Promise<FileValidationResult> {
    const issues: ValidationIssue[] = [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for console statements
    if (!this.config.allowConsole) {
      const consoleMatches = this.findPatterns(
        lines,
        /console\.(log|warn|error|info|debug)\s*\(/,
      );
      for (const match of consoleMatches) {
        issues.push({
          type: 'warning',
          message: 'Console statement found in production code',
          line: match.line,
          rule: 'no-console',
        });
      }
    }

    // Check for debug code
    if (!this.config.allowDebugCode) {
      const debuggerMatches = this.findPatterns(lines, /\bdebugger\b/);
      for (const match of debuggerMatches) {
        issues.push({
          type: 'error',
          message: 'Debugger statement found',
          line: match.line,
          rule: 'no-debugger',
        });
      }
    }

    // Check for TODO comments (info level if allowed)
    const todoMatches = this.findPatterns(lines, /\/\/\s*(TODO|FIXME|HACK):/i);
    for (const match of todoMatches) {
      issues.push({
        type: this.config.allowTodos ? 'info' : 'warning',
        message: 'TODO comment found',
        line: match.line,
        rule: 'no-todo',
      });
    }

    // Check for potential security issues
    const securityIssues = this.checkSecurityPatterns(lines);
    issues.push(...securityIssues);

    // Check for common code quality issues
    const qualityIssues = this.checkCodeQuality(lines, filePath);
    issues.push(...qualityIssues);

    // Calculate metrics
    const metrics: FileMetrics = {
      linesAdded: lines.length, // Simplified - full git diff would be better
      linesRemoved: 0,
      hasTodoComments: todoMatches.length > 0,
      hasConsoleStatements:
        this.findPatterns(lines, /console\.(log|warn|error|info|debug)\s*\(/)
          .length > 0,
      hasDebugCode: this.findPatterns(lines, /\bdebugger\b/).length > 0,
    };

    return {
      filePath,
      valid: issues.filter((i) => i.type === 'error').length === 0,
      issues,
      metrics,
    };
  }

  /**
   * Find patterns in code lines
   */
  private findPatterns(
    lines: string[],
    pattern: RegExp,
  ): Array<{ line: number; match: string }> {
    const results: Array<{ line: number; match: string }> = [];

    lines.forEach((line, index) => {
      const match = line.match(pattern);
      if (match) {
        results.push({
          line: index + 1,
          match: match[0],
        });
      }
    });

    return results;
  }

  /**
   * Check for potential security issues
   */
  private checkSecurityPatterns(lines: string[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for potential SQL injection
    const sqlPatterns = [
      /`.*\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
      /['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
    ];

    for (const pattern of sqlPatterns) {
      const matches = this.findPatterns(lines, pattern);
      for (const match of matches) {
        issues.push({
          type: 'error',
          message: 'Potential SQL injection vulnerability',
          line: match.line,
          rule: 'security/sql-injection',
        });
      }
    }

    // Check for hardcoded secrets
    const secretPatterns = [
      /(?:api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"][^'"]+['"]/i,
      /(?:AWS|AZURE|GCP)_(?:ACCESS|SECRET|API)_KEY\s*[:=]\s*['"][^'"]+['"]/i,
    ];

    for (const pattern of secretPatterns) {
      const matches = this.findPatterns(lines, pattern);
      for (const match of matches) {
        issues.push({
          type: 'error',
          message: 'Potential hardcoded secret or API key',
          line: match.line,
          rule: 'security/no-secrets',
        });
      }
    }

    // Check for eval usage
    const evalMatches = this.findPatterns(lines, /\beval\s*\(/);
    for (const match of evalMatches) {
      issues.push({
        type: 'error',
        message: 'Use of eval() detected - potential security risk',
        line: match.line,
        rule: 'security/no-eval',
      });
    }

    // Check for innerHTML usage
    const innerHtmlMatches = this.findPatterns(lines, /\.innerHTML\s*=/);
    for (const match of innerHtmlMatches) {
      issues.push({
        type: 'warning',
        message: 'innerHTML assignment detected - potential XSS risk',
        line: match.line,
        rule: 'security/no-innerhtml',
      });
    }

    return issues;
  }

  /**
   * Check for common code quality issues
   */
  private checkCodeQuality(
    lines: string[],
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for 'any' type in TypeScript files
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const anyMatches = this.findPatterns(lines, /:\s*any\b/);
      for (const match of anyMatches) {
        issues.push({
          type: 'warning',
          message: 'Use of "any" type reduces type safety',
          line: match.line,
          rule: 'typescript/no-explicit-any',
        });
      }
    }

    // Check for very long lines
    lines.forEach((line, index) => {
      if (line.length > 120) {
        issues.push({
          type: 'info',
          message: `Line exceeds 120 characters (${line.length})`,
          line: index + 1,
          rule: 'max-line-length',
        });
      }
    });

    // Check for empty catch blocks
    const emptyCatchPattern = /catch\s*\([^)]*\)\s*\{\s*\}/;
    const emptyCatchMatches = this.findPatterns(
      [lines.join('\n')],
      emptyCatchPattern,
    );
    if (emptyCatchMatches.length > 0) {
      issues.push({
        type: 'warning',
        message: 'Empty catch block swallows errors',
        rule: 'no-empty-catch',
      });
    }

    // Note: Magic number check skipped as it's too noisy
    // Could be enabled in strict mode in the future

    return issues;
  }

  /**
   * Check if a file should be excluded from validation
   */
  private isExcluded(filePath: string): boolean {
    const fileName = path.basename(filePath);

    for (const pattern of this.config.excludePatterns) {
      if (pattern.startsWith('*')) {
        const ext = pattern.slice(1);
        if (fileName.endsWith(ext)) return true;
      } else if (pattern.endsWith('/**')) {
        const dir = pattern.slice(0, -3);
        if (filePath.includes(dir)) return true;
      } else if (fileName === pattern || filePath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a summary of validation results
   */
  private generateSummary(
    results: FileValidationResult[],
    errorCount: number,
    warningCount: number,
  ): string {
    const validFiles = results.filter((r) => r.valid).length;
    const totalFiles = results.length;

    if (errorCount === 0 && warningCount === 0) {
      return `✅ All ${totalFiles} files passed validation`;
    }

    const parts: string[] = [];
    if (errorCount > 0) {
      parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
    }

    return `${validFiles}/${totalFiles} files valid. Found: ${parts.join(', ')}`;
  }
}

/**
 * Create a DiffValidator with custom configuration
 */
export function createDiffValidator(
  config?: Partial<DiffValidatorConfig>,
): DiffValidator {
  return new DiffValidator(config);
}
