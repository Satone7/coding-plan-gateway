/**
 * PlanUsageTracker - Tracks and persists daily usage per plan.
 * Implements daily aggregation with periodic persistence and 90-day retention.
 *
 * @module services/plan-usage-tracker
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import type {
  PlanUsageRecord,
  PlanUsageReport,
  DailyPlanUsage,
  UsageAdjustmentHistory,
  PlanUsageDataStorage,
  PlanUsageRecordData,
  AdjustmentHistoryStorage,
  AdjustmentRecordData,
} from '@/types';
import { planUsageDataStorageSchema, adjustmentHistoryStorageSchema } from '@/types';
import { logger } from '@/utils/logger';
import { PLAN_USAGE_DEFAULTS } from '@/config/defaults';

/**
 * PlanUsageTracker configuration.
 */
export interface PlanUsageTrackerConfig {
  /** Path to plan usage data file */
  planUsageDataPath?: string;
  /** Path to adjustment history file */
  adjustmentHistoryPath?: string;
  /** Interval for periodic persistence in milliseconds */
  syncIntervalMs?: number;
  /** Number of days to retain usage records */
  retentionDays?: number;
}

/**
 * Internal storage key format: `${date}:${planId}`
 */
type StorageKey = string;

/**
 * Plan info needed for report generation.
 */
interface PlanInfo {
  id: number;
  name: string;
  quota: {
    limit: number;
    period: 'daily' | 'monthly' | 'total';
  };
}

/**
 * Result of usage adjustment operation.
 */
export interface AdjustmentResult {
  adjustmentId: string;
  planId: number;
  oldValue: number;
  newValue: number;
  warning?: string;
}

/**
 * PlanUsageTracker - Manages daily usage tracking per plan with persistence.
 *
 * @example
 * ```typescript
 * const tracker = createPlanUsageTracker({ planUsageDataPath: './plan-usage-data.json' });
 * await tracker.initialize();
 *
 * // Track a request
 * tracker.incrementDailyUsage('plan-id-123');
 *
 * // Get usage report
 * const report = tracker.getUsageReport('plan-id-123', planInfo, '2026-03-01', '2026-03-25');
 * ```
 */
