/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in Quality Gates
 * Pre-configured gates for common quality checks
 */

import type { QualityGate, GateContext, GateCheckResult } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Check if a file exists in the project
 */
function fileExists(projectRoot: string, filename: string): boolean {
  return fs.existsSync(path.join(projectRoot, filename));
}

/**
 * Unit test result patterns for parsing
 */
const TEST_RESULT_PATTERNS = {
  jest: /Tests:\s*(\d+)\s+passed.*?(\d+)\s+failed/i,
  vitest: /(\d+)\s+passed.*?(\d+)\s+failed/i,
  mocha: /(\d+)\s+passing.*?(\d+)\s+failing/i,
};

/**
 * Security vulnerability patterns for code scanning
 */
const SECURITY_PATTERNS = [
  // SQL Injection
  {
    pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE)/gi,
    name: 'SQL Injection',
    severity: 'error' as const,
  },
  {
    pattern: /\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE)/gi,
    name: 'SQL Concatenation',
    severity: 'error' as const,
  },
  // Command Injection
  {
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\([^)]*\$\{/gi,
    name: 'Command Injection',
    severity: 'error' as const,
  },
  {
    pattern: /(?:exec|spawn)\s*\([^)]*\+/gi,
    name: 'Command Concatenation',
    severity: 'warning' as const,
  },
  // XSS
  {
    pattern: /innerHTML\s*=\s*[^"'`]+\$/gi,
    name: 'innerHTML XSS',
    severity: 'error' as const,
  },
  {
    pattern: /dangerouslySetInnerHTML/gi,
    name: 'React dangerouslySetInnerHTML',
    severity: 'warning' as const,
  },
  // Eval
  { pattern: /\beval\s*\(/gi, name: 'Eval Usage', severity: 'error' as const },
  {
    pattern: /new\s+Function\s*\(/gi,
    name: 'Dynamic Function',
    severity: 'warning' as const,
  },
  // Path Traversal
  {
    pattern: /\.\.\/|\.\.\\|\.\.[/\\]/gi,
    name: 'Path Traversal',
    severity: 'warning' as const,
  },
  // Insecure Randomness
  {
    pattern: /Math\.random\s*\(\).*(?:token|key|secret|password|auth)/gi,
    name: 'Insecure Randomness',
    severity: 'warning' as const,
  },
  // Hardcoded Credentials in Code
  {
    pattern: /(?:password|secret|apikey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    name: 'Hardcoded Credential',
    severity: 'error' as const,
  },
];

/**
 * Performance anti-patterns
 */
const PERFORMANCE_PATTERNS = [
  // Synchronous operations in async context
  {
    pattern: /readFileSync|writeFileSync|execSync/gi,
    name: 'Sync I/O Operation',
    severity: 'warning' as const,
  },
  // Large array operations without chunking
  {
    pattern: /\.forEach\s*\([^)]+\)\s*;?\s*$/gm,
    name: 'forEach (consider map/filter)',
    severity: 'info' as const,
  },
  // Nested loops
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\([^)]+\)/gi,
    name: 'Nested Loops',
    severity: 'info' as const,
  },
  // No-cache fetch
  {
    pattern: /fetch\s*\([^)]+\)\s*(?!.*cache)/gi,
    name: 'Fetch without cache',
    severity: 'info' as const,
  },
  // Unbounded queries
  {
    pattern: /\.findMany\s*\(\s*\)|\\.find\s*\(\s*\{\s*\}\s*\)/gi,
    name: 'Unbounded Query',
    severity: 'warning' as const,
  },
  // Large inline styles
  {
    pattern: /style\s*=\s*\{\s*\{[^}]{100,}\}/gi,
    name: 'Large Inline Style',
    severity: 'info' as const,
  },
];

/**
 * Built-in quality gates
 */
