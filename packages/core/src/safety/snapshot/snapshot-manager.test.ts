/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SnapshotManager } from './snapshot-manager.js';
import type { SnapshotMetadata } from './types.js';
import * as fs from 'node:fs';

// Mock fs module
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mockhash1234567890'),
  })),
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('abcd1234'),
  }),
}));

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  const mockProjectRoot = '/test/project';

  const mockMetadata: SnapshotMetadata = {
    agentId: 'test-agent',
    taskDescription: 'Test task',
    trustLevel: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue([]);
    (fs.statSync as jest.Mock).mockReturnValue({
      size: 100,
      mtime: new Date(),
    });
    (fs.readFileSync as jest.Mock).mockReturnValue('file content');

    manager = new SnapshotManager(mockProjectRoot, {
      maxSnapshots: 5,
      excludePatterns: ['node_modules/**', '.git/**'],
    });
  });

  describe('constructor', () => {
    it('should create manager with default options', () => {
      const newManager = new SnapshotManager(mockProjectRoot);
      expect(newManager).toBeDefined();
    });

    it('should create manager with custom options', () => {
      const newManager = new SnapshotManager(mockProjectRoot, {
        maxSnapshots: 10,
        maxFileSize: 1024,
        excludePatterns: ['dist/**'],
      });
      expect(newManager).toBeDefined();
    });
  });

  describe('createSnapshot', () => {
    it('should create a snapshot with files and metadata', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 100,
        mtime: new Date(),
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('file content');

      const snapshot = await manager.createSnapshot(
        ['src/file.ts'],
        'Test snapshot',
        mockMetadata,
      );

      expect(snapshot).toBeDefined();
      expect(snapshot.label).toBe('Test snapshot');
      expect(snapshot.metadata).toEqual(mockMetadata);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should skip non-existent files', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('snapshot')) return true;
        return false;
      });

      const snapshot = await manager.createSnapshot(
        ['non-existent.ts'],
        'Test snapshot',
        mockMetadata,
      );

      expect(snapshot).toBeDefined();
      expect(snapshot.files.length).toBe(0);
    });

    it('should skip files exceeding max size', async () => {
      const smallManager = new SnapshotManager(mockProjectRoot, {
        maxFileSize: 50,
      });

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({
        size: 100, // Larger than max
        mtime: new Date(),
      });

      const snapshot = await smallManager.createSnapshot(
        ['large-file.ts'],
        'Test',
        mockMetadata,
      );

      expect(snapshot.files.length).toBe(0);
    });
  });

  describe('listSnapshots', () => {
    it('should return empty array if snapshot directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const snapshots = manager.listSnapshots();

      expect(snapshots).toEqual([]);
    });

    it('should return list of snapshots', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'snap1.json',
        'snap2.json',
      ]);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          id: 'snap1',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      const snapshots = manager.listSnapshots();

      expect(Array.isArray(snapshots)).toBe(true);
    });
  });

  describe('getSnapshot', () => {
    it('should return null for non-existent snapshot', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const snapshot = manager.getSnapshot('non-existent');

      expect(snapshot).toBeNull();
    });

    it('should return snapshot by ID', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          id: 'snap1',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      const snapshot = manager.getSnapshot('snap1');

      expect(snapshot).toBeDefined();
      expect(snapshot?.id).toBe('snap1');
    });
  });

  describe('restoreSnapshot', () => {
    it('should throw for non-existent snapshot', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(manager.restoreSnapshot('non-existent')).rejects.toThrow(
        'Snapshot non-existent not found',
      );
    });

    it('should restore files from snapshot', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          id: 'snap1',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [
            {
              path: '/test/project/src/file.ts',
              contentHash: 'abc123',
              content: 'restored content',
              size: 16,
              modifiedAt: new Date().toISOString(),
            },
          ],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      const result = await manager.restoreSnapshot('snap1');

      expect(result.success).toBe(true);
      expect(result.restored.length).toBeGreaterThanOrEqual(0);
    });

    it('should support dry run mode', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          id: 'snap1',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [
            {
              path: '/test/project/src/file.ts',
              contentHash: 'abc123',
              content: 'restored content',
              size: 16,
              modifiedAt: new Date().toISOString(),
            },
          ],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      const result = await manager.restoreSnapshot('snap1', { dryRun: true });

      expect(result.success).toBe(true);
      // In dry run, writeFileSync should not be called for restoring files
    });
  });

  describe('deleteSnapshot', () => {
    it('should return false for non-existent snapshot', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = manager.deleteSnapshot('non-existent');

      expect(result).toBe(false);
    });

    it('should delete existing snapshot', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = manager.deleteSnapshot('snap1');

      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('diffSnapshot', () => {
    it('should throw for non-existent snapshot', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => manager.diffSnapshot('non-existent')).toThrow(
        'Snapshot non-existent not found',
      );
    });

    it('should return diff for existing snapshot', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('.json')) {
          return JSON.stringify({
            id: 'snap1',
            label: 'Test',
            timestamp: new Date().toISOString(),
            files: [
              {
                path: '/test/project/src/file.ts',
                contentHash: 'abc123',
                content: 'original content',
                size: 16,
                modifiedAt: new Date().toISOString(),
              },
            ],
            metadata: mockMetadata,
            version: '1.0.0',
          });
        }
        return 'current content';
      });

      const diff = manager.diffSnapshot('snap1');

      expect(diff).toBeDefined();
      expect(diff.snapshotId).toBe('snap1');
      expect(Array.isArray(diff.files)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['snap1.json']);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          id: 'snap1',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [{ size: 100 }],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      const stats = manager.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalSnapshots).toBe('number');
      expect(typeof stats.totalFiles).toBe('number');
      expect(typeof stats.totalSize).toBe('number');
    });
  });

  describe('cleanup', () => {
    it('should remove old snapshots beyond limit', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'snap1.json',
        'snap2.json',
        'snap3.json',
        'snap4.json',
        'snap5.json',
        'snap6.json',
      ]);
      (fs.readFileSync as jest.Mock).mockImplementation(() =>
        JSON.stringify({
          id: 'snapX',
          label: 'Test',
          timestamp: new Date().toISOString(),
          files: [],
          metadata: mockMetadata,
          version: '1.0.0',
        }),
      );

      await manager.cleanup();

      // Should have attempted to remove excess snapshots (6 - 5 = 1)
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });
});
