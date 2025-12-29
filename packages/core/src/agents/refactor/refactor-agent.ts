/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RefactorAgent
 *
 * Post-review optimization agent that:
 * 1. Analyzes code for improvement opportunities
 * 2. Suggests refactoring patterns
 * 3. Identifies code smells
 * 4. Proposes performance optimizations
 * 5. Ensures consistency with project conventions
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Refactoring opportunity types
 */
export type RefactorType =
  | 'extract_function'
  | 'extract_variable'
  | 'inline_function'
  | 'rename'
  | 'move'
  | 'simplify_conditional'
  | 'remove_duplication'
  | 'convert_loop'
  | 'improve_types'
  | 'optimize_performance'
  | 'reduce_complexity'
  | 'improve_readability';

/**
 * Priority levels for refactoring
 */
export type RefactorPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'optional';

/**
 * Code smell types
 */
export type CodeSmell =
  | 'long_function'
  | 'long_parameter_list'
  | 'duplicate_code'
  | 'dead_code'
  | 'magic_numbers'
  | 'complex_conditional'
  | 'deep_nesting'
  | 'god_class'
  | 'feature_envy'
  | 'primitive_obsession'
  | 'data_clump'
  | 'any_type_abuse'
  | 'callback_hell';

/**
 * Refactoring suggestion
 */
export interface RefactorSuggestion {
  /** Unique ID */
  id: string;
  /** Type of refactoring */
  type: RefactorType;
  /** Priority level */
  priority: RefactorPriority;
  /** File affected */
  file: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Description of the refactoring */
  description: string;
  /** Detailed explanation */
  explanation: string;
  /** Code smells addressed */
  addressesSmells: CodeSmell[];
  /** Estimated effort (1-5) */
  effort: number;
  /** Risk level (1-5) */
  risk: number;
  /** Suggested new code (if available) */
  suggestedCode?: string;
  /** Whether this can be auto-applied */
  autoApplicable: boolean;
}

/**
 * Code metrics for analysis
 */
export interface CodeMetrics {
  /** Lines of code */
  loc: number;
  /** Cyclomatic complexity */
  cyclomaticComplexity: number;
  /** Maximum nesting depth */
  maxNestingDepth: number;
  /** Number of functions */
  functionCount: number;
  /** Average function length */
  avgFunctionLength: number;
  /** Number of parameters (max) */
  maxParameters: number;
  /** Number of any types */
  anyTypeCount: number;
  /** Number of TODO comments */
  todoCount: number;
  /** Duplicate code blocks */
  duplicateBlocks: number;
}

/**
 * Analysis result for a file
 */
export interface FileAnalysisResult {
  /** File path */
  file: string;
  /** Code metrics */
  metrics: CodeMetrics;
  /** Detected code smells */
  smells: DetectedSmell[];
  /** Refactoring suggestions */
  suggestions: RefactorSuggestion[];
  /** Overall health score (0-100) */
  healthScore: number;
}

/**
 * Detected code smell
 */
export interface DetectedSmell {
  /** Smell type */
  type: CodeSmell;
  /** Location */
  line: number;
  /** Description */
  description: string;
  /** Severity (1-5) */
  severity: number;
}

/**
 * Complete analysis report
 */
export interface RefactorReport {
  /** Files analyzed */
  filesAnalyzed: number;
  /** Total suggestions */
  totalSuggestions: number;
  /** Suggestions by priority */
  byPriority: Record<RefactorPriority, number>;
  /** Total smells detected */
  totalSmells: number;
  /** Average health score */
  averageHealthScore: number;
  /** File results */
  files: FileAnalysisResult[];
  /** Top suggestions across all files */
  topSuggestions: RefactorSuggestion[];
  /** Analysis duration in ms */
  durationMs: number;
}

/**
 * RefactorAgent configuration
 */
export interface RefactorConfig {
  /** Maximum function length before flagging */
  maxFunctionLength: number;
  /** Maximum cyclomatic complexity */
  maxComplexity: number;
  /** Maximum nesting depth */
  maxNestingDepth: number;
  /** Maximum parameters */
  maxParameters: number;
  /** Minimum duplicate lines to flag */
  minDuplicateLines: number;
  /** Files to exclude */
  excludePatterns: string[];
  /** Maximum files to analyze */
  maxFiles: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RefactorConfig = {
  maxFunctionLength: 50,
  maxComplexity: 10,
  maxNestingDepth: 4,
  maxParameters: 5,
  minDuplicateLines: 5,
  excludePatterns: [
    'node_modules/**',
    'dist/**',
    'build/**',
    '*.test.ts',
    '*.spec.ts',
    '*.d.ts',
  ],
  maxFiles: 100,
};

/**
 * RefactorAgent class for code optimization suggestions
 */
export class RefactorAgent {
  private readonly config: RefactorConfig;
  private suggestionCounter = 0;