export class PlanUsageTracker {
  private readonly planUsageDataPath: string;
  private readonly adjustmentHistoryPath: string;
  private readonly syncIntervalMs: number;
  private readonly retentionDays: number;
  private readonly usage: Map<StorageKey, PlanUsageRecord> = new Map();
  private readonly adjustments: UsageAdjustmentHistory[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  /**
   * Create a new PlanUsageTracker.
   *
   * @param config - Configuration options
   */
  constructor(config: PlanUsageTrackerConfig = {}) {
    this.planUsageDataPath = resolve(
      config.planUsageDataPath ?? PLAN_USAGE_DEFAULTS.planUsageDataPath
    );
    this.adjustmentHistoryPath = resolve(
      config.adjustmentHistoryPath ?? PLAN_USAGE_DEFAULTS.adjustmentHistoryPath
    );
    this.syncIntervalMs = config.syncIntervalMs ?? PLAN_USAGE_DEFAULTS.syncIntervalMs;
    this.retentionDays = config.retentionDays ?? PLAN_USAGE_DEFAULTS.retentionDays;
  }

  /**
   * Initialize the tracker by loading existing data.
   */
  async initialize(): Promise<void> {
    await Promise.all([this.loadUsageData(), this.loadAdjustmentHistory()]);
    this.cleanupOldRecords();
    this.initialized = true;
    logger.info('PlanUsageTracker initialized', {
      recordCount: this.usage.size,
      adjustmentCount: this.adjustments.length,
      storagePath: this.planUsageDataPath,
    });
  }

  /**
   * Get today's date in YYYY-MM-DD format.
   */
  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /**
   * Create a storage key from date and planId.
   */
  private createStorageKey(date: string, planId: number): StorageKey {
    return `${date}:${planId}`;
  }

  /**
   * Get or create a usage record for a specific date and plan.
   *
   * @param planId - The plan ID
   * @param date - The date (YYYY-MM-DD), defaults to today
   * @returns The usage record
   */
  private getOrCreateRecord(planId: number, date: string = this.getTodayDate()): PlanUsageRecord {
    const storageKey = this.createStorageKey(date, planId);
    let record = this.usage.get(storageKey);

    if (!record) {
      record = {
        planId,
        date,
        requestCount: 0,
        lastUpdated: new Date(),
      };
      this.usage.set(storageKey, record);
    }

    return record;
  }

  /**
   * Increment the request count for a plan on the current day.
   *
   * @param planId - The plan ID
   */
  incrementDailyUsage(planId: number): void {
    const record = this.getOrCreateRecord(planId);
    record.requestCount += 1;
    record.lastUpdated = new Date();

    logger.debug('Plan daily usage incremented', {
      planId,
      date: record.date,
      requestCount: record.requestCount,
    });
  }

  /**
   * Decrement the request count for a plan on the current day.
   *
   * @param planId - The plan ID
   */
  decrementDailyUsage(planId: number): void {
    const record = this.getOrCreateRecord(planId);
    record.requestCount = Math.max(0, record.requestCount - 1);
    record.lastUpdated = new Date();

    logger.debug('Plan daily usage decremented', {
      planId,
      date: record.date,
      requestCount: record.requestCount,
    });
  }

  /**
   * Get the total usage for a plan across all records.
   *
   * @param planId - The plan ID
   * @param from - Optional start date filter
   * @param to - Optional end date filter
   * @returns Total request count
   */
  getTotalUsage(planId: number, from?: string, to?: string): number {
    let total = 0;

    for (const record of this.usage.values()) {
      if (record.planId !== planId) {
        continue;
      }
      if (from && record.date < from) {
        continue;
      }
      if (to && record.date > to) {
        continue;
      }
      total += record.requestCount;
    }

    return total;
  }

  /**
   * Get usage report for a specific plan.
   *
   * @param planId - The plan ID
   * @param planInfo - Plan information for report generation
   * @param from - Start date (YYYY-MM-DD)
   * @param to - End date (YYYY-MM-DD)
   * @returns Usage report or undefined if no data
   */
  getUsageReport(
    planId: number,
    planInfo: PlanInfo,
    from?: string,
    to?: string
  ): PlanUsageReport | undefined {
    // Collect records for this plan within date range
    const records: PlanUsageRecord[] = [];

    for (const record of this.usage.values()) {
      if (record.planId !== planId) {
        continue;
      }
      if (from && record.date < from) {
        continue;
      }
      if (to && record.date > to) {
        continue;
      }
      records.push(record);
    }

    // Sort by date
    records.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate totals
    const totalRequests = records.reduce((sum, r) => sum + r.requestCount, 0);
    const remaining = planInfo.quota.limit - totalRequests;
    const percentage = planInfo.quota.limit > 0
      ? Math.round((totalRequests / planInfo.quota.limit) * 100)
      : 0;

    // Build daily breakdown
    const dailyBreakdown: DailyPlanUsage[] = records.map((r) => ({
      date: r.date,
      requestCount: r.requestCount,
    }));

    // Calculate reset date
    const resetAt = this.calculateResetAt(planInfo.quota.period);

    return {
      planId,
      planName: planInfo.name,
      totalRequests,
      limit: planInfo.quota.limit,
      remaining,
      percentage,
      dateRange: {
        start: from ?? (records[0]?.date ?? this.getTodayDate()),
        end: to ?? (records[records.length - 1]?.date ?? this.getTodayDate()),
      },
      dailyBreakdown,
      quotaPeriod: planInfo.quota.period,
      resetAt,
    };
  }

  /**
   * Calculate the next reset date based on quota period.
   */
  private calculateResetAt(period: 'daily' | 'monthly' | 'total'): Date | null {
    if (period === 'total') {
      return null;
    }

    const now = new Date();

    if (period === 'daily') {
      // Next midnight UTC
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      return tomorrow;
    }

    if (period === 'monthly') {
      // First day of next month at midnight UTC
      const nextMonth = new Date(now);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      nextMonth.setUTCDate(1);
      nextMonth.setUTCHours(0, 0, 0, 0);
      return nextMonth;
    }

    return null;
  }

  /**
   * Adjust usage for a plan.
   *
   * @param planId - The plan ID
   * @param newValue - The new usage value
   * @param limit - The plan's quota limit (for percentage warning)
   * @param adjustmentType - How the adjustment was specified
   * @param adjustmentValue - The original input value
   * @returns Adjustment result
   */
  adjustUsage(
    planId: number,
    newValue: number,
    limit: number,
    adjustmentType: 'count' | 'percent',
    adjustmentValue: number
  ): AdjustmentResult {
    // Get current total usage
    const oldValue = this.getTotalUsage(planId);

    // Create adjustment record
    const adjustmentId = randomUUID();
    const adjustment: UsageAdjustmentHistory = {
      id: adjustmentId,
      planId,
      timestamp: new Date(),
      oldValue,
      newValue,
      adjustmentType,
      adjustmentValue,
    };

    this.adjustments.push(adjustment);

    // Update today's record with the delta
    const delta = newValue - oldValue;
    const todayRecord = this.getOrCreateRecord(planId);
    todayRecord.requestCount = Math.max(0, todayRecord.requestCount + delta);
    todayRecord.lastUpdated = new Date();

    logger.info('Plan usage adjusted', {
      planId,
      adjustmentId,
      oldValue,
      newValue,
      delta,
    });

    // Generate warning if exceeds limit
    let warning: string | undefined;
    if (newValue > limit) {
      const percentage = limit > 0 ? Math.round((newValue / limit) * 100) : 0;
      warning = `Usage exceeds quota limit of ${limit}. Current usage: ${newValue} (${percentage}%)`;
    }

    return {
      adjustmentId,
      planId,
      oldValue,
      newValue,
      warning,
    };
  }

  /**
   * Get adjustment history for a plan.
   *
   * @param planId - The plan ID (optional, returns all if not provided)
   * @param limit - Maximum number of records to return
   * @returns Array of adjustment records
   */
  getAdjustmentHistory(planId?: number, limit: number = 20): UsageAdjustmentHistory[] {
    let filtered = this.adjustments;

    if (planId) {
      filtered = filtered.filter((a) => a.planId === planId);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return filtered.slice(0, limit);
  }

  /**
   * Cleanup records older than retention period.
   */
  private cleanupOldRecords(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]!;

    let removedCount = 0;

    for (const [key, record] of this.usage) {
      if (record.date < cutoffStr) {
        this.usage.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info('Cleaned up old plan usage records', {
        removedCount,
        cutoffDate: cutoffStr,
      });
    }
  }

  /**
   * Start periodic persistence.
   */
  startPeriodicSync(): void {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = setInterval(() => {
      this.persist().catch((error) => {
        logger.error('Periodic plan usage sync failed', error as Error);
      });
    }, this.syncIntervalMs);

    logger.info('Periodic plan usage sync started', {
      intervalMs: this.syncIntervalMs,
    });
  }

  /**
   * Stop periodic persistence.
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('Periodic plan usage sync stopped');
    }
  }

  /**
   * Persist data to files.
   */
  async persist(): Promise<void> {
    await Promise.all([
      this.persistUsageData(),
      this.persistAdjustmentHistory(),
    ]);
  }

  /**
   * Persist usage data to file.
   */
  private async persistUsageData(): Promise<void> {
    // Build storage structure
    const recordsByDate: Record<string, Record<string, PlanUsageRecordData>> = {};

    for (const [storageKey, record] of this.usage) {
      const [date, planId] = storageKey.split(':') as [string, string];

      if (!recordsByDate[date]) {
        recordsByDate[date] = {};
      }

      recordsByDate[date][planId] = {
        requestCount: record.requestCount,
        lastUpdated: record.lastUpdated.toISOString(),
      };
    }

    const data: PlanUsageDataStorage = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      records: recordsByDate,
    };

    // Ensure directory exists
    const dir = dirname(this.planUsageDataPath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.planUsageDataPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.planUsageDataPath);

    logger.debug('Plan usage data persisted', {
      path: this.planUsageDataPath,
      dateCount: Object.keys(recordsByDate).length,
    });
  }

  /**
   * Persist adjustment history to file.
   */
  private async persistAdjustmentHistory(): Promise<void> {
    const adjustmentData: AdjustmentRecordData[] = this.adjustments.map((a) => ({
      id: a.id,
      planId: a.planId,
      timestamp: a.timestamp.toISOString(),
      oldValue: a.oldValue,
      newValue: a.newValue,
      adjustmentType: a.adjustmentType,
      adjustmentValue: a.adjustmentValue,
    }));

    const data: AdjustmentHistoryStorage = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      adjustments: adjustmentData,
    };

    // Ensure directory exists
    const dir = dirname(this.adjustmentHistoryPath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.adjustmentHistoryPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.adjustmentHistoryPath);

    logger.debug('Adjustment history persisted', {
      path: this.adjustmentHistoryPath,
      adjustmentCount: adjustmentData.length,
    });
  }

