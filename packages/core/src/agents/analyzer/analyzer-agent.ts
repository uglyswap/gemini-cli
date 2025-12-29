/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AnalyzerAgent - Pre-Generation Codebase Analysis
 *
 * Scans the existing codebase before code generation to:
 * 1. Detect conventions (naming, style, patterns)
 * 2. Identify frameworks and dependencies
 * 3. Parse existing tests for patterns
 * 4. Generate a Tech Context Document shared with other agents
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Detected coding conventions
 */
export interface CodeConventions {
  /** Naming style: camelCase, snake_case, PascalCase */
  namingStyle: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
  /** Import style: named, default, namespace */
  importStyle: 'named' | 'default' | 'namespace' | 'mixed';
  /** Indentation: tabs or spaces */
  indentation: 'tabs' | 'spaces';
  /** Indent size (2 or 4 typically) */
  indentSize: number;
  /** Quote style: single or double */
  quoteStyle: 'single' | 'double';
  /** Semicolon usage */
  semicolons: boolean;
  /** Trailing commas */
  trailingCommas: boolean;
  /** Max line length detected */
  maxLineLength: number;
}

/**
 * Detected framework information
 */
export interface FrameworkInfo {
  /** Framework name */
  name: string;
  /** Version if detected */
  version?: string;
  /** Category: frontend, backend, testing, etc. */
  category:
    | 'frontend'
    | 'backend'
    | 'testing'
    | 'database'
    | 'tooling'
    | 'other';
}

/**
 * Detected design patterns
 */
export interface PatternInfo {
  /** Pattern name */
  name: string;
  /** Files where pattern is used */
  files: string[];
  /** Confidence level 0-100 */
  confidence: number;
}

/**
 * Test framework information
 */
export interface TestInfo {
  /** Test framework name */
  framework: string;
  /** Test file patterns */
  patterns: string[];
  /** Number of test files found */
  testFileCount: number;
  /** Common test utilities */
  utilities: string[];
}

/**
 * Complete Tech Context Document
 */
export interface TechContextDocument {
  /** Project root analyzed */
  projectRoot: string;
  /** Detected language */
  language: 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'other';
  /** Coding conventions */
  conventions: CodeConventions;
  /** Frameworks detected */
  frameworks: FrameworkInfo[];
  /** Design patterns found */
  patterns: PatternInfo[];
  /** Test information */
  testing: TestInfo;
  /** Project structure summary */
  structure: {
    /** Source directories */
    srcDirs: string[];
    /** Test directories */
    testDirs: string[];
    /** Config files found */
    configFiles: string[];
  };
  /** Analysis timestamp */
  analyzedAt: Date;
  /** Analysis duration in ms */
  analysisDurationMs: number;
}

/**
 * AnalyzerAgent configuration
 */
export interface AnalyzerConfig {
  /** Max files to analyze */
  maxFiles: number;
  /** Max file size to read (bytes) */
  maxFileSize: number;
  /** Directories to exclude */
  excludeDirs: string[];
  /** File extensions to analyze */
  includeExtensions: string[];
}

/**
 * Default analyzer configuration
 */
const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  maxFiles: 500,
  maxFileSize: 100 * 1024, // 100KB
  excludeDirs: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '__pycache__',
    'target',
    'vendor',
  ],
  includeExtensions: [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.rs',
    '.go',
    '.json',
  ],
};

/**
 * AnalyzerAgent class for pre-generation codebase analysis
 */
