/**
 * BalanceHistoryStore - Persists hourly OHLC candles of account balances
 * for balance-type plans (providers whose usage adapter returns
 * `summary.mode === 'balance'`, e.g. DeepSeek).
 *
 * The 60s usage poller feeds every observed balance sample into record();
 * samples are aggregated into 1-hour candles (open = first sample of the
 * hour, close = last, high/low = extremes) keyed `planKey:hourStartMs`
 * and persisted to disk so the dashboard can chart balance over time
 * across restarts. Records are retained for a rolling window
 * (default 90 days).
 */

import { readFile, writeFile, access, mkdir, rename } from 'fs/promises';
import { dirname, resolve } from 'path';
import { logger } from '@/utils/logger';

/** One 1h balance candle */
export interface BalanceCandle {
  /** Hour bucket start, unix ms */
  t: number;
  /** Balance at the first sample of the hour */
  o: number;
  /** Maximum balance observed in the hour */
  h: number;
  /** Minimum balance observed in the hour */
  l: number;
  /** Balance at the last sample of the hour */
  c: number;
  /** Number of samples aggregated into this candle */
  n: number;
}

/** Persisted candle with plan attribution (t is duplicated from the key) */
interface StoredCandle extends BalanceCandle {
  planKey: string;
  planName: string;
  providerId?: string;
  currency?: string;
}

interface BalanceHistoryFile {
  version: string;
  lastUpdated: string;
  /** `${planKey}:${hourStartMs}` -> candle */
  candles: Record<string, StoredCandle>;
}

export interface BalanceHistoryStoreConfig {
  historyPath?: string;
  retentionDays?: number;
}

export const BALANCE_HISTORY_DEFAULTS = {
  historyPath: './data/balance-history.json',
  retentionDays: 90,
} as const;

/** Candle series for one balance-type plan */
export interface BalancePlanSeries {
  planKey: string;
  planName: string;
  providerId?: string;
  currency?: string;
  candles: BalanceCandle[];
}

const HOUR_MS = 3_600_000;

export class BalanceHistoryStore {
  private readonly historyPath: string;
  private readonly retentionDays: number;
  private candles: Map<string, StoredCandle> = new Map();
  private initialized = false;
  private dirty = false;

  constructor(config: BalanceHistoryStoreConfig = {}) {
    this.historyPath = resolve(config.historyPath ?? BALANCE_HISTORY_DEFAULTS.historyPath);
    this.retentionDays = config.retentionDays ?? BALANCE_HISTORY_DEFAULTS.retentionDays;
  }

  /** Load existing candles from disk (tolerates a missing/corrupt file) */
  async initialize(): Promise<void> {
    await this.load();
    this.cleanupOldCandles();
    this.initialized = true;
    logger.info('BalanceHistoryStore initialized', {
      candleCount: this.candles.size,
      storagePath: this.historyPath,
      retentionDays: this.retentionDays,
    });
  }

  /**
   * Fold one observed balance sample into its hourly candle.
   * Called from the usage-API poller for balance-type plans.
   */
  record(entry: {
    planKey: string;
    planName: string;
    providerId?: string;
    currency?: string;
    balance: number;
    /** Sample time; injectable for tests, defaults to now */
    at?: number | string | Date;
  }): void {
    if (!Number.isFinite(entry.balance)) {
      return;
    }
    const atMs = entry.at === undefined
      ? Date.now()
      : entry.at instanceof Date
        ? entry.at.getTime()
        : new Date(entry.at).getTime();
    if (!Number.isFinite(atMs)) {
      return;
    }
    const bucket = Math.floor(atMs / HOUR_MS) * HOUR_MS;
    const key = `${entry.planKey}:${bucket}`;
    const existing = this.candles.get(key);
    if (existing) {
      existing.h = Math.max(existing.h, entry.balance);
      existing.l = Math.min(existing.l, entry.balance);
      existing.c = entry.balance;
      existing.n += 1;
      // keep the latest attribution in case the plan was renamed/retagged
      existing.planName = entry.planName;
      existing.providerId = entry.providerId;
      existing.currency = entry.currency ?? existing.currency;
    } else {
      this.candles.set(key, {
        planKey: entry.planKey,
        planName: entry.planName,
        providerId: entry.providerId,
        currency: entry.currency,
        t: bucket,
        o: entry.balance,
        h: entry.balance,
        l: entry.balance,
        c: entry.balance,
        n: 1,
      });
    }
    this.dirty = true;
  }

