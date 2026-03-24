/**
 * UsageTracker - Tracks and persists API usage per key.
 * Implements daily aggregation with periodic persistence.
 *
 * @module services/usage-tracker
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import type { UsageRecord, UsageReport, DailyUsage, UsageDataStorage, UsageRecordData } from '@/types';
import { usageDataStorageSchema } from '@/types';
import { logger } from '@/utils/logger';
import { DEFAULT_AUTH_CONFIG } from '@/config/defaults';

/**
 * UsageTracker configuration.
 */
export interface UsageTrackerConfig {
  /** Path to usage data file */
  usageDataPath?: string;
  /** Interval for periodic persistence in milliseconds */
  syncIntervalMs?: number;
}

/**
 * Internal storage key format: `${date}:${keyId}`
 */
type StorageKey = string;

/**
 * UsageTracker - Manages usage tracking and persistence.
 *
 * @example
 * ```typescript
 * const tracker = createUsageTracker({ usageDataPath: './usage-data.json' });
 * await tracker.initialize();
 *
 * // Track a request
 * tracker.incrementRequestCount('key-id-123');
 *
 * // Record token usage
 * tracker.recordTokenUsage('key-id-123', 100, 50);
 *
 * // Get usage report
 * const report = tracker.getUsageReport({ keyId: 'key-id-123' });
 * ```
 */
export class UsageTracker {
  private readonly usageDataPath: string;
  private readonly syncIntervalMs: number;
  private readonly usage: Map<StorageKey, UsageRecord> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Create a new UsageTracker.
   *
   * @param config - Configuration options
   */
  constructor(config: UsageTrackerConfig = {}) {
    this.usageDataPath = resolve(config.usageDataPath ?? DEFAULT_AUTH_CONFIG.usageDataPath);
    this.syncIntervalMs = config.syncIntervalMs ?? DEFAULT_AUTH_CONFIG.usageSyncIntervalMs;
  }

  /**
   * Initialize the tracker by loading existing usage data.
   */
  async initialize(): Promise<void> {
    await this.loadUsage();
    this.initialized = true;
    logger.info('UsageTracker initialized', {
      recordCount: this.usage.size,
      storagePath: this.usageDataPath,
    });
  }

  /**
   * Get today's date in YYYY-MM-DD format.
   */
  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /**
   * Create a storage key from date and keyId.
   */
  private createStorageKey(date: string, keyId: string): StorageKey {
    return `${date}:${keyId}`;
  }

  /**
   * Get or create a usage record for a specific date and key.
   *
   * @param keyId - The API key ID
   * @param date - The date (YYYY-MM-DD), defaults to today
   * @returns The usage record
   */
  private getOrCreateRecord(keyId: string, date: string = this.getTodayDate()): UsageRecord {
    const storageKey = this.createStorageKey(date, keyId);
    let record = this.usage.get(storageKey);

    if (!record) {
      record = {
        keyId,
        date,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastRequest: new Date(),
      };
      this.usage.set(storageKey, record);
    }

    return record;
  }

  /**
   * Increment the request count for a key on the current day.
   *
   * @param keyId - The API key ID
   */
  incrementRequestCount(keyId: string): void {
    const record = this.getOrCreateRecord(keyId);
    record.requestCount += 1;
    record.lastRequest = new Date();

    logger.debug('Request count incremented', {
      keyId,
      date: record.date,
      requestCount: record.requestCount,
    });
  }

  /**
   * Record token usage for a key on the current day.
   *
   * @param keyId - The API key ID
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   */
  recordTokenUsage(keyId: string, inputTokens: number, outputTokens: number): void {
    const record = this.getOrCreateRecord(keyId);
    record.inputTokens += inputTokens;
    record.outputTokens += outputTokens;
    record.lastRequest = new Date();

    logger.debug('Token usage recorded', {
      keyId,
      date: record.date,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
    });
  }

