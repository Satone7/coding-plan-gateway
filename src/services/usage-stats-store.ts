/**
 * UsageStatsStore - Persists per-day, per-plan, per-model token statistics.
 *
 * Unlike the in-memory DashboardMetrics flow buffer (which resets on restart
 * and only covers the current process run), this store writes aggregated
 * token/request counters to disk so the dashboard can report on historical
 * usage across restarts. Records are keyed `YYYY-MM-DD:planId:model` and are
 * retained for a rolling window (default 90 days).
 */

import { readFile, writeFile, access, mkdir, rename } from 'fs/promises';
import { dirname, resolve } from 'path';
import { logger } from '@/utils/logger';

/** One aggregated counter cell for a day/plan/model combination */
export interface UsageStatRecord {
  date: string; // YYYY-MM-DD
  planId: number;
  planName: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface UsageStatsFile {
  version: string;
  lastUpdated: string;
  /** storage key -> record */
  records: Record<string, UsageStatRecord>;
}

export interface UsageStatsStoreConfig {
  statsPath?: string;
  retentionDays?: number;
}

export const USAGE_STATS_DEFAULTS = {
  statsPath: './data/usage-stats.json',
  retentionDays: 90,
} as const;

/** A single day bucket in a stats query result */
export interface UsageStatsDay {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class UsageStatsStore {
  private readonly statsPath: string;
  private readonly retentionDays: number;
  private records: Map<string, UsageStatRecord> = new Map();
  private initialized = false;
  private dirty = false;

  constructor(config: UsageStatsStoreConfig = {}) {
    this.statsPath = resolve(config.statsPath ?? USAGE_STATS_DEFAULTS.statsPath);
    this.retentionDays = config.retentionDays ?? USAGE_STATS_DEFAULTS.retentionDays;
  }

  /** Load existing records from disk (tolerates a missing/corrupt file) */
  async initialize(): Promise<void> {
    await this.load();
    this.cleanupOldRecords();
    this.initialized = true;
    logger.info('UsageStatsStore initialized', {
      recordCount: this.records.size,
      storagePath: this.statsPath,
      retentionDays: this.retentionDays,
    });
  }

  private createKey(date: string, planId: number, model: string): string {
    return `${date}:${planId}:${model}`;
  }

  /**
   * Add one completed request's usage to the aggregated counters.
   * Called from the onResponse hook for proxy endpoints.
   */
  record(entry: {
    planId: number;
    planName: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    date?: string; // injectable for tests; defaults to today
  }): void {
    const date = entry.date ?? this.getTodayDate();
    const key = this.createKey(date, entry.planId, entry.model);
    const existing = this.records.get(key);
    const total = entry.inputTokens + entry.outputTokens;
    if (existing) {
      existing.requests += 1;
      existing.inputTokens += entry.inputTokens;
      existing.outputTokens += entry.outputTokens;
      existing.totalTokens += total;
      // keep the latest planName in case it was renamed
      existing.planName = entry.planName;
    } else {
      this.records.set(key, {
        date,
        planId: entry.planId,
        planName: entry.planName,
        model: entry.model,
        requests: 1,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: total,
      });
    }
    this.dirty = true;
  }

  /** Today's date in YYYY-MM-DD (UTC) */
  private getTodayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Aggregate records into per-day totals and per-plan / per-model breakdowns
   * for a date range (inclusive). Missing `from`/`to` default to the full
   * retention window ending today.
   */
  query(from?: string, to?: string): {
    from: string;
    to: string;
    days: UsageStatsDay[];
    byPlan: Record<string, { requests: number; totalTokens: number; planId: number }>;
    byModel: Record<string, { requests: number; totalTokens: number }>;
  } {
    const toDate = to ?? this.getTodayDate();
    const fromDate = from ?? this.addDays(toDate, -(this.retentionDays - 1));

    const daysMap = new Map<string, UsageStatsDay>();
    const byPlan: Record<string, { requests: number; totalTokens: number; planId: number }> = {};
    const byModel: Record<string, { requests: number; totalTokens: number }> = {};

    for (const rec of this.records.values()) {
      if (rec.date < fromDate || rec.date > toDate) {continue;}

      const day = daysMap.get(rec.date) ?? {
        date: rec.date,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      day.requests += rec.requests;
      day.inputTokens += rec.inputTokens;
      day.outputTokens += rec.outputTokens;
      day.totalTokens += rec.totalTokens;
      daysMap.set(rec.date, day);

      const p = byPlan[rec.planName] ?? { requests: 0, totalTokens: 0, planId: rec.planId };
      p.requests += rec.requests;
      p.totalTokens += rec.totalTokens;
      p.planId = rec.planId;
      byPlan[rec.planName] = p;

      const m = byModel[rec.model] ?? { requests: 0, totalTokens: 0 };
      m.requests += rec.requests;
      m.totalTokens += rec.totalTokens;
      byModel[rec.model] = m;
    }

    // fill in a continuous day series so charts render gaps as zero
    const days: UsageStatsDay[] = [];
    for (let d = fromDate; d <= toDate; d = this.addDays(d, 1)) {
      days.push(
        daysMap.get(d) ?? { date: d, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      );
    }

    return { from: fromDate, to: toDate, days, byPlan, byModel };
  }

  /** Persist to disk if anything changed since the last write */
  async persist(): Promise<void> {
    if (!this.initialized || !this.dirty) {
      return;
    }
    const data: UsageStatsFile = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      records: Object.fromEntries(this.records),
    };
    await mkdir(dirname(this.statsPath), { recursive: true });
    const tempPath = `${this.statsPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tempPath, this.statsPath);
    this.dirty = false;
    logger.debug('Usage stats persisted', {
      recordCount: this.records.size,
      storagePath: this.statsPath,
    });
  }

  /** Drop records older than the retention window */
  private cleanupOldRecords(): void {
    const cutoff = this.addDays(this.getTodayDate(), -this.retentionDays);
    let removed = 0;
    for (const rec of this.records.values()) {
      if (rec.date < cutoff) {
        this.records.delete(this.createKey(rec.date, rec.planId, rec.model));
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      logger.info('Pruned old usage stats', { removed, cutoff });
    }
  }

  /** Add (or subtract) days to a YYYY-MM-DD date string */
  private addDays(date: string, days: number): string {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private async load(): Promise<void> {
    try {
      await access(this.statsPath);
    } catch {
      return; // no file yet — start empty
    }
    try {
      const raw = await readFile(this.statsPath, 'utf-8');
      const parsed = JSON.parse(raw) as UsageStatsFile;
      this.records = new Map(Object.entries(parsed.records ?? {}));
      logger.debug('Usage stats loaded', {
        recordCount: this.records.size,
        storagePath: this.statsPath,
      });
    } catch (error) {
      logger.warn('Failed to load usage stats, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.records = new Map();
    }
  }
}

export function createUsageStatsStore(config?: UsageStatsStoreConfig): UsageStatsStore {
  return new UsageStatsStore(config);
}

// Module-level registry so the read-only dashboard routes can reach the
// active store without threading it through every route registration.
let activeStore: UsageStatsStore | null = null;

export function registerActiveUsageStatsStore(store: UsageStatsStore): void {
  activeStore = store;
}

export function getActiveUsageStatsStore(): UsageStatsStore | null {
  return activeStore;
}
