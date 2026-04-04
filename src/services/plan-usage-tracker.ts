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
import lockfile from 'proper-lockfile';
import type {
  PlanUsageRecord,
  PlanUsageReport,
  DailyPlanUsage,
  UsageAdjustmentHistory,
  PlanUsageDataStorage,
  PlanUsageRecordData,
  AdjustmentHistoryStorage,
  AdjustmentRecordData,
  PlanInfo,
} from '@/types';
import { planUsageDataStorageSchema, adjustmentHistoryStorageSchema } from '@/types';
import { logger } from '@/utils/logger';
import { PLAN_USAGE_DEFAULTS } from '@/config/defaults';
import { calculateEffectiveExpiration } from '@/utils/expiration';
import type { QuotaPeriod } from '@/types/coding-plan';

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
   * @param amount - The amount to increment (default: 1)
   */
  incrementDailyUsage(planId: number, amount: number = 1): void {
    const record = this.getOrCreateRecord(planId);
    record.requestCount += amount;
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
   * @param amount - The amount to decrement (default: 1)
   */
  decrementDailyUsage(planId: number, amount: number = 1): void {
    const record = this.getOrCreateRecord(planId);
    record.requestCount = Math.max(0, record.requestCount - amount);
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
   * Get usage data for QuotaManager integration.
   * Provides the current usage value and the plan's quota configuration.
   * This serves as the single source of truth for quota-based routing decisions.
   *
   * @param planId - The plan ID
   * @returns Usage data for the plan, or undefined if no usage recorded
   */
  getUsageForQuotaManager(planId: number): { used: number; lastUpdated: Date } | undefined {
    const used = this.getTotalUsage(planId);
    const records = Array.from(this.usage.values())
      .filter(r => r.planId === planId)
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());

    return {
      used,
      lastUpdated: records[0]?.lastUpdated ?? new Date(),
    };
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

    // Calculate reset date using the plan's expiresOn/expiresAt configuration
    const resetAt = this.calculateResetDate(planInfo);

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
   * Accepts both the new structured QuotaPeriod and legacy string periods.
   * Respects expiresOn and expiresAt from plan configuration (for legacy and monthly).
   *
   * @param period - The quota period (new structured type or legacy string)
   * @param expiresOn - Optional day of month (1-31) for custom reset
   * @param expiresAt - Optional ISO 8601 datetime for absolute expiration
   * @returns The next reset date, or null for total period
   */
  calculateResetAt(
    period: QuotaPeriod | 'daily' | 'monthly' | 'total',
    expiresOn?: number,
    expiresAt?: string
  ): Date | null {
    // Handle structured QuotaPeriod
    if (typeof period === 'object') {
      if (period.type === 'total') {
        return null;
      }

      if (period.type === '5h') {
        const now = new Date();
        return new Date(now.getTime() + period.windowHours * 60 * 60 * 1000);
      }

      if (period.type === 'weekly') {
        const now = new Date();
        const targetJsDay = period.weekday % 7; // ISO -> JS day
        const currentJsDay = now.getUTCDay();
        let daysUntilTarget = targetJsDay - currentJsDay;
        if (daysUntilTarget <= 0) {
          daysUntilTarget += 7;
        }
        const nextReset = new Date(now);
        nextReset.setUTCDate(nextReset.getUTCDate() + daysUntilTarget);
        nextReset.setUTCHours(0, 0, 0, 0);
        return nextReset;
      }

      if (period.type === 'monthly') {
        // If expiresAt is provided at the plan level, use it
        if (expiresAt !== undefined) {
          const expiration = new Date(expiresAt);
          if (!isNaN(expiration.getTime())) {
            return new Date(
              expiration.getFullYear(),
              expiration.getMonth(),
              expiration.getDate(),
              0, 0, 0, 0
            );
          }
        }

        // Use the period's own expiresOn, or fallback to parameter
        const targetDay = period.expiresOn ?? expiresOn ?? 1;
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth();
        const currentDay = now.getUTCDate();

        const daysInCurrentMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
        const clampedDay = Math.min(targetDay, daysInCurrentMonth);

        if (currentDay < clampedDay) {
          return new Date(Date.UTC(currentYear, currentMonth, clampedDay, 0, 0, 0, 0));
        }

        let nextMonth = currentMonth + 1;
        let nextYear = currentYear;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear++;
        }
        const daysInNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
        const nextClampedDay = Math.min(targetDay, daysInNextMonth);
        return new Date(Date.UTC(nextYear, nextMonth, nextClampedDay, 0, 0, 0, 0));
      }

      return null;
    }

    // Handle legacy string period (backward compatibility)
    if (period === 'total') {
      return null;
    }

    // If expiresAt or expiresOn is configured, calculate the next reset date
    if (expiresOn !== undefined || expiresAt !== undefined) {
      const expiration = calculateEffectiveExpiration({ expiresOn, expiresAt });

      if (expiration) {
        // Return midnight of the expiration day
        return new Date(
          expiration.getFullYear(),
          expiration.getMonth(),
          expiration.getDate(),
          0, 0, 0, 0
        );
      }
    }

    // Fallback to default behavior
    const now = new Date();

    if (period === 'daily') {
      // Next midnight local time
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return tomorrow;
    }

    if (period === 'monthly') {
      // First day of next month at midnight local time
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);
      nextMonth.setHours(0, 0, 0, 0);
      return nextMonth;
    }

    return null;
  }

  /**
   * Calculate the reset date for a plan based on its quota configuration.
   * This is a convenience method that extracts the relevant fields from a PlanInfo object.
   * Supports both new structured QuotaPeriod and legacy string period.
   *
   * @param planInfo - The plan information containing quota configuration
   * @returns The next reset date, or null for total period
   */
  calculateResetDate(planInfo: PlanInfo): Date | null {
    // If period is already a structured object, pass it directly
    if (typeof planInfo.quota.period === 'object') {
      return this.calculateResetAt(
        planInfo.quota.period,
        planInfo.quota.expiresOn,
        planInfo.quota.expiresAt
      );
    }

    // Legacy string period
    return this.calculateResetAt(
      planInfo.quota.period,
      planInfo.quota.expiresOn,
      planInfo.quota.expiresAt
    );
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
   * Uses file locking to prevent concurrent write conflicts with CLI or other processes.
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

    // Ensure file exists for locking (proper-lockfile requires file to exist)
    try {
      await access(this.planUsageDataPath, constants.F_OK);
    } catch {
      // File doesn't exist, create empty file
      await writeFile(this.planUsageDataPath, '{}', 'utf-8');
    }

    // Use file locking to prevent concurrent writes
    const release = await lockfile.lock(this.planUsageDataPath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    try {
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
    } finally {
      await release();
    }
  }

  /**
   * Persist adjustment history to file.
   * Uses file locking to prevent concurrent write conflicts.
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

    // Ensure file exists for locking (proper-lockfile requires file to exist)
    try {
      await access(this.adjustmentHistoryPath, constants.F_OK);
    } catch {
      // File doesn't exist, create empty file
      await writeFile(this.adjustmentHistoryPath, '{}', 'utf-8');
    }

    // Use file locking to prevent concurrent writes
    const release = await lockfile.lock(this.adjustmentHistoryPath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    try {
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
    } finally {
      await release();
    }
  }

  /**
   * Load usage data from file.
   * Uses file locking to prevent concurrent read/write conflicts with CLI or other processes.
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

    // Use file locking to prevent concurrent read/write conflicts
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.planUsageDataPath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });
    } catch (lockError) {
      // If locking fails, proceed without lock (file may not exist yet)
      logger.debug('Could not acquire lock for reading plan usage data, proceeding without lock', {
        error: lockError instanceof Error ? lockError.message : String(lockError),
      });
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
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Load adjustment history from file.
   * Uses file locking to prevent concurrent read/write conflicts.
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

    // Use file locking to prevent concurrent read/write conflicts
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.adjustmentHistoryPath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });
    } catch (lockError) {
      // If locking fails, proceed without lock (file may not exist yet)
      logger.debug('Could not acquire lock for reading adjustment history, proceeding without lock', {
        error: lockError instanceof Error ? lockError.message : String(lockError),
      });
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
    } finally {
      if (release) {
        await release();
      }
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
   * Reload usage data from disk.
   * This is useful when an external process (like CLI) has modified the data file.
   */
  async reload(): Promise<void> {
    // Clear existing data
    this.usage.clear();
    this.adjustments.length = 0;

    // Reload from disk
    await this.loadUsageData();
    await this.loadAdjustmentHistory();

    logger.debug('PlanUsageTracker reloaded from disk', {
      recordCount: this.usage.size,
      adjustmentCount: this.adjustments.length,
      storagePath: this.planUsageDataPath,
    });
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

  /**
   * Reset all usage records for a plan.
   * This is called when a plan's quota expires (on expiresOn date).
   *
   * @param planId - The plan ID to reset
   * @returns The number of records that were reset
   */
  resetPlanUsage(planId: number, beforeDate?: string): number {
    let resetCount = 0;
    const keysToDelete: StorageKey[] = [];

    // Find all records for this plan
    for (const [key, record] of this.usage) {
      if (record.planId === planId) {
        if (!beforeDate || record.date < beforeDate) {
          keysToDelete.push(key);
          resetCount++;
        }
      }
    }

    // Delete the records
    for (const key of keysToDelete) {
      this.usage.delete(key);
    }

    if (resetCount > 0) {
      logger.info('Plan usage reset', {
        planId,
        resetCount,
        beforeDate,
      });
    }

    return resetCount;
  }

  /**
   * Check and reset expired plans.
   * This method is called by the scheduler to reset plans whose expiration date has passed.
   *
   * @param plans - Array of plans with their expiration configuration
   * @returns Array of plan IDs that were reset
   */
  checkAndResetExpiredPlans(
    plans: Array<{
      id: number;
      quota: { period: 'daily' | 'monthly' | 'total'; expiresOn?: number; expiresAt?: string };
    }>
  ): number[] {
    const now = new Date();
    const resetPlanIds: number[] = [];
    const todayStr = now.toISOString().split('T')[0]!;

    for (const plan of plans) {
      if (plan.quota.period === 'total') {
        continue;
      }

      let cycleStartDateStr: string | null = null;
      let shouldResetAll = false;

      // Check if the plan has a fixed expiration configured
      if (plan.quota.expiresAt) {
        const expiration = new Date(plan.quota.expiresAt);
        if (!isNaN(expiration.getTime())) {
          const expirationMidnight = new Date(
            expiration.getFullYear(),
            expiration.getMonth(),
            expiration.getDate(),
            0, 0, 0, 0
          );
          if (now >= expirationMidnight) {
            // For one-time expiration, reset all usage (original behavior)
            shouldResetAll = true;
          }
        }
      } else {
        // Handle periodic resets (daily/monthly)
        if (plan.quota.period === 'daily') {
          cycleStartDateStr = todayStr;
        } else if (plan.quota.period === 'monthly') {
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth();
          const currentDay = now.getDate();

          const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
          const targetDay = plan.quota.expiresOn !== undefined 
            ? Math.min(plan.quota.expiresOn, daysInCurrentMonth)
            : 1;

          if (currentDay >= targetDay) {
            // Cycle started this month
            cycleStartDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
          } else {
            // Cycle started last month
            let lastMonth = currentMonth - 1;
            let lastMonthYear = currentYear;
            if (lastMonth < 0) {
              lastMonth = 11;
              lastMonthYear--;
            }
            const daysInLastMonth = new Date(lastMonthYear, lastMonth + 1, 0).getDate();
            const lastMonthTargetDay = plan.quota.expiresOn !== undefined 
              ? Math.min(plan.quota.expiresOn, daysInLastMonth)
              : 1;
            
            cycleStartDateStr = `${lastMonthYear}-${String(lastMonth + 1).padStart(2, '0')}-${String(lastMonthTargetDay).padStart(2, '0')}`;
          }
        }
      }

      if (!shouldResetAll && !cycleStartDateStr) {
        continue;
      }

      const resetCount = this.resetPlanUsage(plan.id, shouldResetAll ? undefined : cycleStartDateStr!);
      if (resetCount > 0) {
        resetPlanIds.push(plan.id);
      }
    }

    return resetPlanIds;
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