  /**
   * Per-plan candle series covering the trailing `hours` (default 168 = 7
   * days) ending at `to`. Hours with no samples simply have no candle —
   * the chart draws gaps by time slot instead of inventing flat candles.
   */
  query(options: { hours?: number; planKey?: string; to?: number } = {}): {
    hours: number;
    from: number;
    to: number;
    plans: BalancePlanSeries[];
  } {
    const to = options.to ?? Date.now();
    const hours = Math.max(1, Math.min(options.hours ?? 168, this.retentionDays * 24));
    const from = Math.floor(to / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS;

    const byPlan = new Map<string, BalancePlanSeries>();
    for (const candle of this.candles.values()) {
      if (options.planKey && candle.planKey !== options.planKey) {
        continue;
      }
      if (candle.t < from || candle.t > to) {
        continue;
      }
      const series = byPlan.get(candle.planKey) ?? {
        planKey: candle.planKey,
        planName: candle.planName,
        providerId: candle.providerId,
        currency: candle.currency,
        candles: [],
      };
      // keep the freshest attribution for the series header
      if (!series.candles.length || candle.t >= (series.candles[series.candles.length - 1]!.t)) {
        series.planName = candle.planName;
        series.providerId = candle.providerId ?? series.providerId;
        series.currency = candle.currency ?? series.currency;
      }
      series.candles.push({
        t: candle.t,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        n: candle.n,
      });
      byPlan.set(candle.planKey, series);
    }

    const plans = [...byPlan.values()]
      .map((series) => {
        series.candles.sort((a, b) => a.t - b.t);
        return series;
      })
      .sort((a, b) => a.planName.localeCompare(b.planName));

    return { hours, from, to, plans };
  }

  /** Persist to disk if anything changed since the last write */
  async persist(): Promise<void> {
    if (!this.initialized || !this.dirty) {
      return;
    }
    const data: BalanceHistoryFile = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      candles: Object.fromEntries(this.candles),
    };
    await mkdir(dirname(this.historyPath), { recursive: true });
    const tempPath = `${this.historyPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tempPath, this.historyPath);
    this.dirty = false;
    logger.debug('Balance history persisted', {
      candleCount: this.candles.size,
      storagePath: this.historyPath,
    });
  }

  /** Drop candles older than the retention window */
  private cleanupOldCandles(): void {
    const cutoff = Date.now() - this.retentionDays * 24 * HOUR_MS;
    let removed = 0;
    for (const [key, candle] of this.candles) {
      if (candle.t < cutoff) {
        this.candles.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      logger.info('Pruned old balance candles', { removed, cutoff });
    }
  }

  private async load(): Promise<void> {
    try {
      await access(this.historyPath);
    } catch {
      return; // no file yet — start empty
    }
    try {
      const raw = await readFile(this.historyPath, 'utf-8');
      const parsed = JSON.parse(raw) as BalanceHistoryFile;
      this.candles = new Map(Object.entries(parsed.candles ?? {}));
      logger.debug('Balance history loaded', {
        candleCount: this.candles.size,
        storagePath: this.historyPath,
      });
    } catch (error) {
      logger.warn('Failed to load balance history, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.candles = new Map();
    }
  }
}

export function createBalanceHistoryStore(config?: BalanceHistoryStoreConfig): BalanceHistoryStore {
  return new BalanceHistoryStore(config);
}

// Module-level registry so the read-only dashboard routes can reach the
// active store without threading it through every route registration.
// Passing null unregisters (used by tests to isolate the singleton).
let activeStore: BalanceHistoryStore | null = null;

export function registerActiveBalanceHistoryStore(store: BalanceHistoryStore | null): void {
  activeStore = store;
}

export function getActiveBalanceHistoryStore(): BalanceHistoryStore | null {
  return activeStore;
}
