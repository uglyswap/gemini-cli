/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ErrorMemory
 *
 * Learning system for error patterns:
 * 1. Stores error patterns and their successful fixes
 * 2. Learns from repeated errors to suggest fixes
 * 3. Tracks error frequency across sessions
 * 4. Provides fix suggestions based on history
 * 5. Persists memory to disk for cross-session learning
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  FeedbackError,
  FixAction,
  ErrorCategory,
} from './feedback-loop.js';

/**
 * Error pattern for matching
 */
export interface ErrorPattern {
  /** Unique pattern ID */
  id: string;
  /** Error category */
  category: ErrorCategory;
  /** Regex pattern to match error messages */
  messagePattern: string;
  /** Rule/code pattern (if applicable) */
  rulePattern?: string;
  /** File pattern (glob-like) */
  filePattern?: string;
  /** Times this pattern was seen */
  occurrences: number;
  /** When first seen */
  firstSeen: Date;
  /** When last seen */
  lastSeen: Date;
  /** Successful fixes for this pattern */
  successfulFixes: SuccessfulFix[];
}

/**
 * A successful fix that resolved an error
 */
export interface SuccessfulFix {
  /** Description of the fix */
  description: string;
  /** Type of fix */
  type: FixAction['type'];
  /** Code change if applicable */
  codeChange?: {
    before: string;
    after: string;
  };
  /** Times this fix worked */
  successCount: number;
  /** Times this fix was attempted */
  attemptCount: number;
  /** Success rate (successCount / attemptCount) */
  successRate: number;
  /** When this fix was last used successfully */
  lastSuccessAt: Date;
}

/**
 * Fix suggestion with confidence
 */
export interface FixSuggestion {
  /** The suggested fix */
  fix: SuccessfulFix;
  /** Confidence score (0-100) */
  confidence: number;
  /** Pattern that matched */
  patternId: string;
  /** Reasoning for this suggestion */
  reasoning: string;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total patterns stored */
  totalPatterns: number;
  /** Total successful fixes recorded */
  totalFixes: number;
  /** Total errors processed */
  totalErrorsProcessed: number;
  /** Memory size in bytes (approximate) */
  memorySizeBytes: number;
  /** Top error categories */
  topCategories: Array<{ category: ErrorCategory; count: number }>;
  /** Average fix success rate */
  averageFixSuccessRate: number;
}

/**
 * ErrorMemory configuration
 */