  constructor(config: Partial<RefactorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze multiple files and generate refactoring report
   */
  async analyzeFiles(files: string[]): Promise<RefactorReport> {
    const startTime = Date.now();
    const results: FileAnalysisResult[] = [];

    // Filter and limit files
    const filteredFiles = files
      .filter((f) => !this.isExcluded(f))
      .slice(0, this.config.maxFiles);

    for (const file of filteredFiles) {
      const result = await this.analyzeFile(file);
      if (result) {
        results.push(result);
      }
    }

    // Aggregate statistics
    const byPriority: Record<RefactorPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      optional: 0,
    };

    let totalSuggestions = 0;
    let totalSmells = 0;
    let totalHealthScore = 0;

    for (const result of results) {
      totalSmells += result.smells.length;
      totalHealthScore += result.healthScore;

      for (const suggestion of result.suggestions) {
        totalSuggestions++;
        byPriority[suggestion.priority]++;
      }
    }

    // Get top suggestions across all files
    const allSuggestions = results.flatMap((r) => r.suggestions);
    const topSuggestions = allSuggestions
      .sort((a, b) => {
        const priorityOrder: Record<RefactorPriority, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
          optional: 4,
        };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, 10);

    return {
      filesAnalyzed: results.length,
      totalSuggestions,
      byPriority,
      totalSmells,
      averageHealthScore:
        results.length > 0 ? totalHealthScore / results.length : 100,
      files: results,
      topSuggestions,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Analyze a single file
   */
  async analyzeFile(filePath: string): Promise<FileAnalysisResult | null> {
    if (!fs.existsSync(filePath)) return null;

    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const lines = content.split('\n');
    const metrics = this.calculateMetrics(content, lines);
    const smells = this.detectSmells(content, lines, metrics);
    const suggestions = this.generateSuggestions(
      filePath,
      content,
      lines,
      metrics,
      smells,
    );
    const healthScore = this.calculateHealthScore(metrics, smells);

    return {
      file: filePath,
      metrics,
      smells,
      suggestions,
      healthScore,
    };
  }

  /**
   * Calculate code metrics
   */
  private calculateMetrics(content: string, lines: string[]): CodeMetrics {
    const loc = lines.filter((l) => l.trim().length > 0).length;

    // Count functions
    const functionMatches = content.match(
      /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?\w+\s*\([^)]*\)\s*{)/g,
    );
    const functionCount = functionMatches?.length || 0;

    // Cyclomatic complexity (simplified)
    const complexityKeywords = [
      'if',
      'else',
      'for',
      'while',
      'case',
      '&&',
      '||',
      '\\?',
    ];
    let complexity = 1;
    for (const keyword of complexityKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = content.match(regex);
      complexity += matches?.length || 0;
    }

    // Max nesting depth
    let maxNesting = 0;
    let currentNesting = 0;
    for (const line of lines) {
      currentNesting += (line.match(/{/g) || []).length;
      currentNesting -= (line.match(/}/g) || []).length;
      maxNesting = Math.max(maxNesting, currentNesting);
    }

    // Max parameters
    const paramMatches = content.match(/\([^)]+\)/g) || [];
    let maxParams = 0;
    for (const match of paramMatches) {
      const params = match.split(',').length;
      maxParams = Math.max(maxParams, params);
    }

    // Any type count
    const anyMatches = content.match(/:\s*any\b/g);
    const anyTypeCount = anyMatches?.length || 0;

    // TODO count
    const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK)/gi);
    const todoCount = todoMatches?.length || 0;

