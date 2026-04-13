/**
 * Unit tests for UsageApiCacheStore service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createUsageApiCacheStore,
  type UsageApiCacheEntry,
} from '@/services/usage-api-cache-store';

describe('UsageApiCacheStore', () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `usage-api-cache-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    cachePath = join(tempDir, 'usage-api-cache.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create empty cache file if not exists', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const content = await readFile(cachePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.version).toBe('1.0');
      expect(data.entries).toEqual({});
    });

    it('should load existing cache entries', async () => {
      const existingData = {
        version: '1.0',
        lastSync: '2026-04-13T03:00:00.000Z',
        entries: {
          '3': {
            planId: 3,
            planName: 'Zhipu_3',
            provider: 'zhipu',
            percentage: 72,
            windows: [{ type: 'TOKENS_LIMIT', percentage: 72, windowLabel: '5h' }],
            lastUpdated: '2026-04-13T03:00:00.000Z',
            expiresAt: '2026-04-13T03:05:00.000Z',
          },
        },
      };
      await writeFile(cachePath, JSON.stringify(existingData, null, 2), 'utf-8');

      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entry = store.getEntry(3);
      expect(entry).not.toBeNull();
      expect(entry?.planName).toBe('Zhipu_3');
      expect(entry?.percentage).toBe(72);
    });
  });

  describe('updateEntry and getEntry', () => {
    it('should update and retrieve cache entry', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entryData: UsageApiCacheEntry = {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [{ type: 'TOKENS_LIMIT', percentage: 72, windowLabel: '5h' }],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };

      store.updateEntry(3, entryData);
      const entry = store.getEntry(3);

      expect(entry?.percentage).toBe(72);
      expect(entry?.isStale).toBe(false);
    });

    it('should mark entry as stale when expired', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entryData: UsageApiCacheEntry = {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Expired 5 min ago
      };

      store.updateEntry(3, entryData);
      const entry = store.getEntry(3);

      expect(entry?.isStale).toBe(true);
    });

    it('should return null for missing entry', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entry = store.getEntry(999);
      expect(entry).toBeNull();
    });
  });

  describe('getAllEntries', () => {
    it('should return all entries', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.updateEntry(4, {
        planId: 4,
        planName: 'Zhipu_6',
        provider: 'zhipu',
        percentage: 45,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      const entries = store.getAllEntries();
      expect(entries.size).toBe(2);
      expect(entries.get(3)?.percentage).toBe(72);
      expect(entries.get(4)?.percentage).toBe(45);
    });
  });

  describe('persist', () => {
    it('should persist entries to file', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      await store.persist();

      const content = await readFile(cachePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.entries['3'].percentage).toBe(72);
    });
  });

  describe('clearOrphanEntries', () => {
    it('should remove entries for deleted plans', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.updateEntry(5, {
        planId: 5,
        planName: 'DeletedPlan',
        provider: 'zhipu',
        percentage: 10,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.clearOrphanEntries([3]);

      const entries = store.getAllEntries();
      expect(entries.size).toBe(1);
      expect(entries.has(5)).toBe(false);
    });
  });
});