  /**
   * Get usage report with optional filtering.
   *
   * @param options - Filter options
   * @returns Array of usage reports
   */
  getUsageReport(options: {
    keyId?: string;
    from?: string;
    to?: string;
  } = {}): UsageReport[] {
    const { keyId, from, to } = options;

    // Group records by keyId
    const recordsByKey = new Map<string, UsageRecord[]>();

    for (const record of this.usage.values()) {
      // Apply filters
      if (keyId && record.keyId !== keyId) {
        continue;
      }
      if (from && record.date < from) {
        continue;
      }
      if (to && record.date > to) {
        continue;
      }

      const existing = recordsByKey.get(record.keyId) ?? [];
      existing.push(record);
      recordsByKey.set(record.keyId, existing);
    }

    // Build reports
    const reports: UsageReport[] = [];

    for (const [keyId, records] of recordsByKey) {
      // Sort records by date
      records.sort((a, b) => a.date.localeCompare(b.date));

      const dailyBreakdown: DailyUsage[] = records.map((r) => ({
        date: r.date,
        requestCount: r.requestCount,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      }));

      const totalRequests = records.reduce((sum, r) => sum + r.requestCount, 0);
      const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
      const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);

      reports.push({
        keyId,
        keyName: keyId, // Will be replaced by caller if key info available
        totalRequests,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        dateRange: {
          start: records[0]!.date,
          end: records[records.length - 1]!.date,
        },
        dailyBreakdown,
      });
    }

    // Sort reports by total requests (descending)
    reports.sort((a, b) => b.totalRequests - a.totalRequests);

    return reports;
  }

  /**
   * Start periodic usage persistence.
   */
  startPeriodicSync(): void {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = setInterval(() => {
      this.persist().catch((error) => {
        logger.error('Periodic usage sync failed', error as Error);
      });
    }, this.syncIntervalMs);

    logger.info('Periodic usage sync started', {
      intervalMs: this.syncIntervalMs,
    });
  }

  /**
   * Stop periodic usage persistence.
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('Periodic usage sync stopped');
    }
  }

  /**
   * Persist usage data to file.
   */
  async persist(): Promise<void> {
    // Build storage structure
    const usageByDate: Record<string, Record<string, UsageRecordData>> = {};

    for (const [storageKey, record] of this.usage) {
      const [date, keyId] = storageKey.split(':') as [string, string];

      if (!usageByDate[date]) {
        usageByDate[date] = {};
      }

      usageByDate[date][keyId] = {
        requestCount: record.requestCount,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        lastRequest: record.lastRequest.toISOString(),
      };
    }

    const data: UsageDataStorage = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      usage: usageByDate,
    };

    // Ensure directory exists
    const dir = dirname(this.usageDataPath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.usageDataPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.usageDataPath);

    logger.debug('Usage data persisted', {
      path: this.usageDataPath,
      dateCount: Object.keys(usageByDate).length,
    });
  }

  /**
   * Load usage data from the storage file.
   */
  private async loadUsage(): Promise<void> {
    try {
      await access(this.usageDataPath, constants.R_OK);
    } catch {
      // File doesn't exist, start with empty usage
      logger.debug('Usage data file not found, starting fresh', {
        path: this.usageDataPath,
      });
      return;
    }

    try {
      const content = await readFile(this.usageDataPath, 'utf-8');
      const data = JSON.parse(content) as UsageDataStorage;

      // Validate the storage format
      const parsed = usageDataStorageSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn('Invalid usage data storage format, starting fresh', {
          errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        return;
      }

      // Load records into memory
      for (const [date, keysData] of Object.entries(parsed.data.usage)) {
        for (const [keyId, recordData] of Object.entries(keysData)) {
          const storageKey = this.createStorageKey(date, keyId);
          this.usage.set(storageKey, {
            keyId,
            date,
            requestCount: recordData.requestCount,
            inputTokens: recordData.inputTokens,
            outputTokens: recordData.outputTokens,
            lastRequest: new Date(recordData.lastRequest),
          });
        }
      }

      logger.debug('Loaded usage data from storage', {
        recordCount: this.usage.size,
        lastSync: parsed.data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load usage data from storage, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Graceful shutdown - persist and stop sync.
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicSync();
    await this.persist();
    logger.info('UsageTracker shutdown complete');
  }

  /**
   * Check if the tracker is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the storage file path.
   */
  getStoragePath(): string {
    return this.usageDataPath;
  }

  /**
   * Get the total number of stored records.
   */
  getRecordCount(): number {
    return this.usage.size;
  }
}

/**
 * Create a new UsageTracker instance.
 *
 * @param config - Configuration options
 * @returns A new UsageTracker instance
 */
export function createUsageTracker(config?: UsageTrackerConfig): UsageTracker {
  return new UsageTracker(config);
}