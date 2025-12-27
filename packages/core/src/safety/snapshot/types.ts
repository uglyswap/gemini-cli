/**
 * Snapshot Manager Types
 * For creating and restoring file snapshots
 */

/**
 * Single file in a snapshot
 */
export interface SnapshotFile {
  /** Absolute file path */
  path: string;
  /** SHA-256 hash of content (first 16 chars) */
  contentHash: string;
  /** Full file content */
  content: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modifiedAt: string;
}

/**
 * Metadata for a snapshot
 */
export interface SnapshotMetadata {
  /** Agent that triggered the snapshot */
  agentId: string;
  /** Task description */
  taskDescription: string;
  /** Trust level at time of snapshot */
  trustLevel: number;
  /** Complexity assessment */
  complexity?: 'simple' | 'moderate' | 'complex';
  /** Custom tags */
  tags?: string[];
}

/**
 * Complete snapshot
 */
export interface Snapshot {
  /** Unique snapshot ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Creation timestamp */
  timestamp: string;
  /** Snapshotted files */
  files: SnapshotFile[];
  /** Snapshot metadata */
  metadata: SnapshotMetadata;
  /** Snapshot version for compatibility */
  version: string;
}

/**
 * File status when comparing snapshot to current state
 */
export type FileChangeStatus = 'unchanged' | 'modified' | 'deleted' | 'created';

/**
 * Diff result for a single file
 */
export interface FileDiff {
  /** File path */
  path: string;
  /** Change status */
  status: FileChangeStatus;
  /** Content hash in snapshot */
  snapshotHash?: string;
  /** Current content hash */
  currentHash?: string;
  /** Lines added (if modified) */
  linesAdded?: number;
  /** Lines removed (if modified) */
  linesRemoved?: number;
}

/**
 * Complete diff between snapshot and current state
 */
export interface SnapshotDiff {
  /** Snapshot ID */
  snapshotId: string;
  /** Diff results per file */
  files: FileDiff[];
  /** Summary counts */
  summary: {
    unchanged: number;
    modified: number;
    deleted: number;
    created: number;
  };
}

/**
 * Options for snapshot restoration
 */
export interface RestoreOptions {
  /** Dry run - don't actually restore */
  dryRun?: boolean;
  /** Specific files to restore (all if empty) */
  files?: string[];
  /** Create backup before restore */
  createBackup?: boolean;
  /** Backup label if creating backup */
  backupLabel?: string;
}

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  /** Whether restore was successful */
  success: boolean;
  /** Files that were restored */
  restored: string[];
  /** Files that were skipped */
  skipped: string[];
  /** Files that failed to restore */
  failed: Array<{ path: string; error: string }>;
  /** Backup snapshot ID if created */
  backupId?: string;
}

/**
 * Options for snapshot manager initialization
 */
export interface SnapshotManagerOptions {
  /** Directory to store snapshots */
  snapshotDir?: string;
  /** Maximum snapshots to keep */
  maxSnapshots?: number;
  /** Maximum file size to snapshot (bytes) */
  maxFileSize?: number;
  /** Patterns to exclude from snapshots */
  excludePatterns?: string[];
  /** Enable compression */
  compress?: boolean;
}