export interface ErrorMemoryConfig {
  /** Path to persist memory */
  persistPath?: string;
  /** Maximum patterns to store */
  maxPatterns: number;
  /** Minimum occurrences before suggesting a fix */
  minOccurrencesForSuggestion: number;
  /** Minimum success rate to suggest a fix (0-1) */
  minSuccessRate: number;
  /** Auto-persist on changes */
  autoPersist: boolean;
  /** Cleanup patterns older than this (ms) */
  patternTTLMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ErrorMemoryConfig = {
  maxPatterns: 1000,
  minOccurrencesForSuggestion: 2,
  minSuccessRate: 0.7,
  autoPersist: true,
  patternTTLMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Serialized memory format
 */
interface SerializedMemory {
  version: number;
  patterns: ErrorPattern[];
  stats: {
    totalErrorsProcessed: number;
  };
  savedAt: string;
}

/**
 * ErrorMemory class for learning from errors
 */
export class ErrorMemory {
  private readonly config: ErrorMemoryConfig;
  private patterns: Map<string, ErrorPattern> = new Map();
  private totalErrorsProcessed = 0;
  private patternCounter = 0;

  constructor(config: Partial<ErrorMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Load persisted memory if path provided
    if (this.config.persistPath) {
      this.load();
    }
  }

  /**
   * Record an error and learn from it
   */
  recordError(error: FeedbackError): ErrorPattern {
    this.totalErrorsProcessed++;

    // Try to find an existing pattern
    const existingPattern = this.findMatchingPattern(error);

    if (existingPattern) {
      // Update existing pattern
      existingPattern.occurrences++;
      existingPattern.lastSeen = new Date();

      if (this.config.autoPersist) {
        this.persist();
      }

      return existingPattern;
    }

    // Create new pattern
    const pattern: ErrorPattern = {
      id: `pattern_${++this.patternCounter}`,
      category: error.category,
      messagePattern: this.createMessagePattern(error.message),
      rulePattern: error.suggestedFix
        ? this.escapeRegex(error.suggestedFix)
        : undefined,
      filePattern: error.file ? this.createFilePattern(error.file) : undefined,
      occurrences: 1,
      firstSeen: new Date(),
      lastSeen: new Date(),
      successfulFixes: [],
    };

    this.patterns.set(pattern.id, pattern);

    // Cleanup if over limit
    if (this.patterns.size > this.config.maxPatterns) {
      this.cleanup();
    }

    if (this.config.autoPersist) {
      this.persist();
    }

    return pattern;
  }

  /**
   * Record a successful fix for an error
   */
  recordFix(patternId: string, fix: FixAction, successful: boolean): void {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    // Find existing fix or create new one
    const existingFix = pattern.successfulFixes.find(
      (f) => f.description === fix.description && f.type === fix.type,
    );

    if (existingFix) {
      existingFix.attemptCount++;
      if (successful) {
        existingFix.successCount++;
        existingFix.lastSuccessAt = new Date();
      }
      existingFix.successRate =
        existingFix.successCount / existingFix.attemptCount;
    } else if (successful) {
      // Only add new fixes if they were successful
      const newFix: SuccessfulFix = {
        description: fix.description,
        type: fix.type,
        successCount: 1,
        attemptCount: 1,
        successRate: 1,
        lastSuccessAt: new Date(),
      };
      pattern.successfulFixes.push(newFix);
    }

    if (this.config.autoPersist) {
      this.persist();
    }
  }

  /**
   * Get fix suggestions for an error
   */
  getSuggestions(error: FeedbackError): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];

    const pattern = this.findMatchingPattern(error);
    if (!pattern) return suggestions;

    // Check if pattern has enough occurrences
    if (pattern.occurrences < this.config.minOccurrencesForSuggestion) {
      return suggestions;
    }

    // Get successful fixes above minimum success rate
    for (const fix of pattern.successfulFixes) {
      if (fix.successRate >= this.config.minSuccessRate) {
        const confidence = this.calculateConfidence(pattern, fix);

        suggestions.push({
          fix,
          confidence,
          patternId: pattern.id,
          reasoning: this.generateReasoning(pattern, fix, confidence),
        });
      }
    }

    // Sort by confidence
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Find a pattern matching the error
   */
  private findMatchingPattern(error: FeedbackError): ErrorPattern | null {
    for (const pattern of this.patterns.values()) {
      if (this.patternMatches(pattern, error)) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Check if a pattern matches an error
   */
  private patternMatches(pattern: ErrorPattern, error: FeedbackError): boolean {
    // Category must match
    if (pattern.category !== error.category) return false;

    // Message pattern must match
    try {
      const messageRegex = new RegExp(pattern.messagePattern, 'i');
      if (!messageRegex.test(error.message)) return false;
    } catch {
      // If regex is invalid, do simple includes check
      if (!error.message.includes(pattern.messagePattern)) return false;
    }

    // File pattern check (optional)
    if (pattern.filePattern && error.file) {
      try {
        const fileRegex = new RegExp(pattern.filePattern);
        if (!fileRegex.test(error.file)) return false;
      } catch {
        // Ignore file pattern match failures
      }
    }

    return true;
  }

  /**
   * Create a message pattern from an error message
   */
  private createMessagePattern(message: string): string {
    // Extract key parts and make a flexible pattern
    let pattern = message
      // Replace specific file paths with pattern
      .replace(/['"]?[A-Za-z]:[\\/][^'":\s]+['"]?/g, '[FILE_PATH]')
      // Replace line:col patterns
      .replace(/\(\d+,\d+\)/g, '(LINE,COL)')
      // Replace numbers with pattern
      .replace(/\b\d+\b/g, '\\d+')
      // Escape special regex chars except our placeholders
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace our placeholders with actual regex
    pattern = pattern
      .replace(/\[FILE_PATH\]/g, '[^\\s]+')
      .replace(/\(LINE,COL\)/g, '\\(\\d+,\\d+\\)');

    return pattern;
  }

  /**
   * Create a file pattern from a file path
   */
  private createFilePattern(filePath: string): string {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);

    // Create pattern that matches files in same directory with same extension
    return `${this.escapeRegex(dir)}.*\\${ext}$`;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate confidence for a fix suggestion
   */
  private calculateConfidence(
    pattern: ErrorPattern,
    fix: SuccessfulFix,
  ): number {
    // Base confidence on success rate (0-50 points)
    let confidence = fix.successRate * 50;

    // Add points for more occurrences (0-25 points)
    const occurrenceScore = Math.min(pattern.occurrences / 10, 1) * 25;
    confidence += occurrenceScore;

    // Add points for recent success (0-15 points)
    const daysSinceLastSuccess =
      (Date.now() - fix.lastSuccessAt.getTime()) / (24 * 60 * 60 * 1000);
    const recencyScore = Math.max(0, 15 - daysSinceLastSuccess);
    confidence += recencyScore;

    // Add points for more attempts (0-10 points)
    const attemptScore = Math.min(fix.attemptCount / 5, 1) * 10;
    confidence += attemptScore;

    return Math.min(100, Math.round(confidence));
  }

  /**
   * Generate reasoning for a fix suggestion
   */
  private generateReasoning(
    pattern: ErrorPattern,
    fix: SuccessfulFix,
    confidence: number,
  ): string {
    const parts: string[] = [];

    parts.push(
      `This fix has worked ${fix.successCount}/${fix.attemptCount} times (${Math.round(fix.successRate * 100)}% success rate).`,
    );

    if (pattern.occurrences > 5) {
      parts.push(
        `This error pattern has been seen ${pattern.occurrences} times.`,
      );
    }

    const daysSinceLastSuccess =
      (Date.now() - fix.lastSuccessAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceLastSuccess < 7) {
      parts.push('This fix was successful recently.');
    }

    if (confidence >= 80) {
      parts.push('High confidence recommendation.');
    } else if (confidence >= 60) {
      parts.push('Moderate confidence recommendation.');
    } else {
      parts.push('Low confidence - consider reviewing manually.');
    }

    return parts.join(' ');
  }

  /**
   * Cleanup old patterns
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.patternTTLMs;

    // Remove patterns older than TTL and with few occurrences
    for (const [id, pattern] of this.patterns) {
      const patternAge = pattern.lastSeen.getTime();
      if (patternAge < cutoff && pattern.occurrences < 5) {
        this.patterns.delete(id);
      }
    }

    // If still over limit, remove least used patterns
    if (this.patterns.size > this.config.maxPatterns) {
      const sorted = [...this.patterns.entries()].sort(
        (a, b) => a[1].occurrences - b[1].occurrences,
      );

      const toRemove = sorted.slice(
        0,
        this.patterns.size - this.config.maxPatterns,
      );
      for (const [id] of toRemove) {
        this.patterns.delete(id);
      }
    }
  }

  /**
   * Persist memory to disk
   */
  persist(): void {
    if (!this.config.persistPath) return;

    const data: SerializedMemory = {
      version: 1,
      patterns: [...this.patterns.values()].map((p) => ({
        ...p,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        successfulFixes: p.successfulFixes.map((f) => ({
          ...f,
          lastSuccessAt: f.lastSuccessAt,
        })),
      })),
      stats: {
        totalErrorsProcessed: this.totalErrorsProcessed,
      },
      savedAt: new Date().toISOString(),
    };

    try {
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[ErrorMemory] Failed to persist:', error);
    }
  }

  /**
   * Load memory from disk
   */
  load(): void {
    if (!this.config.persistPath || !fs.existsSync(this.config.persistPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.config.persistPath, 'utf-8');
      const data: SerializedMemory = JSON.parse(content);

      if (data.version !== 1) {
        console.warn('[ErrorMemory] Unknown memory version, skipping load');
        return;
      }

      this.patterns.clear();
      for (const pattern of data.patterns) {
        // Restore dates
        pattern.firstSeen = new Date(pattern.firstSeen);
        pattern.lastSeen = new Date(pattern.lastSeen);
        for (const fix of pattern.successfulFixes) {
          fix.lastSuccessAt = new Date(fix.lastSuccessAt);
        }
        this.patterns.set(pattern.id, pattern);

        // Update counter
        const num = parseInt(pattern.id.replace('pattern_', ''), 10);
        if (num > this.patternCounter) {
          this.patternCounter = num;
        }
      }

      this.totalErrorsProcessed = data.stats.totalErrorsProcessed;
    } catch (error) {
      console.error('[ErrorMemory] Failed to load:', error);
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const categoryCount = new Map<ErrorCategory, number>();
    let totalFixes = 0;
    let totalSuccessRate = 0;
    let fixCount = 0;

    for (const pattern of this.patterns.values()) {
      // Count categories
      const count = categoryCount.get(pattern.category) || 0;
      categoryCount.set(pattern.category, count + pattern.occurrences);

      // Count fixes
      totalFixes += pattern.successfulFixes.length;

      // Sum success rates
      for (const fix of pattern.successfulFixes) {
        totalSuccessRate += fix.successRate;
        fixCount++;
      }
    }

    // Build top categories
    const topCategories = [...categoryCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Estimate memory size
    const memorySizeBytes = JSON.stringify([...this.patterns.values()]).length;

    return {
      totalPatterns: this.patterns.size,
      totalFixes,
      totalErrorsProcessed: this.totalErrorsProcessed,
      memorySizeBytes,
      topCategories,
      averageFixSuccessRate: fixCount > 0 ? totalSuccessRate / fixCount : 0,
    };
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.patterns.clear();
    this.totalErrorsProcessed = 0;
    this.patternCounter = 0;

    if (this.config.persistPath && fs.existsSync(this.config.persistPath)) {
      fs.unlinkSync(this.config.persistPath);
    }
  }

  /**
   * Export memory for debugging
   */
  export(): ErrorPattern[] {
    return [...this.patterns.values()];
  }
}

/**
 * Create an ErrorMemory instance with custom configuration
 */
export function createErrorMemory(
  config?: Partial<ErrorMemoryConfig>,
): ErrorMemory {
  return new ErrorMemory(config);
}

/**
 * Global error memory instance (optional singleton pattern)
 */
let globalMemory: ErrorMemory | null = null;

/**
 * Get or create a global error memory instance
 */
export function getGlobalErrorMemory(
  config?: Partial<ErrorMemoryConfig>,
): ErrorMemory {
  if (!globalMemory) {
    globalMemory = new ErrorMemory(config);
  }
  return globalMemory;
}