    return {
      loc,
      cyclomaticComplexity: complexity,
      maxNestingDepth: maxNesting,
      functionCount,
      avgFunctionLength: functionCount > 0 ? loc / functionCount : loc,
      maxParameters: maxParams,
      anyTypeCount,
      todoCount,
      duplicateBlocks: 0, // Simplified - full implementation would compare blocks
    };
  }

  /**
   * Detect code smells
   */
  private detectSmells(
    content: string,
    lines: string[],
    metrics: CodeMetrics,
  ): DetectedSmell[] {
    const smells: DetectedSmell[] = [];

    // Long function detection
    if (metrics.avgFunctionLength > this.config.maxFunctionLength) {
      smells.push({
        type: 'long_function',
        line: 1,
        description: `Average function length (${Math.round(metrics.avgFunctionLength)} lines) exceeds threshold (${this.config.maxFunctionLength})`,
        severity: 3,
      });
    }

    // High complexity
    if (metrics.cyclomaticComplexity > this.config.maxComplexity) {
      smells.push({
        type: 'complex_conditional',
        line: 1,
        description: `Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds threshold (${this.config.maxComplexity})`,
        severity: 4,
      });
    }

    // Deep nesting
    if (metrics.maxNestingDepth > this.config.maxNestingDepth) {
      smells.push({
        type: 'deep_nesting',
        line: 1,
        description: `Max nesting depth (${metrics.maxNestingDepth}) exceeds threshold (${this.config.maxNestingDepth})`,
        severity: 3,
      });
    }

    // Long parameter list
    if (metrics.maxParameters > this.config.maxParameters) {
      smells.push({
        type: 'long_parameter_list',
        line: 1,
        description: `Max parameters (${metrics.maxParameters}) exceeds threshold (${this.config.maxParameters})`,
        severity: 2,
      });
    }

    // Any type abuse
    if (metrics.anyTypeCount > 3) {
      smells.push({
        type: 'any_type_abuse',
        line: 1,
        description: `Found ${metrics.anyTypeCount} uses of 'any' type`,
        severity: 3,
      });
    }

    // Magic numbers detection
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip imports, consts declarations, and array indices
      if (
        line.includes('import') ||
        line.includes('const') ||
        line.includes('[')
      ) {
        continue;
      }
      const magicNumbers = line.match(/\b(?!0|1|2)\d{2,}\b/g);
      if (magicNumbers && magicNumbers.length > 0) {
        smells.push({
          type: 'magic_numbers',
          line: i + 1,
          description: `Magic number(s) detected: ${magicNumbers.join(', ')}`,
          severity: 1,
        });
      }
    }

    // Callback hell detection (multiple nested callbacks)
    const callbackPattern = /\)\s*=>\s*{[\s\S]*?\)\s*=>\s*{[\s\S]*?\)\s*=>\s*{/;
    if (callbackPattern.test(content)) {
      smells.push({
        type: 'callback_hell',
        line: 1,
        description: 'Deeply nested callbacks detected',
        severity: 3,
      });
    }

    return smells;
  }

  /**
   * Generate refactoring suggestions based on analysis
   */
  private generateSuggestions(
    filePath: string,
    content: string,
    lines: string[],
    metrics: CodeMetrics,
    smells: DetectedSmell[],
  ): RefactorSuggestion[] {
    const suggestions: RefactorSuggestion[] = [];

    // Suggest function extraction for long functions
    for (const _smell of smells.filter((s) => s.type === 'long_function')) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'extract_function',
        priority: 'medium',
        file: filePath,
        startLine: 1,
        endLine: lines.length,
        description: 'Extract long functions into smaller units',
        explanation:
          'Breaking down long functions improves readability, testability, and maintainability.',
        addressesSmells: ['long_function'],
        effort: 3,
        risk: 2,
        autoApplicable: false,
      });
    }

    // Suggest complexity reduction
    for (const smell of smells.filter(
      (s) => s.type === 'complex_conditional',
    )) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'simplify_conditional',
        priority: 'high',
        file: filePath,
        startLine: smell.line,
        endLine: smell.line,
        description: 'Reduce conditional complexity',
        explanation:
          'Consider extracting conditions into well-named functions or using early returns.',
        addressesSmells: ['complex_conditional'],
        effort: 2,
        risk: 2,
        autoApplicable: false,
      });
    }

    // Suggest type improvements
    if (metrics.anyTypeCount > 0) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'improve_types',
        priority: metrics.anyTypeCount > 5 ? 'high' : 'medium',
        file: filePath,
        startLine: 1,
        endLine: lines.length,
        description: `Replace ${metrics.anyTypeCount} 'any' types with proper types`,
        explanation:
          "Using 'any' defeats TypeScript's type safety. Define proper interfaces or use 'unknown'.",
        addressesSmells: ['any_type_abuse'],
        effort: 2,
        risk: 1,
        autoApplicable: false,
      });
    }

    // Suggest nesting reduction
    for (const _smell of smells.filter((s) => s.type === 'deep_nesting')) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'reduce_complexity',
        priority: 'medium',
        file: filePath,
        startLine: 1,
        endLine: lines.length,
        description:
          'Reduce nesting depth using early returns or guard clauses',
        explanation:
          'Deep nesting makes code harder to read. Use early returns to flatten the structure.',
        addressesSmells: ['deep_nesting'],
        effort: 2,
        risk: 2,
        autoApplicable: false,
      });
    }

    // Suggest callback refactoring
    for (const _smell of smells.filter((s) => s.type === 'callback_hell')) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'convert_loop',
        priority: 'high',
        file: filePath,
        startLine: 1,
        endLine: lines.length,
        description: 'Convert nested callbacks to async/await',
        explanation:
          'Modern async/await syntax is more readable than nested callbacks.',
        addressesSmells: ['callback_hell'],
        effort: 3,
        risk: 2,
        autoApplicable: false,
      });
    }

    // Suggest parameter object pattern
    for (const smell of smells.filter(
      (s) => s.type === 'long_parameter_list',
    )) {
      suggestions.push({
        id: `refactor_${++this.suggestionCounter}`,
        type: 'extract_variable',
        priority: 'low',
        file: filePath,
        startLine: smell.line,
        endLine: smell.line,
        description:
          'Use parameter object pattern for functions with many parameters',
        explanation:
          'Group related parameters into an options object for better readability.',
        addressesSmells: ['long_parameter_list'],
        effort: 2,
        risk: 2,
        autoApplicable: false,
      });
    }

    return suggestions;
  }

  /**
   * Calculate overall health score
   */
  private calculateHealthScore(
    metrics: CodeMetrics,
    smells: DetectedSmell[],
  ): number {
    let score = 100;

    // Deduct for complexity
    if (metrics.cyclomaticComplexity > this.config.maxComplexity) {
      score -= Math.min(
        20,
        (metrics.cyclomaticComplexity - this.config.maxComplexity) * 2,
      );
    }

    // Deduct for nesting
    if (metrics.maxNestingDepth > this.config.maxNestingDepth) {
      score -= Math.min(
        15,
        (metrics.maxNestingDepth - this.config.maxNestingDepth) * 5,
      );
    }

    // Deduct for any types
    score -= Math.min(15, metrics.anyTypeCount * 2);

    // Deduct for each smell
    for (const smell of smells) {
      score -= smell.severity * 2;
    }

    // Deduct for TODOs
    score -= Math.min(10, metrics.todoCount);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if file should be excluded
   */
  private isExcluded(filePath: string): boolean {
    const fileName = path.basename(filePath);

    for (const pattern of this.config.excludePatterns) {
      if (pattern.startsWith('*')) {
        if (fileName.endsWith(pattern.slice(1))) return true;
      } else if (pattern.endsWith('/**')) {
        if (filePath.includes(pattern.slice(0, -3))) return true;
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a human-readable report
   */
  generateTextReport(report: RefactorReport): string {
    const lines: string[] = [];

    lines.push('# Refactoring Report');
    lines.push('');
    lines.push(`**Files analyzed**: ${report.filesAnalyzed}`);
    lines.push(`**Total suggestions**: ${report.totalSuggestions}`);
    lines.push(
      `**Average health score**: ${Math.round(report.averageHealthScore)}/100`,
    );
    lines.push(`**Analysis time**: ${report.durationMs}ms`);
    lines.push('');

    // Priority breakdown
    lines.push('## Suggestions by Priority');
    lines.push(`- Critical: ${report.byPriority.critical}`);
    lines.push(`- High: ${report.byPriority.high}`);
    lines.push(`- Medium: ${report.byPriority.medium}`);
    lines.push(`- Low: ${report.byPriority.low}`);
    lines.push(`- Optional: ${report.byPriority.optional}`);
    lines.push('');

    // Top suggestions
    if (report.topSuggestions.length > 0) {
      lines.push('## Top Suggestions');
      for (const suggestion of report.topSuggestions.slice(0, 5)) {
        lines.push(
          `- **[${suggestion.priority.toUpperCase()}]** ${suggestion.description}`,
        );
        lines.push(`  - File: ${suggestion.file}:${suggestion.startLine}`);
        lines.push(
          `  - Effort: ${suggestion.effort}/5, Risk: ${suggestion.risk}/5`,
        );
      }
    }

    return lines.join('\n');
  }
}

/**
 * Create a RefactorAgent with custom configuration
 */
export function createRefactorAgent(
  config?: Partial<RefactorConfig>,
): RefactorAgent {
  return new RefactorAgent(config);
}
