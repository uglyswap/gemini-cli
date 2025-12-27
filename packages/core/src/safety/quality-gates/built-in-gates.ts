/**
 * Built-in Quality Gates
 * Pre-configured gates for common quality checks
 */

import { QualityGate, GateContext, GateCheckResult } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a file exists in the project
 */
function fileExists(projectRoot: string, filename: string): boolean {
  return fs.existsSync(path.join(projectRoot, filename));
}

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
      const configFiles = ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js'];
      const hasConfig = configFiles.some(f => fileExists(context.projectRoot, f));
      
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
      const issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; file?: string; rule?: string }> = [];
      
      // Patterns that might indicate secrets
      const secretPatterns = [
        { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/gi, name: 'API Key' },
        { pattern: /secret[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/gi, name: 'Secret Key' },
        { pattern: /password\s*[:=]\s*['"][^'"]{6,}['"]/gi, name: 'Password' },
        { pattern: /private[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi, name: 'Private Key' },
        { pattern: /bearer\s+[a-zA-Z0-9_\-\.]+/gi, name: 'Bearer Token' },
        { pattern: /sk_live_[a-zA-Z0-9]+/g, name: 'Stripe Live Key' },
        { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g, name: 'PEM Private Key' },
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
        message: issues.length === 0 
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
      const hasJest = fileExists(context.projectRoot, 'jest.config.js') ||
                      fileExists(context.projectRoot, 'jest.config.ts');
      const hasVitest = fileExists(context.projectRoot, 'vitest.config.ts') ||
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
      const issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; file?: string; rule?: string }> = [];
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
        message: issues.length === 0
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
      const issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; file?: string; rule?: string; line?: number }> = [];
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
          const functionPattern = /^\s*(async\s+)?(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>)/gm;
          let match;
          let lastFunctionLine = 0;
          
          while ((match = functionPattern.exec(content)) !== null) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            
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
        passed: issues.filter(i => i.severity === 'error').length === 0,
        severity: issues.length > 0 ? 'warning' : 'info',
        message: issues.length === 0
          ? 'Code complexity within acceptable limits'
          : `Found ${issues.length} complexity issue(s)`,
        issues,
        durationMs: 0,
        skippable: true,
      };
    },
  },
];
