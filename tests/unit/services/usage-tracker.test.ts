/**
 * Unit tests for UsageTracker service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createUsageTracker, UsageTracker } from '@/services/usage-tracker';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('UsageTracker', () => {
  let tempDir: string;
  let usageDataPath: string;
  let tracker: UsageTracker;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `usage-tracker-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    usageDataPath = join(tempDir, 'usage-data.json');

    tracker = createUsageTracker({
      usageDataPath,
      syncIntervalMs: 1000,
    });
  });

  afterEach(async () => {
    // Cleanup
    tracker.stopPeriodicSync();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize with empty usage when file does not exist', async () => {
      await tracker.initialize();

      expect(tracker.isInitialized()).toBe(true);
      expect(tracker.getRecordCount()).toBe(0);
    });

    it('should load existing usage data from file', async () => {
      const existingData = {
        version: '1.0',
        lastSync: '2026-03-24T10:00:00Z',
        usage: {
          '2026-03-24': {
            'key-id-1': {
              requestCount: 10,
              inputTokens: 100,
              outputTokens: 50,
              lastRequest: '2026-03-24T09:30:00Z',
            },
          },
        },
      };

      await writeFile(usageDataPath, JSON.stringify(existingData, null, 2));

      await tracker.initialize();

      expect(tracker.getRecordCount()).toBe(1);
    });

    it('should start fresh if file has invalid format', async () => {
      await writeFile(usageDataPath, 'invalid json');

      await tracker.initialize();

      expect(tracker.getRecordCount()).toBe(0);
    });
  });

  describe('incrementRequestCount', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should increment request count for a key', async () => {
      const keyId = 'key-id-1';

      tracker.incrementRequestCount(keyId);
      tracker.incrementRequestCount(keyId);
      tracker.incrementRequestCount(keyId);

      const reports = tracker.getUsageReport({ keyId });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.totalRequests).toBe(3);
      expect(reports[0]?.keyId).toBe(keyId);
    });

    it('should create new record for first request', async () => {
      const keyId = 'key-id-new';

      tracker.incrementRequestCount(keyId);

      const reports = tracker.getUsageReport({ keyId });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.totalRequests).toBe(1);
    });
  });

  describe('recordTokenUsage', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should record token usage for a key', async () => {
      const keyId = 'key-id-1';

      tracker.recordTokenUsage(keyId, 100, 50);

      const reports = tracker.getUsageReport({ keyId });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.totalInputTokens).toBe(100);
      expect(reports[0]?.totalOutputTokens).toBe(50);
      expect(reports[0]?.totalTokens).toBe(150);
    });

    it('should accumulate token usage across multiple calls', async () => {
      const keyId = 'key-id-1';

      tracker.recordTokenUsage(keyId, 100, 50);
      tracker.recordTokenUsage(keyId, 200, 75);

      const reports = tracker.getUsageReport({ keyId });
      expect(reports[0]?.totalInputTokens).toBe(300);
      expect(reports[0]?.totalOutputTokens).toBe(125);
      expect(reports[0]?.totalTokens).toBe(425);
    });

    it('should create new record if no request count exists', async () => {
      const keyId = 'key-id-new';

      tracker.recordTokenUsage(keyId, 100, 50);

      const reports = tracker.getUsageReport({ keyId });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.totalInputTokens).toBe(100);
    });
  });

  describe('getUsageReport', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should return empty array when no usage data', async () => {
      const reports = tracker.getUsageReport();
      expect(reports).toHaveLength(0);
    });

    it('should filter by key ID', async () => {
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-2');
      tracker.incrementRequestCount('key-id-1');

      const reports = tracker.getUsageReport({ keyId: 'key-id-1' });

      expect(reports).toHaveLength(1);
      expect(reports[0]?.keyId).toBe('key-id-1');
      expect(reports[0]?.totalRequests).toBe(2);
    });

    it('should filter by date range', async () => {
      // Note: This test assumes current date for new records
      const today = new Date().toISOString().split('T')[0]!;

      tracker.incrementRequestCount('key-id-1');

      // Filter with past date range (should return empty)
      const pastReports = tracker.getUsageReport({
        from: '2020-01-01',
        to: '2020-12-31',
      });
      expect(pastReports).toHaveLength(0);

      // Filter with current date range (should return data)
      const currentReports = tracker.getUsageReport({
        from: today,
        to: today,
      });
      expect(currentReports).toHaveLength(1);
    });

    it('should include daily breakdown', async () => {
      tracker.incrementRequestCount('key-id-1');
      tracker.recordTokenUsage('key-id-1', 100, 50);
      tracker.incrementRequestCount('key-id-1');

      const reports = tracker.getUsageReport({ keyId: 'key-id-1' });

      expect(reports[0]?.dailyBreakdown).toHaveLength(1);
      expect(reports[0]?.dailyBreakdown[0]?.requestCount).toBe(2);
      expect(reports[0]?.dailyBreakdown[0]?.inputTokens).toBe(100);
      expect(reports[0]?.dailyBreakdown[0]?.outputTokens).toBe(50);
    });

    it('should sort reports by total requests descending', async () => {
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-2');

      const reports = tracker.getUsageReport();

      expect(reports).toHaveLength(2);
      expect(reports[0]?.keyId).toBe('key-id-1');
      expect(reports[0]?.totalRequests).toBe(3);
      expect(reports[1]?.keyId).toBe('key-id-2');
      expect(reports[1]?.totalRequests).toBe(1);
    });

    it('should maintain separate counters for multiple API keys', async () => {
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-1');
      tracker.recordTokenUsage('key-id-1', 100, 50);

      tracker.incrementRequestCount('key-id-2');
      tracker.recordTokenUsage('key-id-2', 200, 100);

      const reports = tracker.getUsageReport();

      expect(reports).toHaveLength(2);

      const report1 = reports.find((r) => r.keyId === 'key-id-1');
      const report2 = reports.find((r) => r.keyId === 'key-id-2');

      expect(report1?.totalRequests).toBe(2);
      expect(report1?.totalTokens).toBe(150);

      expect(report2?.totalRequests).toBe(1);
      expect(report2?.totalTokens).toBe(300);
    });
  });

  describe('persistence', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should persist usage data to file', async () => {
      tracker.incrementRequestCount('key-id-1');
      tracker.recordTokenUsage('key-id-1', 100, 50);

      await tracker.persist();

      const content = await readFile(usageDataPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.version).toBe('1.0');
      expect(data.usage).toBeDefined();

      const today = new Date().toISOString().split('T')[0]!;
      expect(data.usage[today]).toBeDefined();
      expect(data.usage[today]['key-id-1']).toBeDefined();
      expect(data.usage[today]['key-id-1'].requestCount).toBe(1);
      expect(data.usage[today]['key-id-1'].inputTokens).toBe(100);
      expect(data.usage[today]['key-id-1'].outputTokens).toBe(50);
    });

    it('should restore usage data after restart', async () => {
      // Add data and persist
      tracker.incrementRequestCount('key-id-1');
      tracker.incrementRequestCount('key-id-1');
      tracker.recordTokenUsage('key-id-1', 100, 50);
      await tracker.persist();

      // Create new tracker instance
      const newTracker = createUsageTracker({ usageDataPath });
      await newTracker.initialize();

      const reports = newTracker.getUsageReport({ keyId: 'key-id-1' });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.totalRequests).toBe(2);
      expect(reports[0]?.totalInputTokens).toBe(100);
      expect(reports[0]?.totalOutputTokens).toBe(50);
    });
  });

  describe('periodic sync', () => {
    it('should start and stop periodic sync', async () => {
      await tracker.initialize();

      tracker.startPeriodicSync();
      // Verify it doesn't throw if called again
      tracker.startPeriodicSync();

      tracker.stopPeriodicSync();
      // Verify it doesn't throw if called again
      tracker.stopPeriodicSync();
    });
  });

  describe('shutdown', () => {
    it('should persist data on shutdown', async () => {
      await tracker.initialize();

      tracker.incrementRequestCount('key-id-1');
      tracker.recordTokenUsage('key-id-1', 100, 50);

      await tracker.shutdown();

      // Verify data was persisted
      const content = await readFile(usageDataPath, 'utf-8');
      const data = JSON.parse(content);

      const today = new Date().toISOString().split('T')[0]!;
      expect(data.usage[today]['key-id-1']).toBeDefined();
    });
  });

  describe('getStoragePath', () => {
    it('should return the configured storage path', () => {
      expect(tracker.getStoragePath()).toBe(usageDataPath);
    });
  });
});