  /**
   * Load usage data from file.
   */
  private async loadUsageData(): Promise<void> {
    try {
      await access(this.planUsageDataPath, constants.R_OK);
    } catch {
      logger.debug('Plan usage data file not found, starting fresh', {
        path: this.planUsageDataPath,
      });
      return;
    }

    try {
      const content = await readFile(this.planUsageDataPath, 'utf-8');
      const data = JSON.parse(content) as PlanUsageDataStorage;

      // Validate the storage format
      const parsed = planUsageDataStorageSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn('Invalid plan usage data storage format, starting fresh', {
          errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        return;
      }

      // Load records into memory
      for (const [date, plansData] of Object.entries(parsed.data.records)) {
        for (const [planIdStr, recordData] of Object.entries(plansData)) {
          // Convert planId from string key to number
          const planId = parseInt(planIdStr, 10);
          if (isNaN(planId)) {
            logger.warn('Skipping invalid planId in plan usage data', { planIdStr, date });
            continue;
          }

          const storageKey = this.createStorageKey(date, planId);
          this.usage.set(storageKey, {
            planId,
            date,
            requestCount: recordData.requestCount,
            lastUpdated: new Date(recordData.lastUpdated),
          });
        }
      }

      logger.debug('Loaded plan usage data from storage', {
        recordCount: this.usage.size,
        lastSync: parsed.data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load plan usage data from storage, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load adjustment history from file.
   */
  private async loadAdjustmentHistory(): Promise<void> {
    try {
      await access(this.adjustmentHistoryPath, constants.R_OK);
    } catch {
      logger.debug('Adjustment history file not found, starting fresh', {
        path: this.adjustmentHistoryPath,
      });
      return;
    }

    try {
      const content = await readFile(this.adjustmentHistoryPath, 'utf-8');
      const data = JSON.parse(content) as AdjustmentHistoryStorage;

      // Validate the storage format
      const parsed = adjustmentHistoryStorageSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn('Invalid adjustment history storage format, starting fresh', {
          errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        return;
      }

      // Load adjustments into memory
      for (const adjData of parsed.data.adjustments) {
        this.adjustments.push({
          id: adjData.id,
          planId: adjData.planId,
          timestamp: new Date(adjData.timestamp),
          oldValue: adjData.oldValue,
          newValue: adjData.newValue,
          adjustmentType: adjData.adjustmentType,
          adjustmentValue: adjData.adjustmentValue,
        });
      }

      logger.debug('Loaded adjustment history from storage', {
        adjustmentCount: this.adjustments.length,
        lastSync: parsed.data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load adjustment history from storage, starting fresh', {
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
    logger.info('PlanUsageTracker shutdown complete');
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
    return this.planUsageDataPath;
  }

  /**
   * Get the total number of stored records.
   */
  getRecordCount(): number {
    return this.usage.size;
  }

  /**
   * Get the total number of adjustment records.
   */
  getAdjustmentCount(): number {
    return this.adjustments.length;
  }
}

/**
 * Create a new PlanUsageTracker instance.
 *
 * @param config - Configuration options
 * @returns A new PlanUsageTracker instance
 */
export function createPlanUsageTracker(config?: PlanUsageTrackerConfig): PlanUsageTracker {
  return new PlanUsageTracker(config);
}