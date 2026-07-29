/**
 * Unit tests for UsageStatsStore — persisted per-day/plan/model token stats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { UsageStatsStore } from '@/services/usage-stats-store';

describe('UsageStatsStore', () => {
  let tempDir: string;
  let statsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'usage-stats-test-'));
    statsPath = join(tempDir, 'usage-stats.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should aggregate records by day/plan/model', async () => {
    const store = new UsageStatsStore({ statsPath });
    await store.initialize();

    store.record({ planId: 1, planName: 'Kimi', model: 'k3', inputTokens: 100, outputTokens: 50, date: '2026-07-28' });
    store.record({ planId: 1, planName: 'Kimi', model: 'k3', inputTokens: 200, outputTokens: 60, date: '2026-07-28' });
    store.record({ planId: 2, planName: 'Zhipu', model: 'glm', inputTokens: 10, outputTokens: 5, date: '2026-07-29' });

    const result = store.query('2026-07-28', '2026-07-29');
    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({ date: '2026-07-28', requests: 2, totalTokens: 410 });
    expect(result.days[1]).toMatchObject({ date: '2026-07-29', requests: 1, totalTokens: 15 });
    expect(result.byPlan['Kimi']).toMatchObject({ requests: 2, totalTokens: 410 });
    expect(result.byPlan['Zhipu']).toMatchObject({ requests: 1, totalTokens: 15 });
    expect(result.byModel['k3']).toMatchObject({ requests: 2, totalTokens: 410 });
    expect(result.byModel['glm']).toMatchObject({ requests: 1, totalTokens: 15 });
  });

  it('should fill a continuous day series with zeros for missing days', async () => {
    const store = new UsageStatsStore({ statsPath });
    await store.initialize();
    store.record({ planId: 1, planName: 'Kimi', model: 'k3', inputTokens: 10, outputTokens: 5, date: '2026-07-27' });

    const result = store.query('2026-07-27', '2026-07-29');
    expect(result.days.map((d) => d.date)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
    expect(result.days[1]!.totalTokens).toBe(0);
    expect(result.days[2]!.totalTokens).toBe(0);
  });

  it('should persist to disk and reload across instances', async () => {
    const store = new UsageStatsStore({ statsPath });
    await store.initialize();
    store.record({ planId: 1, planName: 'Kimi', model: 'k3', inputTokens: 100, outputTokens: 50, date: '2026-07-28' });
    await store.persist();

    const raw = JSON.parse(await readFile(statsPath, 'utf-8'));
    expect(Object.keys(raw.records)).toHaveLength(1);

    const store2 = new UsageStatsStore({ statsPath });
    await store2.initialize();
    const result = store2.query('2026-07-28', '2026-07-28');
    expect(result.days[0]).toMatchObject({ requests: 1, totalTokens: 150 });
  });

  it('should tolerate a missing or corrupt file on initialize', async () => {
    const store = new UsageStatsStore({ statsPath: join(tempDir, 'missing.json') });
    await expect(store.initialize()).resolves.toBeUndefined();
    expect(store.query().days.length).toBeGreaterThan(0);
  });

  it('should prune records older than the retention window', async () => {
    const store = new UsageStatsStore({ statsPath, retentionDays: 90 });
    await store.initialize();
    const old = '2020-01-01';
    store.record({ planId: 1, planName: 'Kimi', model: 'k3', inputTokens: 5, outputTokens: 5, date: old });
    // re-run cleanup via a fresh initialize on the same in-memory map is not
    // possible, so assert through a new instance after persisting + reload
    await store.persist();
    const store2 = new UsageStatsStore({ statsPath, retentionDays: 90 });
    await store2.initialize();
    const result = store2.query('2020-01-01', '2020-01-02');
    expect(result.byPlan['Kimi']).toBeUndefined();
  });
});
