/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Snapshot Manager
 * Creates and manages file snapshots for safe rollback
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  Snapshot,
  SnapshotFile,
  SnapshotMetadata,
  SnapshotDiff,
  FileDiff,
  RestoreOptions,
  RestoreResult,
  SnapshotManagerOptions,
} from './types.js';

const DEFAULT_OPTIONS: Required<SnapshotManagerOptions> = {
  snapshotDir: '.gemini/snapshots',
  maxSnapshots: 20,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    '*.lock',
    'package-lock.json',
    '.env*',
    'dist/**',
    'build/**',
    '.next/**',
  ],
  compress: false,
};

/**
 * Snapshot Manager
 * Handles creation, comparison, and restoration of file snapshots
 */
export class SnapshotManager {
  private readonly projectRoot: string;
  private readonly snapshotDir: string;
  private readonly options: Required<SnapshotManagerOptions>;

  constructor(projectRoot: string, options: SnapshotManagerOptions = {}) {
    this.projectRoot = projectRoot;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.snapshotDir = path.isAbsolute(this.options.snapshotDir)
      ? this.options.snapshotDir
      : path.join(projectRoot, this.options.snapshotDir);
    this.ensureDir();
  }

  /**
   * Create a snapshot of specified files
   */
  async createSnapshot(
    filePaths: string[],
    label: string,
    metadata: SnapshotMetadata,
  ): Promise<Snapshot> {
    const id = this.generateId();
    const timestamp = new Date().toISOString();
    const files: SnapshotFile[] = [];

    for (const filePath of filePaths) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.projectRoot, filePath);

      if (this.shouldExclude(filePath)) {
        console.log(`[Snapshot] Skipping excluded file: ${filePath}`);
        continue;
      }

      if (!fs.existsSync(absolutePath)) {
        console.log(`[Snapshot] File not found, skipping: ${filePath}`);
        continue;
      }

      const stats = fs.statSync(absolutePath);

      if (stats.size > this.options.maxFileSize) {
        console.log(
          `[Snapshot] File too large, skipping: ${filePath} (${stats.size} bytes)`,
        );
        continue;
      }

      try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        files.push({
          path: absolutePath,
          contentHash: this.hash(content),
          content,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      } catch (error) {
        console.error(`[Snapshot] Error reading file: ${filePath}`, error);
      }
    }

    const snapshot: Snapshot = {
      id,
      label,
      timestamp,
      files,
      metadata,
      version: '1.0.0',
    };