export class AnalyzerAgent {
  private readonly config: AnalyzerConfig;
  private cachedContext: TechContextDocument | null = null;

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
  }

  /**
   * Analyze the codebase and generate a Tech Context Document
   */
  async analyze(projectRoot: string): Promise<TechContextDocument> {
    const startTime = Date.now();

    // Check cache
    if (
      this.cachedContext &&
      this.cachedContext.projectRoot === projectRoot &&
      Date.now() - this.cachedContext.analyzedAt.getTime() < 5 * 60 * 1000
    ) {
      return this.cachedContext;
    }

    // Collect files
    const files = await this.collectFiles(projectRoot);

    // Detect language
    const language = this.detectLanguage(files);

    // Analyze conventions
    const conventions = await this.analyzeConventions(files);

    // Detect frameworks
    const frameworks = await this.detectFrameworks(projectRoot, files);

    // Find patterns
    const patterns = await this.findPatterns(files);

    // Analyze tests
    const testing = await this.analyzeTests(projectRoot, files);

    // Get project structure
    const structure = this.analyzeStructure(projectRoot, files);

    const context: TechContextDocument = {
      projectRoot,
      language,
      conventions,
      frameworks,
      patterns,
      testing,
      structure,
      analyzedAt: new Date(),
      analysisDurationMs: Date.now() - startTime,
    };

    this.cachedContext = context;
    return context;
  }

  /**
   * Collect files for analysis
   */
  private async collectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      if (files.length >= this.config.maxFiles) return;

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, {
          withFileTypes: true,
        });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= this.config.maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!this.config.excludeDirs.includes(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (this.config.includeExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    await walk(dir);
    return files;
  }

  /**
   * Detect primary language
   */
  private detectLanguage(files: string[]): TechContextDocument['language'] {
    const counts: Record<string, number> = {
      typescript: 0,
      javascript: 0,
      python: 0,
      rust: 0,
      go: 0,
    };

    for (const file of files) {
      const ext = path.extname(file);
      if (ext === '.ts' || ext === '.tsx') counts['typescript']++;
      else if (ext === '.js' || ext === '.jsx') counts['javascript']++;
      else if (ext === '.py') counts['python']++;
      else if (ext === '.rs') counts['rust']++;
      else if (ext === '.go') counts['go']++;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] === 0) return 'other';
    return sorted[0][0] as TechContextDocument['language'];
  }

  /**
   * Analyze coding conventions from source files
   */
  private async analyzeConventions(files: string[]): Promise<CodeConventions> {
    const stats = {
      camelCase: 0,
      snake_case: 0,
      PascalCase: 0,
      namedImports: 0,
      defaultImports: 0,
      tabs: 0,
      spaces: 0,
      indent2: 0,
      indent4: 0,
      singleQuotes: 0,
      doubleQuotes: 0,
      withSemicolons: 0,
      withoutSemicolons: 0,
      trailingCommas: 0,
      noTrailingCommas: 0,
      lineLengths: [] as number[],
    };

    const sampleFiles = files.slice(0, 50); // Sample for performance

    for (const file of sampleFiles) {
      try {
        const stat = await fs.promises.stat(file);
        if (stat.size > this.config.maxFileSize) continue;

        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          // Track line lengths
          if (line.trim().length > 0) {
            stats.lineLengths.push(line.length);
          }

          // Detect indentation
          const indentMatch = line.match(/^(\s+)/);
          if (indentMatch) {
            if (indentMatch[1].includes('\t')) {
              stats.tabs++;
            } else {
              stats.spaces++;
              const spaceCount = indentMatch[1].length;
              if (spaceCount % 4 === 0) stats.indent4++;
              else if (spaceCount % 2 === 0) stats.indent2++;
            }
          }

          // Detect quotes
          if (line.includes("'")) stats.singleQuotes++;
          if (line.includes('"')) stats.doubleQuotes++;

          // Detect semicolons
          if (line.trim().endsWith(';')) stats.withSemicolons++;
          else if (line.trim().length > 0) stats.withoutSemicolons++;

          // Detect trailing commas
          if (line.trim().endsWith(',')) stats.trailingCommas++;

          // Detect imports
          if (line.includes('import {')) stats.namedImports++;
          if (line.match(/import \w+ from/)) stats.defaultImports++;

          // Detect naming conventions (function/variable names)
          const funcMatch = line.match(
            /(?:function|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
          );
          if (funcMatch) {
            const name = funcMatch[1];
            if (name.includes('_')) stats.snake_case++;
            else if (name[0] === name[0].toUpperCase()) stats.PascalCase++;
            else stats.camelCase++;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Calculate max line length (95th percentile)
    stats.lineLengths.sort((a, b) => a - b);
    const p95Index = Math.floor(stats.lineLengths.length * 0.95);
    const maxLineLength = stats.lineLengths[p95Index] || 80;

    return {
      namingStyle:
        stats.camelCase > stats.snake_case && stats.camelCase > stats.PascalCase
          ? 'camelCase'
          : stats.snake_case > stats.PascalCase
            ? 'snake_case'
            : stats.PascalCase > 0
              ? 'PascalCase'
              : 'mixed',
      importStyle:
        stats.namedImports > stats.defaultImports ? 'named' : 'default',
      indentation: stats.tabs > stats.spaces ? 'tabs' : 'spaces',
      indentSize: stats.indent4 > stats.indent2 ? 4 : 2,
      quoteStyle: stats.singleQuotes > stats.doubleQuotes ? 'single' : 'double',
      semicolons: stats.withSemicolons > stats.withoutSemicolons,
      trailingCommas: stats.trailingCommas > stats.noTrailingCommas,
      maxLineLength,
    };
  }

  /**
   * Detect frameworks from package.json, cargo.toml, etc.
   */
  private async detectFrameworks(
    projectRoot: string,
    _files: string[],
  ): Promise<FrameworkInfo[]> {
    const frameworks: FrameworkInfo[] = [];

    // Check package.json
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // Frontend frameworks
        if (allDeps['react']) {
          frameworks.push({
            name: 'react',
            version: allDeps['react'],
            category: 'frontend',
          });
        }
        if (allDeps['next']) {
          frameworks.push({
            name: 'next',
            version: allDeps['next'],
            category: 'frontend',
          });
        }
        if (allDeps['vue']) {
          frameworks.push({
            name: 'vue',
            version: allDeps['vue'],
            category: 'frontend',
          });
        }
        if (allDeps['svelte']) {
          frameworks.push({
            name: 'svelte',
            version: allDeps['svelte'],
            category: 'frontend',
          });
        }
        if (allDeps['tailwindcss']) {
          frameworks.push({
            name: 'tailwind',
            version: allDeps['tailwindcss'],
            category: 'frontend',
          });
        }

        // Backend frameworks
        if (allDeps['express']) {
          frameworks.push({
            name: 'express',
            version: allDeps['express'],
            category: 'backend',
          });
        }
        if (allDeps['fastify']) {
          frameworks.push({
            name: 'fastify',
            version: allDeps['fastify'],
            category: 'backend',
          });
        }
        if (allDeps['hono']) {
          frameworks.push({
            name: 'hono',
            version: allDeps['hono'],
            category: 'backend',
          });
        }

        // Testing frameworks
        if (allDeps['jest']) {
          frameworks.push({
            name: 'jest',
            version: allDeps['jest'],
            category: 'testing',
          });
        }
        if (allDeps['vitest']) {
          frameworks.push({
            name: 'vitest',
            version: allDeps['vitest'],
            category: 'testing',
          });
        }
        if (allDeps['playwright']) {
          frameworks.push({
            name: 'playwright',
            version: allDeps['playwright'],
            category: 'testing',
          });
        }

        // Database
        if (allDeps['prisma'] || allDeps['@prisma/client']) {
          frameworks.push({
            name: 'prisma',
            version: allDeps['prisma'] || allDeps['@prisma/client'],
            category: 'database',
          });
        }
        if (allDeps['drizzle-orm']) {
          frameworks.push({
            name: 'drizzle',
            version: allDeps['drizzle-orm'],
            category: 'database',
          });
        }
        if (allDeps['@supabase/supabase-js']) {
          frameworks.push({
            name: 'supabase',
            version: allDeps['@supabase/supabase-js'],
            category: 'database',
          });
        }

        // Tooling
        if (allDeps['typescript']) {
          frameworks.push({
            name: 'typescript',
            version: allDeps['typescript'],
            category: 'tooling',
          });
        }
        if (allDeps['eslint']) {
          frameworks.push({
            name: 'eslint',
            version: allDeps['eslint'],
            category: 'tooling',
          });
        }
        if (allDeps['prettier']) {
          frameworks.push({
            name: 'prettier',
            version: allDeps['prettier'],
            category: 'tooling',
          });
        }
      } catch {
        // Ignore parse errors
      }
    }

    return frameworks;
  }

  /**
   * Find design patterns in the codebase
   */
  private async findPatterns(files: string[]): Promise<PatternInfo[]> {
    const patterns: PatternInfo[] = [];
    const patternFiles: Record<string, string[]> = {
      factory: [],
      repository: [],
      singleton: [],
      observer: [],
      decorator: [],
      strategy: [],
      adapter: [],
      facade: [],
    };

    const sampleFiles = files.slice(0, 100);

    for (const file of sampleFiles) {
      try {
        const stat = await fs.promises.stat(file);
        if (stat.size > this.config.maxFileSize) continue;

        const content = await fs.promises.readFile(file, 'utf-8');
        const fileName = path.basename(file).toLowerCase();

        // Factory pattern
        if (
          content.includes('Factory') ||
          content.includes('create') ||
          fileName.includes('factory')
        ) {
          patternFiles['factory'].push(file);
        }

        // Repository pattern
        if (content.includes('Repository') || fileName.includes('repository')) {
          patternFiles['repository'].push(file);
        }

        // Singleton pattern
        if (
          content.includes('getInstance') ||
          content.includes('private static instance')
        ) {
          patternFiles['singleton'].push(file);
        }

        // Observer pattern
        if (
          content.includes('subscribe') ||
          content.includes('addEventListener') ||
          content.includes('EventEmitter')
        ) {
          patternFiles['observer'].push(file);
        }

        // Decorator pattern
        if (content.match(/@\w+\(/)) {
          patternFiles['decorator'].push(file);
        }

        // Strategy pattern
        if (content.includes('Strategy') || fileName.includes('strategy')) {
          patternFiles['strategy'].push(file);
        }

        // Adapter pattern
        if (content.includes('Adapter') || fileName.includes('adapter')) {
          patternFiles['adapter'].push(file);
        }

        // Facade pattern
        if (content.includes('Facade') || fileName.includes('facade')) {
          patternFiles['facade'].push(file);
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Convert to PatternInfo
    for (const [name, files] of Object.entries(patternFiles)) {
      if (files.length > 0) {
        patterns.push({
          name,
          files: files.slice(0, 5), // Limit to 5 examples
          confidence: Math.min(100, files.length * 20),
        });
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze test structure and patterns
   */
  private async analyzeTests(
    projectRoot: string,
    files: string[],
  ): Promise<TestInfo> {
    const testFiles = files.filter(
      (f) =>
        f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'),
    );

    // Detect test framework
    let framework = 'unknown';
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps['vitest']) framework = 'vitest';
        else if (allDeps['jest']) framework = 'jest';
        else if (allDeps['mocha']) framework = 'mocha';
        else if (allDeps['playwright']) framework = 'playwright';
      } catch {
        // Ignore
      }
    }

    // Detect test patterns
    const patterns: string[] = [];
    if (testFiles.some((f) => f.includes('.test.'))) patterns.push('*.test.*');
    if (testFiles.some((f) => f.includes('.spec.'))) patterns.push('*.spec.*');
    if (testFiles.some((f) => f.includes('__tests__')))
      patterns.push('__tests__/**');

    // Find common utilities
    const utilities: string[] = [];
    for (const file of testFiles.slice(0, 10)) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        if (content.includes('render('))
          utilities.push('react-testing-library');
        if (content.includes('screen.')) utilities.push('screen-queries');
        if (content.includes('userEvent')) utilities.push('user-event');
        if (content.includes('mock')) utilities.push('mocking');
        if (content.includes('fixture')) utilities.push('fixtures');
      } catch {
        // Ignore
      }
    }

    return {
      framework,
      patterns,
      testFileCount: testFiles.length,
      utilities: [...new Set(utilities)],
    };
  }

  /**
   * Analyze project structure
   */
  private analyzeStructure(
    projectRoot: string,
    files: string[],
  ): TechContextDocument['structure'] {
    const srcDirs = new Set<string>();
    const testDirs = new Set<string>();
    const configFiles: string[] = [];

    for (const file of files) {
      const relativePath = path.relative(projectRoot, file);
      const parts = relativePath.split(path.sep);

      // Detect source directories
      if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app') {
        srcDirs.add(parts[0]);
      }

      // Detect test directories
      if (
        parts[0] === 'test' ||
        parts[0] === 'tests' ||
        parts[0] === '__tests__'
      ) {
        testDirs.add(parts[0]);
      }

      // Detect config files
      const fileName = path.basename(file);
      if (
        fileName.startsWith('.') ||
        fileName.endsWith('.config.js') ||
        fileName.endsWith('.config.ts') ||
        fileName.endsWith('.json')
      ) {
        if (parts.length === 1) {
          configFiles.push(fileName);
        }
      }
    }

    // Check for common config files
    const commonConfigs = [
      'tsconfig.json',
      'package.json',
      '.eslintrc.js',
      'eslint.config.js',
      'prettier.config.js',
      '.prettierrc',
      'jest.config.js',
      'vitest.config.ts',
      'tailwind.config.js',
      'next.config.js',
    ];

    for (const config of commonConfigs) {
      if (
        fs.existsSync(path.join(projectRoot, config)) &&
        !configFiles.includes(config)
      ) {
        configFiles.push(config);
      }
    }

    return {
      srcDirs: [...srcDirs],
      testDirs: [...testDirs],
      configFiles: configFiles.slice(0, 20),
    };
  }

  /**
   * Get cached context if available
   */
  getCachedContext(): TechContextDocument | null {
    return this.cachedContext;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cachedContext = null;
  }

  /**
   * Generate a summary string for agent prompts
   */
  generateContextSummary(context: TechContextDocument): string {
    const frameworkList = context.frameworks
      .map((f) => `${f.name}${f.version ? `@${f.version}` : ''}`)
      .join(', ');

    const patternList = context.patterns
      .filter((p) => p.confidence >= 50)
      .map((p) => p.name)
      .join(', ');

    return `
## Project Tech Context

**Language**: ${context.language}
**Frameworks**: ${frameworkList || 'None detected'}
**Design Patterns**: ${patternList || 'None detected'}
**Test Framework**: ${context.testing.framework}
**Test Count**: ${context.testing.testFileCount} test files

### Coding Conventions
- Naming: ${context.conventions.namingStyle}
- Indentation: ${context.conventions.indentation} (${context.conventions.indentSize})
- Quotes: ${context.conventions.quoteStyle}
- Semicolons: ${context.conventions.semicolons ? 'required' : 'omitted'}
- Max line length: ${context.conventions.maxLineLength}

### Project Structure
- Source: ${context.structure.srcDirs.join(', ') || 'root'}
- Tests: ${context.structure.testDirs.join(', ') || 'inline'}
- Config: ${context.structure.configFiles.slice(0, 5).join(', ')}
`.trim();
  }
}

/**
 * Create an AnalyzerAgent with custom configuration
 */
export function createAnalyzerAgent(
  config?: Partial<AnalyzerConfig>,
): AnalyzerAgent {
  return new AnalyzerAgent(config);
}
