/**
 * Tests for ModelSyncService.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSyncService, applyExcludes } from '@/services/model-sync-service';
import type { IPlanRepository } from '@/services/plan-repository';
import type { CodingPlan } from '@/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makePlan(overrides: Partial<CodingPlan>): CodingPlan {
  return {
    id: 1,
    name: 'Test',
    baseUrl: undefined,
    apiKeyEncrypted: 'key',
    models: [],
    quota: { limit: 1000, period: { type: 'total' } },
    timeout: 300,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal in-memory IPlanRepository mock that records models in a Map. */
function makeRepo(plans: CodingPlan[]): IPlanRepository {
  const store = new Map<number, CodingPlan>(plans.map((p) => [p.id, p]));
  return {
    findById: async (id) => store.get(id) ?? null,
    findAll: async () => [...store.values()],
    findByModel: async () => [],
    findActive: async () => [...store.values()],
    save: async () => {
      throw new Error('not used');
    },
    update: async () => {
      throw new Error('not used');
    },
    delete: async () => false,
    exists: async () => false,
    getDecryptedApiKey: async (id) => store.get(id)?.apiKeyEncrypted ?? null,
    updateModelsInMemory: async (id, models) => {
      const p = store.get(id);
      if (p) {
        store.set(id, { ...p, models });
      }
    },
    reload: async () => {},
    setPlanIdCounter: () => {},
  } as unknown as IPlanRepository;
}

describe('ModelSyncService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches models, filters embed by default, and updates in memory', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://x:1234/v1' }),
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'qwen2.5' }, { id: 'text-embedding-3' }, { id: 'llama-3' }],
      }),
    });

    await new ModelSyncService({ repository: repo }).syncAll();

    expect(mockFetch.mock.calls[0]?.[0]).toBe('http://x:1234/v1/models');
    expect((await repo.findById(1))?.models).toEqual(['qwen2.5', 'llama-3']);
  });

  it('appends /v1/models when openaiBaseUrl lacks a versioned suffix', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://192.168.100.244:1234' }),
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'm1' }] }) });

    await new ModelSyncService({ repository: repo }).syncAll();
    expect(mockFetch.mock.calls[0]?.[0]).toBe('http://192.168.100.244:1234/v1/models');
  });

  it('uses Bearer auth with the decrypted API key', async () => {
    const repo = makeRepo([
      makePlan({
        id: 1,
        dynamicModels: true,
        openaiBaseUrl: 'http://x:1234/v1',
        apiKeyEncrypted: 'secret-key',
      }),
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'm1' }] }) });

    await new ModelSyncService({ repository: repo }).syncAll();
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer secret-key' },
    });
  });

  it('applies a plan-level modelsExclude', async () => {
    const repo = makeRepo([
      makePlan({
        id: 1,
        dynamicModels: true,
        openaiBaseUrl: 'http://x:1234/v1',
        modelsExclude: ['bge-', 'embed'],
      }),
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen' }, { id: 'bge-large' }, { id: 'text-embedding' }] }),
    });

    await new ModelSyncService({ repository: repo }).syncAll();
    expect((await repo.findById(1))?.models).toEqual(['qwen']);
  });

  it('does not fetch for non-dynamicModels plans', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: false, openaiBaseUrl: 'http://x:1234/v1', models: ['static'] }),
    ]);

    await new ModelSyncService({ repository: repo }).syncAll();
    expect(mockFetch).not.toHaveBeenCalled();
    expect((await repo.findById(1))?.models).toEqual(['static']);
  });

  it('keeps prior models on HTTP failure', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://x:1234/v1', models: ['old'] }),
    ]);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

    await new ModelSyncService({ repository: repo }).syncAll();
    expect((await repo.findById(1))?.models).toEqual(['old']);
  });

  it('keeps prior models when fetch rejects', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://x:1234/v1', models: ['old'] }),
    ]);
    mockFetch.mockRejectedValueOnce(new Error('network'));

    await new ModelSyncService({ repository: repo }).syncAll();
    expect((await repo.findById(1))?.models).toEqual(['old']);
  });

  it('keeps prior models when every fetched model is excluded', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://x:1234/v1', models: ['old'] }),
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'text-embedding-a' }, { id: 'text-embedding-b' }] }),
    });

    await new ModelSyncService({ repository: repo }).syncAll();
    expect((await repo.findById(1))?.models).toEqual(['old']);
  });

  it('skips a dynamicModels plan without openaiBaseUrl', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: undefined, models: ['x'] }),
    ]);

    await new ModelSyncService({ repository: repo }).syncAll();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('isolates per-plan failures (other plans still sync)', async () => {
    const repo = makeRepo([
      makePlan({ id: 1, dynamicModels: true, openaiBaseUrl: 'http://x:1234/v1' }),
      makePlan({ id: 2, dynamicModels: true, openaiBaseUrl: 'http://y:1234/v1' }),
    ]);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Err' }) // plan 1 fails
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'm2' }] }) }); // plan 2 ok

    await new ModelSyncService({ repository: repo }).syncAll();
    expect((await repo.findById(2))?.models).toEqual(['m2']);
  });

  it('start registers a periodic timer, stop clears it', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const repo = makeRepo([]);

    const svc = new ModelSyncService({ repository: repo, defaultIntervalMs: 5000 });
    svc.start();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    svc.stop();
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe('applyExcludes', () => {
  it('filters substrings case-insensitively', () => {
    expect(applyExcludes(['Qwen', 'EMBED-x', 'llama'], ['embed'])).toEqual(['Qwen', 'llama']);
  });

  it('returns all models when there are no excludes', () => {
    expect(applyExcludes(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