export const BUILT_IN_GATES: QualityGate[] = [
  // TypeScript Check
  {
    id: 'typescript',
    name: 'TypeScript Type Check',
    description: 'Runs TypeScript compiler to check for type errors',
    timing: 'post',
    defaultSeverity: 'error',
    applicableDomains: ['frontend', 'backend', 'ai-ml'],
    checkType: 'typescript',
    skippable: false,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      // Check if tsconfig exists
      if (!fileExists(context.projectRoot, 'tsconfig.json')) {
        return {
          gateId: 'typescript',
          gateName: 'TypeScript Type Check',
          passed: true,
          severity: 'info',
          message: 'No tsconfig.json found, skipping TypeScript check',
          issues: [],
          durationMs: 0,
          skippable: false,
        };
      }

      // Defer to command execution
      return {
        gateId: 'typescript',
        gateName: 'TypeScript Type Check',
        passed: true,
        severity: 'info',
        message: 'TypeScript check delegated to command runner',
        issues: [],
        durationMs: 0,
        skippable: false,
      };
    },
    command: 'npx tsc --noEmit',
  },

  // ESLint Check
  {
    id: 'eslint',
    name: 'ESLint Code Quality',
    description: 'Runs ESLint to check for code quality issues',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: ['frontend', 'backend'],
    checkType: 'eslint',
    skippable: true,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      // Check if eslint config exists
      const configFiles = [
        '.eslintrc.js',
        '.eslintrc.json',
        '.eslintrc.yml',
        'eslint.config.js',
      ];
      const hasConfig = configFiles.some((f) =>
        fileExists(context.projectRoot, f),
      );

      if (!hasConfig) {
        return {
          gateId: 'eslint',
          gateName: 'ESLint Code Quality',
          passed: true,
          severity: 'info',
          message: 'No ESLint config found, skipping',
          issues: [],
          durationMs: 0,
          skippable: true,
        };
      }

      return {
        gateId: 'eslint',
        gateName: 'ESLint Code Quality',
        passed: true,
        severity: 'info',
        message: 'ESLint check delegated to command runner',
        issues: [],
        durationMs: 0,
        skippable: true,
      };
    },
    command: 'npx eslint . --max-warnings 0',
  },

  // Security Scan (using npm audit)
  {
    id: 'security-scan',
    name: 'Security Vulnerability Scan',
    description: 'Checks for known security vulnerabilities in dependencies',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: 'all',
    checkType: 'security-scan',
    skippable: true,
    command: 'npm audit --audit-level=high',
  },

  // Secrets Detection
  {
    id: 'secrets-detection',
    name: 'Secrets Detection',
    description: 'Scans for accidentally committed secrets and credentials',
    timing: 'pre',
    defaultSeverity: 'error',
    applicableDomains: 'all',
    checkType: 'secrets-detection',
    skippable: false,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      const issues: Array<{
        severity: 'error' | 'warning' | 'info';
        message: string;
        file?: string;
        rule?: string;
      }> = [];

      // Patterns that might indicate secrets
      const secretPatterns = [
        {
          pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/gi,
          name: 'API Key',
        },
        {
          pattern: /secret[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/gi,
          name: 'Secret Key',
        },
        { pattern: /password\s*[:=]\s*['"][^'"]{6,}['"]/gi, name: 'Password' },
        {
          pattern: /private[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi,
          name: 'Private Key',
        },
        { pattern: /bearer\s+[a-zA-Z0-9_\-.]+/gi, name: 'Bearer Token' },
        { pattern: /sk_live_[a-zA-Z0-9]+/g, name: 'Stripe Live Key' },
        {
          pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g,
          name: 'PEM Private Key',
        },
      ];

      for (const filePath of context.modifiedFiles) {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(context.projectRoot, filePath);

        // Skip non-existent files and common non-code files
        if (!fs.existsSync(fullPath)) continue;
        if (filePath.includes('node_modules')) continue;
        if (filePath.endsWith('.lock')) continue;
        if (filePath.endsWith('.min.js')) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          for (const { pattern, name } of secretPatterns) {
            if (pattern.test(content)) {
              issues.push({
                severity: 'error',
                message: `Potential ${name} detected`,
                file: filePath,
                rule: 'secrets-detection',
              });
            }
            // Reset regex lastIndex
            pattern.lastIndex = 0;
          }
        } catch {
          // Skip files that can't be read
        }
      }

      return {
        gateId: 'secrets-detection',
        gateName: 'Secrets Detection',
        passed: issues.length === 0,
        severity: issues.length > 0 ? 'error' : 'info',
        message:
          issues.length === 0
            ? 'No secrets detected'
            : `Found ${issues.length} potential secret(s)`,
        issues,
        durationMs: 0,
        skippable: false,
      };
    },
  },

  // Test Coverage
  {
    id: 'test-coverage',
    name: 'Test Coverage Check',
    description: 'Ensures test coverage meets minimum threshold',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: ['frontend', 'backend', 'testing'],
    checkType: 'test-coverage',
    skippable: true,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      // Check if test config exists
      const hasJest =
        fileExists(context.projectRoot, 'jest.config.js') ||
        fileExists(context.projectRoot, 'jest.config.ts');
      const hasVitest =
        fileExists(context.projectRoot, 'vitest.config.ts') ||
        fileExists(context.projectRoot, 'vitest.config.js');

      if (!hasJest && !hasVitest) {
        return {
          gateId: 'test-coverage',
          gateName: 'Test Coverage Check',
          passed: true,
          severity: 'info',
          message: 'No test configuration found, skipping coverage check',
          issues: [],
          durationMs: 0,
          skippable: true,
        };
      }

      return {
        gateId: 'test-coverage',
        gateName: 'Test Coverage Check',
        passed: true,
        severity: 'info',
        message: 'Test coverage check delegated to command runner',
        issues: [],
        durationMs: 0,
        skippable: true,
      };
    },
    command: 'npm test -- --coverage --passWithNoTests',
  },

  // File Size Check
  {
    id: 'file-size',
    name: 'File Size Check',
    description: 'Warns about unusually large files',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: 'all',
    checkType: 'bundle-analysis',
    skippable: true,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      const issues: Array<{
        severity: 'error' | 'warning' | 'info';
        message: string;
        file?: string;
        rule?: string;
      }> = [];
      const MAX_FILE_SIZE = 500 * 1024; // 500KB

      for (const filePath of context.modifiedFiles) {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(context.projectRoot, filePath);

        if (!fs.existsSync(fullPath)) continue;

        try {
          const stats = fs.statSync(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            issues.push({
              severity: 'warning',
              message: `File is unusually large: ${Math.round(stats.size / 1024)}KB`,
              file: filePath,
              rule: 'file-size',
            });
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }

      return {
        gateId: 'file-size',
        gateName: 'File Size Check',
        passed: issues.length === 0,
        severity: issues.length > 0 ? 'warning' : 'info',
        message:
          issues.length === 0
            ? 'All files within size limits'
            : `Found ${issues.length} large file(s)`,
        issues,
        durationMs: 0,
        skippable: true,
      };
    },
  },

  // Complexity Check
  {
    id: 'complexity',
    name: 'Code Complexity Check',
    description: 'Analyzes code complexity metrics',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: ['frontend', 'backend'],
    checkType: 'complexity-analysis',
    skippable: true,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      const issues: Array<{
        severity: 'error' | 'warning' | 'info';
        message: string;
        file?: string;
        rule?: string;
        line?: number;
      }> = [];
      const MAX_FUNCTION_LINES = 100;
      const MAX_FILE_LINES = 500;

      for (const filePath of context.modifiedFiles) {
        if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) continue;

        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(context.projectRoot, filePath);

        if (!fs.existsSync(fullPath)) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          // Check file length
          if (lines.length > MAX_FILE_LINES) {
            issues.push({
              severity: 'warning',
              message: `File has ${lines.length} lines (max recommended: ${MAX_FILE_LINES})`,
              file: filePath,
              rule: 'file-length',
            });
          }

          // Simple function length check (very basic)
          const functionPattern =
            /^\s*(async\s+)?(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>)/gm;
          let match;
          let lastFunctionLine = 0;

          while ((match = functionPattern.exec(content)) !== null) {
            const lineNumber = content
              .substring(0, match.index)
              .split('\n').length;

            if (lastFunctionLine > 0) {
              const functionLength = lineNumber - lastFunctionLine;
              if (functionLength > MAX_FUNCTION_LINES) {
                issues.push({
                  severity: 'warning',
                  message: `Function at line ${lastFunctionLine} is ${functionLength} lines long`,
                  file: filePath,
                  line: lastFunctionLine,
                  rule: 'function-length',
                });
              }
            }

            lastFunctionLine = lineNumber;
          }
        } catch {
          // Skip files that can't be read
        }
      }

      return {
        gateId: 'complexity',
        gateName: 'Code Complexity Check',
        passed: issues.filter((i) => i.severity === 'error').length === 0,
        severity: issues.length > 0 ? 'warning' : 'info',
        message:
          issues.length === 0
            ? 'Code complexity within acceptable limits'
            : `Found ${issues.length} complexity issue(s)`,
        issues,
        durationMs: 0,
        skippable: true,
      };
    },
  },

  // Unit Tests Gate
  {
    id: 'unit-tests',
    name: 'Unit Tests',
    description: 'Runs unit tests and parses results',
    timing: 'post',
    defaultSeverity: 'error',
    applicableDomains: ['frontend', 'backend', 'testing'],
    checkType: 'test-coverage',
    skippable: false,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      // Check if test config exists
      const hasJest =
        fileExists(context.projectRoot, 'jest.config.js') ||
        fileExists(context.projectRoot, 'jest.config.ts');
      const hasVitest =
        fileExists(context.projectRoot, 'vitest.config.ts') ||
        fileExists(context.projectRoot, 'vitest.config.js');
      const hasMocha =
        fileExists(context.projectRoot, '.mocharc.json') ||
        fileExists(context.projectRoot, '.mocharc.js');

      if (!hasJest && !hasVitest && !hasMocha) {
        return {
          gateId: 'unit-tests',
          gateName: 'Unit Tests',
          passed: true,
          severity: 'info',
          message: 'No test configuration found, skipping unit tests',
          issues: [],
          durationMs: 0,
          skippable: false,
        };
      }

      // Delegate to command runner - will parse output
      return {
        gateId: 'unit-tests',
        gateName: 'Unit Tests',
        passed: true,
        severity: 'info',
        message: 'Unit tests delegated to command runner',
        issues: [],
        durationMs: 0,
        skippable: false,
      };
    },
    command: 'npm test -- --passWithNoTests',
    parseOutput: (
      output: string,
    ): { passed: number; failed: number } | null => {
      // Try each pattern
      for (const [, pattern] of Object.entries(TEST_RESULT_PATTERNS)) {
        const match = pattern.exec(output);
        if (match) {
          return {
            passed: parseInt(match[1], 10),
            failed: parseInt(match[2], 10),
          };
        }
      }
      return null;
    },
  },

  // Advanced Security Scan
  {
    id: 'advanced-security',
    name: 'Advanced Security Scan',
    description:
      'Scans code for security vulnerabilities using pattern matching',
    timing: 'pre',
    defaultSeverity: 'error',
    applicableDomains: 'all',
    checkType: 'security-scan',
    skippable: false,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      const issues: Array<{
        severity: 'error' | 'warning' | 'info';
        message: string;
        file?: string;
        rule?: string;
        line?: number;
      }> = [];

      for (const filePath of context.modifiedFiles) {
        // Only scan code files
        if (!filePath.match(/\.(ts|tsx|js|jsx|py|rb|php|java)$/)) continue;

        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(context.projectRoot, filePath);

        if (!fs.existsSync(fullPath)) continue;
        if (filePath.includes('node_modules')) continue;
        if (filePath.includes('.test.') || filePath.includes('.spec.'))
          continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          for (const { pattern, name, severity } of SECURITY_PATTERNS) {
            // Reset pattern state
            pattern.lastIndex = 0;

            let match;
            while ((match = pattern.exec(content)) !== null) {
              // Find line number
              const beforeMatch = content.substring(0, match.index);
              const lineNumber = beforeMatch.split('\n').length;

              issues.push({
                severity,
                message: `${name} vulnerability detected: ${match[0].substring(0, 50)}...`,
                file: filePath,
                rule: `security/${name.toLowerCase().replace(/\s+/g, '-')}`,
                line: lineNumber,
              });
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      const errorCount = issues.filter((i) => i.severity === 'error').length;
      const warningCount = issues.filter(
        (i) => i.severity === 'warning',
      ).length;

      return {
        gateId: 'advanced-security',
        gateName: 'Advanced Security Scan',
        passed: errorCount === 0,
        severity:
          errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'info',
        message:
          issues.length === 0
            ? 'No security vulnerabilities detected'
            : `Found ${errorCount} error(s) and ${warningCount} warning(s)`,
        issues,
        durationMs: 0,
        skippable: false,
      };
    },
  },

  // Performance Audit
  {
    id: 'performance-audit',
    name: 'Performance Audit',
    description: 'Scans code for performance anti-patterns',
    timing: 'post',
    defaultSeverity: 'warning',
    applicableDomains: ['frontend', 'backend'],
    checkType: 'performance-audit',
    skippable: true,
    checkFn: async (context: GateContext): Promise<GateCheckResult> => {
      const issues: Array<{
        severity: 'error' | 'warning' | 'info';
        message: string;
        file?: string;
        rule?: string;
        line?: number;
      }> = [];

      for (const filePath of context.modifiedFiles) {
        // Only scan code files
        if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) continue;

        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(context.projectRoot, filePath);

        if (!fs.existsSync(fullPath)) continue;
        if (filePath.includes('node_modules')) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          for (const { pattern, name, severity } of PERFORMANCE_PATTERNS) {
            // Reset pattern state
            pattern.lastIndex = 0;

            let match;
            while ((match = pattern.exec(content)) !== null) {
              // Find line number
              const beforeMatch = content.substring(0, match.index);
              const lineNumber = beforeMatch.split('\n').length;

              issues.push({
                severity,
                message: `${name}: ${match[0].substring(0, 40)}`,
                file: filePath,
                rule: `performance/${name.toLowerCase().replace(/\s+/g, '-')}`,
                line: lineNumber,
              });
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      const warningCount = issues.filter(
        (i) => i.severity === 'warning',
      ).length;
      const infoCount = issues.filter((i) => i.severity === 'info').length;

      return {
        gateId: 'performance-audit',
        gateName: 'Performance Audit',
        passed: true, // Performance issues don't fail the gate, just warn
        severity:
          warningCount > 0 ? 'warning' : infoCount > 0 ? 'info' : 'info',
        message:
          issues.length === 0
            ? 'No performance anti-patterns detected'
            : `Found ${warningCount} warning(s) and ${infoCount} info item(s)`,
        issues,
        durationMs: 0,
        skippable: true,
      };
    },
  },
];
