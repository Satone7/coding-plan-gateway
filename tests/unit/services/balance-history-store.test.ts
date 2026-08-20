/**
 * Unit tests for BalanceHistoryStore — persisted hourly OHLC balance candles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { BalanceHistoryStore } from '@/services/balance-history-store';

const HOUR = 3_600_000;
// Fixed hour-aligned "now" so window math is deterministic: 2026-08-20T12:00:00Z
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const NOW_HOUR = NOW;

describe('BalanceHistoryStore', () => {
  let tempDir: string;
  let historyPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'balance-history-test-'));
    historyPath = join(tempDir, 'balance-history.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should fold samples within one hour into a single OHLC candle', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();

    store.record({ planKey: '1', planName: 'DeepSeek-A', currency: 'CNY', balance: 100, at: NOW });
    store.record({ planKey: '1', planName: 'DeepSeek-A', currency: 'CNY', balance: 110, at: NOW + 10 * 60_000 });
    store.record({ planKey: '1', planName: 'DeepSeek-A', currency: 'CNY', balance: 95, at: NOW + 20 * 60_000 });
    store.record({ planKey: '1', planName: 'DeepSeek-A', currency: 'CNY', balance: 105, at: NOW + 30 * 60_000 });

    const result = store.query({ to: NOW });
    expect(result.plans).toHaveLength(1);
    const candles = result.plans[0]!.candles;
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      t: NOW_HOUR,
      o: 100,
      h: 110,
      l: 95,
      c: 105,
      n: 4,
    });
  });

  it('should bucket samples from different hours into separate candles', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();

    store.record({ planKey: '1', planName: 'Plan', balance: 50, at: NOW });
    store.record({ planKey: '1', planName: 'Plan', balance: 48, at: NOW + HOUR });
    store.record({ planKey: '1', planName: 'Plan', balance: 60, at: NOW + 2 * HOUR });

    const result = store.query({ hours: 3, to: NOW + 2 * HOUR });
    const candles = result.plans[0]!.candles;
    expect(candles.map((c) => c.o)).toEqual([50, 48, 60]);
    expect(candles.map((c) => c.t)).toEqual([NOW_HOUR, NOW_HOUR + HOUR, NOW_HOUR + 2 * HOUR]);
    // a flat hour still has a valid candle: o=h=l=c
    expect(candles[1]).toMatchObject({ o: 48, h: 48, l: 48, c: 48, n: 1 });
  });

  it('should keep separate series per plan and sort candles by time', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();

    store.record({ planKey: '1', planName: 'Plan-One', providerId: 'deepseek', currency: 'CNY', balance: 10, at: NOW + HOUR });
    store.record({ planKey: '1', planName: 'Plan-One', providerId: 'deepseek', currency: 'CNY', balance: 12, at: NOW });
    store.record({ planKey: '2', planName: 'Plan-Two', currency: 'USD', balance: 7.5, at: NOW });

    const result = store.query({ to: NOW + HOUR });
    expect(result.plans.map((p) => p.planName)).toEqual(['Plan-One', 'Plan-Two']);
    const one = result.plans.find((p) => p.planKey === '1')!;
    expect(one.providerId).toBe('deepseek');
    expect(one.currency).toBe('CNY');
    expect(one.candles.map((c) => c.t)).toEqual([NOW_HOUR, NOW_HOUR + HOUR]);
  });

  it('should restrict the query to the trailing hours window', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();

    // one candle per hour for the last 10 hours
    for (let i = 0; i < 10; i++) {
      store.record({ planKey: '1', planName: 'Plan', balance: 100 - i, at: NOW - (9 - i) * HOUR });
    }

    const result = store.query({ hours: 3, to: NOW });
    expect(result.plans[0]!.candles).toHaveLength(3);
    expect(result.from).toBe(NOW_HOUR - 2 * HOUR);
    // last 3 hourly samples carry balances 93, 92, 91 (oldest → newest)
    expect(result.plans[0]!.candles.map((c) => c.o)).toEqual([93, 92, 91]);
  });

  it('should filter by planKey when given', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();
    store.record({ planKey: '1', planName: 'Plan-One', balance: 10, at: NOW });
    store.record({ planKey: '2', planName: 'Plan-Two', balance: 20, at: NOW });

    const result = store.query({ planKey: '2', to: NOW });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]!.planName).toBe('Plan-Two');
  });

  it('should ignore non-finite balances and invalid timestamps', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();
    store.record({ planKey: '1', planName: 'Plan', balance: NaN, at: NOW });
    store.record({ planKey: '1', planName: 'Plan', balance: 5, at: 'not-a-date' });
    expect(store.query({ to: NOW }).plans).toHaveLength(0);
  });

  it('should keep the latest plan attribution in candles', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();
    store.record({ planKey: '1', planName: 'Old-Name', currency: 'CNY', balance: 10, at: NOW });
    store.record({ planKey: '1', planName: 'New-Name', providerId: 'deepseek', balance: 11, at: NOW });

    const result = store.query({ to: NOW });
    expect(result.plans[0]!.planName).toBe('New-Name');
    expect(result.plans[0]!.providerId).toBe('deepseek');
  });

  it('should persist to disk and reload across instances', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();
    store.record({ planKey: '1', planName: 'Plan', currency: 'CNY', balance: 88.5, at: NOW });
    store.record({ planKey: '1', planName: 'Plan', currency: 'CNY', balance: 90, at: NOW + 60_000 });
    await store.persist();

    const raw = JSON.parse(await readFile(historyPath, 'utf-8'));
    expect(Object.keys(raw.candles)).toHaveLength(1);

    const store2 = new BalanceHistoryStore({ historyPath });
    await store2.initialize();
    const result = store2.query({ to: NOW });
    expect(result.plans[0]!.candles[0]).toMatchObject({ o: 88.5, c: 90, h: 90, l: 88.5, n: 2 });
  });

  it('should not write when nothing changed', async () => {
    const store = new BalanceHistoryStore({ historyPath });
    await store.initialize();
    await store.persist(); // no records → no file
    await expect(accessFails(historyPath)).resolves.toBe(true);
  });

  it('should tolerate a missing or corrupt file on initialize', async () => {
    const missing = new BalanceHistoryStore({ historyPath: join(tempDir, 'missing.json') });
    await expect(missing.initialize()).resolves.toBeUndefined();
    expect(missing.query({ to: NOW }).plans).toHaveLength(0);

    const { writeFile } = await import('fs/promises');
    const corruptPath = join(tempDir, 'corrupt.json');
    await writeFile(corruptPath, '{not json', 'utf-8');
    const corrupt = new BalanceHistoryStore({ historyPath: corruptPath });
    await expect(corrupt.initialize()).resolves.toBeUndefined();
    expect(corrupt.query({ to: NOW }).plans).toHaveLength(0);
  });

  it('should prune candles older than the retention window on initialize', async () => {
    // retention cutoff is wall-clock based, so seed relative to real now
    const now = Date.now();
    const store = new BalanceHistoryStore({ historyPath, retentionDays: 7 });
    await store.initialize();
    store.record({ planKey: '1', planName: 'Plan', balance: 1, at: now - 8 * 24 * HOUR });
    store.record({ planKey: '1', planName: 'Plan', balance: 2, at: now - 6 * 24 * HOUR });
    await store.persist();

    const store2 = new BalanceHistoryStore({ historyPath, retentionDays: 7 });
    await store2.initialize();
    const result = store2.query({ hours: 24 * 14, to: now });
    expect(result.plans[0]!.candles.map((c) => c.o)).toEqual([2]);
  });
});

/** True when access() rejects (file absent) */
async function accessFails(path: string): Promise<boolean> {
  const { access } = await import('fs/promises');
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}