    // Save snapshot
    const snapshotPath = path.join(this.snapshotDir, `${id}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    console.log(
      `[Snapshot] Created: ${id} - "${label}" (${files.length} files)`,
    );

    // Cleanup old snapshots
    await this.cleanupOldSnapshots();

    return snapshot;
  }

  /**
   * List all available snapshots
   */
  listSnapshots(): Snapshot[] {
    if (!fs.existsSync(this.snapshotDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.snapshotDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    return files.map((f) => {
      const content = fs.readFileSync(path.join(this.snapshotDir, f), 'utf-8');
      return JSON.parse(content) as Snapshot;
    });
  }

  /**
   * Get a specific snapshot by ID
   */
  getSnapshot(snapshotId: string): Snapshot | null {
    const snapshotPath = path.join(this.snapshotDir, `${snapshotId}.json`);

    if (!fs.existsSync(snapshotPath)) {
      return null;
    }

    const content = fs.readFileSync(snapshotPath, 'utf-8');
    return JSON.parse(content) as Snapshot;
  }

  /**
   * Compare a snapshot with current file state
   */
  diffSnapshot(snapshotId: string): SnapshotDiff {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const files: FileDiff[] = [];
    const summary = { unchanged: 0, modified: 0, deleted: 0, created: 0 };

    for (const sf of snapshot.files) {
      if (!fs.existsSync(sf.path)) {
        files.push({
          path: sf.path,
          status: 'deleted',
          snapshotHash: sf.contentHash,
        });
        summary.deleted++;
        continue;
      }

      const currentContent = fs.readFileSync(sf.path, 'utf-8');
      const currentHash = this.hash(currentContent);

      if (currentHash === sf.contentHash) {
        files.push({
          path: sf.path,
          status: 'unchanged',
          snapshotHash: sf.contentHash,
          currentHash,
        });
        summary.unchanged++;
      } else {
        const { added, removed } = this.countLineDiff(
          sf.content,
          currentContent,
        );
        files.push({
          path: sf.path,
          status: 'modified',
          snapshotHash: sf.contentHash,
          currentHash,
          linesAdded: added,
          linesRemoved: removed,
        });
        summary.modified++;
      }
    }

    return {
      snapshotId,
      files,
      summary,
    };
  }

  /**
   * Restore files from a snapshot
   */
  async restoreSnapshot(
    snapshotId: string,
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const result: RestoreResult = {
      success: true,
      restored: [],
      skipped: [],
      failed: [],
    };

    // Create backup before restore if requested
    if (options.createBackup) {
      const filesToBackup = snapshot.files.map((f) => f.path);
      const backupLabel =
        options.backupLabel || `Pre-restore backup for ${snapshotId}`;
      const backup = await this.createSnapshot(filesToBackup, backupLabel, {
        agentId: 'snapshot-manager',
        taskDescription: `Backup before restoring ${snapshotId}`,
        trustLevel: 0,
      });
      result.backupId = backup.id;
      console.log(`[Snapshot] Created backup: ${backup.id}`);
    }

    // Process each file
    for (const sf of snapshot.files) {
      // Filter if specific files requested
      if (options.files && options.files.length > 0) {
        if (!options.files.some((f) => sf.path.includes(f))) {
          result.skipped.push(sf.path);
          continue;
        }
      }

      if (options.dryRun) {
        console.log(`[Snapshot] Would restore: ${sf.path}`);
        result.restored.push(sf.path);
        continue;
      }

      try {
        // Ensure directory exists
        const dir = path.dirname(sf.path);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(sf.path, sf.content);
        result.restored.push(sf.path);
        console.log(`[Snapshot] Restored: ${sf.path}`);
      } catch (error) {
        result.failed.push({
          path: sf.path,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.success = false;
        console.error(`[Snapshot] Failed to restore: ${sf.path}`, error);
      }
    }

    const action = options.dryRun ? 'Would restore' : 'Restored';
    console.log(
      `[Snapshot] ${action} ${result.restored.length} files, ` +
        `skipped ${result.skipped.length}, ` +
        `failed ${result.failed.length}`,
    );

    return result;
  }

  /**
   * Delete a specific snapshot
   */
  deleteSnapshot(snapshotId: string): boolean {
    const snapshotPath = path.join(this.snapshotDir, `${snapshotId}.json`);

    if (!fs.existsSync(snapshotPath)) {
      return false;
    }

    fs.unlinkSync(snapshotPath);
    console.log(`[Snapshot] Deleted: ${snapshotId}`);
    return true;
  }

  /**
   * Cleanup all snapshots (public method for external access)
   */
  async cleanup(): Promise<void> {
    await this.cleanupOldSnapshots();
  }

  /**
   * Get snapshot statistics
   */
  getStats(): {
    totalSnapshots: number;
    totalFiles: number;
    totalSize: number;
    oldestSnapshot?: string;
    newestSnapshot?: string;
  } {
    const snapshots = this.listSnapshots();

    let totalFiles = 0;
    let totalSize = 0;

    for (const snapshot of snapshots) {
      totalFiles += snapshot.files.length;
      totalSize += snapshot.files.reduce((sum, f) => sum + f.size, 0);
    }

    return {
      totalSnapshots: snapshots.length,
      totalFiles,
      totalSize,
      oldestSnapshot: snapshots[snapshots.length - 1]?.timestamp,
      newestSnapshot: snapshots[0]?.timestamp,
    };
  }

  // Private methods

  private generateId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const time = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const random = crypto.randomBytes(4).toString('hex');
    return `snap-${date}-${time}-${random}`;
  }

  private hash(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 16);
  }

  private shouldExclude(filePath: string): boolean {
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.projectRoot, filePath)
      : filePath;

    for (const pattern of this.options.excludePatterns) {
      // Simple glob matching
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');

      if (new RegExp(`^${regexPattern}$`).test(relativePath)) {
        return true;
      }
    }

    return false;
  }

  private countLineDiff(
    oldContent: string,
    newContent: string,
  ): { added: number; removed: number } {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple line count diff (not a real diff algorithm)
    const added = Math.max(0, newLines.length - oldLines.length);
    const removed = Math.max(0, oldLines.length - newLines.length);

    return { added, removed };
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  private async cleanupOldSnapshots(): Promise<void> {
    const snapshots = this.listSnapshots();

    if (snapshots.length > this.options.maxSnapshots) {
      const toDelete = snapshots.slice(this.options.maxSnapshots);

      for (const snapshot of toDelete) {
        this.deleteSnapshot(snapshot.id);
      }
    }
  }
}
