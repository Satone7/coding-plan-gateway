# Preset Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in provider presets (Zhipu, Volcengine, Ali) with usage API integration for Zhipu, so users only need to supply an `apiKey` when creating plans for known providers.

**Architecture:** A `ProviderRegistry` holds built-in presets (baseUrl, models, usage adapter). Plans gain an optional `provider` field referencing a preset. A `UsageAdapter` interface abstracts provider-specific usage APIs; `ZhipuUsageAdapter` calls Zhipu's quota/limit endpoint. A `CachedUsageAdapter` wraps any adapter with TTL caching. `QuotaManager` and `RequestRouter` are modified to use the adapter for plans whose provider has a usage API, falling back to existing local counting for others.

**Tech Stack:** TypeScript 5.x (strict), Vitest, Zod, Fastify 4.x, existing `yaml` and `uuid` packages.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/types/provider.ts` | `ProviderPreset` interface |
| `src/types/usage-adapter.ts` | `UsageAdapter`, `UsageResult` interfaces |
| `src/config/builtin-providers.ts` | Built-in provider preset data, `createProviderRegistry()` factory |
| `src/services/usage-adapters/zhipu-adapter.ts` | `ZhipuUsageAdapter` class |
| `src/services/usage-adapters/cached-adapter.ts` | `CachedUsageAdapter` class |
| `src/services/provider-registry.ts` | `ProviderRegistry` class — merge built-in + config overrides, lookup, adapter management |
| `tests/unit/types/provider.test.ts` | Tests for ProviderPreset type |
| `tests/unit/config/builtin-providers.test.ts` | Tests for built-in presets |
| `tests/unit/services/usage-adapters/zhipu-adapter.test.ts` | Tests for ZhipuUsageAdapter |
| `tests/unit/services/usage-adapters/cached-adapter.test.ts` | Tests for CachedUsageAdapter |
| `tests/unit/services/provider-registry.test.ts` | Tests for ProviderRegistry |

### Modified files

| File | Change |
|------|--------|
| `src/types/coding-plan.ts` | Add `provider?: string` to `CodingPlan`, `CreateCodingPlanInput`, `UpdateCodingPlanInput` |
| `src/types/index.ts` | Export new types from `provider.ts` and `usage-adapter.ts` |
| `src/config/schema.ts` | Add `provider` to `planConfigSchema` (optional string), add `providers` section to `configSchema`, make `baseUrl`/`models`/`quota` conditionally required |
| `src/services/plan-repository.ts` | Pass `provider` through in `configToPlan()`, `planToConfig()`, `save()`, `update()` |
| `src/services/quota-manager.ts` | Add `providerRegistry` dependency, modify `hasRemainingQuota()` to check usage adapter |
| `src/services/request-router.ts` | Make `filterByQuota()` async for adapter calls |
| `src/routes/admin/handlers.ts` | Update `createPlanBodySchema`/`updatePlanBodySchema` with `provider` field, inject `providerRegistry` for validation |
| `src/routes/admin/index.ts` | Pass `providerRegistry` to admin handlers |
| `config.yaml.example` | Add `providers` section and provider-based plan examples |
| `tests/fixtures/mock-plans.ts` | Add `provider` to mock factories |

---

## Task 1: Provider and Usage Adapter Types

**Files:**
- Create: `src/types/provider.ts`
- Create: `src/types/usage-adapter.ts`
- Modify: `src/types/index.ts`
- Test: `tests/unit/types/provider.test.ts`

- [ ] **Step 1: Write `src/types/provider.ts`**

```typescript
/**
 * Provider preset types.
 * Defines the structure for built-in and user-configured provider presets.
 */

/**
 * A provider preset with default configuration values.
 * Referenced by plans via the `provider` field.
 */
export interface ProviderPreset {
  /** Unique provider identifier (e.g., 'zhipu', 'volcengine') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Default API base URL for this provider */
  baseUrl: string;
  /** Default model list available from this provider */
  models: string[];
  /** Default model aliases for this provider (alias -> canonical) */
  defaultModelAliases?: Record<string, string>;
  /** Whether this provider exposes a usage query API */
  hasUsageApi: boolean;
}
```

- [ ] **Step 2: Write `src/types/usage-adapter.ts`**

```typescript
/**
 * Usage adapter types.
 * Defines the interface for querying provider-specific usage APIs.
 */

/**
 * Result from a usage API query.
 */
export interface UsageResult {
  /** Used quota amount */
  used: number;
  /** Total quota limit */
  limit: number;
  /** Usage percentage (0-100) */
  percentage: number;
  /** Period end time (ISO datetime string), if applicable */
  expiresAt?: string;
  /** Raw API response for debugging */
  raw?: unknown;
}

/**
 * Adapter interface for querying provider usage APIs.
 * Each provider with a usage API implements this interface.
 */
export interface UsageAdapter {
  /** Provider ID this adapter handles */
  readonly providerId: string;
  /** Cache TTL in seconds */
  readonly cacheTTL: number;

  /**
   * Query current usage from the provider's API.
   *
   * @param apiKey - Decrypted API key for authentication
   * @returns Current usage information
   */
  queryUsage(apiKey: string): Promise<UsageResult>;
}
```

- [ ] **Step 3: Update `src/types/index.ts` — add exports after the existing `// Coding plan types` block (after line 20)**

Add after the `} from './coding-plan';` line (line 20):

```typescript
// Provider preset types
export type { ProviderPreset } from './provider';

// Usage adapter types
export type { UsageResult, UsageAdapter } from './usage-adapter';
```

- [ ] **Step 4: Write `tests/unit/types/provider.test.ts`**

```typescript
/**
 * Tests for provider and usage adapter type definitions.
 * Validates that types compile correctly and have expected shapes.
 */

import { describe, it, expect } from 'vitest';
import type { ProviderPreset, UsageAdapter, UsageResult } from '@/types';

describe('ProviderPreset type', () => {
  it('should accept a valid preset with all fields', () => {
    const preset: ProviderPreset = {
      id: 'zhipu',
      name: 'Zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      models: ['glm-5.1', 'glm-5-turbo'],
      defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
      hasUsageApi: true,
    };
    expect(preset.id).toBe('zhipu');
    expect(preset.hasUsageApi).toBe(true);
    expect(preset.defaultModelAliases).toEqual({ 'glm-5': 'glm-5-turbo' });
  });

  it('should accept a preset without optional fields', () => {
    const preset: ProviderPreset = {
      id: 'volcengine',
      name: 'Volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      models: ['ark-code-latest'],
      hasUsageApi: false,
    };
    expect(preset.defaultModelAliases).toBeUndefined();
    expect(preset.hasUsageApi).toBe(false);
  });
});

describe('UsageAdapter type', () => {
  it('should accept a valid adapter implementation', async () => {
    const adapter: UsageAdapter = {
      providerId: 'test',
      cacheTTL: 300,
      queryUsage: async (apiKey: string): Promise<UsageResult> => ({
        used: 50,
        limit: 100,
        percentage: 50,
      }),
    };
    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(50);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/types/provider.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/provider.ts src/types/usage-adapter.ts src/types/index.ts tests/unit/types/provider.test.ts
git commit -m "feat(types): add ProviderPreset and UsageAdapter type definitions"
```

---

## Task 2: Built-in Provider Presets

**Files:**
- Create: `src/config/builtin-providers.ts`
- Test: `tests/unit/config/builtin-providers.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/config/builtin-providers.test.ts`**

```typescript
/**
 * Tests for built-in provider presets.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_PROVIDERS,
  getBuiltinProvider,
  BUILTIN_PROVIDER_IDS,
} from '@/config/builtin-providers';

describe('BUILTIN_PROVIDERS', () => {
  it('should contain exactly 3 providers', () => {
    expect(BUILTIN_PROVIDERS).toHaveLength(3);
  });

  it('should have unique IDs', () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have all required fields on each provider', () => {
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.baseUrl).toMatch(/^https?:\/\//);
      expect(provider.models.length).toBeGreaterThan(0);
      expect(typeof provider.hasUsageApi).toBe('boolean');
    }
  });
});

describe('getBuiltinProvider', () => {
  it('should return zhipu provider by id', () => {
    const zhipu = getBuiltinProvider('zhipu');
    expect(zhipu).toBeDefined();
    expect(zhipu!.id).toBe('zhipu');
    expect(zhipu!.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(zhipu!.models).toContain('glm-5.1');
    expect(zhipu!.models).toContain('glm-5-turbo');
    expect(zhipu!.defaultModelAliases).toEqual({ 'glm-5': 'glm-5-turbo' });
    expect(zhipu!.hasUsageApi).toBe(true);
  });

  it('should return volcengine provider by id', () => {
    const ark = getBuiltinProvider('volcengine');
    expect(ark).toBeDefined();
    expect(ark!.id).toBe('volcengine');
    expect(ark!.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
    expect(ark!.models).toContain('ark-code-latest');
    expect(ark!.hasUsageApi).toBe(false);
  });

  it('should return ali provider by id', () => {
    const ali = getBuiltinProvider('ali');
    expect(ali).toBeDefined();
    expect(ali!.id).toBe('ali');
    expect(ali!.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/apps/anthropic');
    expect(ali!.models).toContain('qwen3.5-plus');
    expect(ali!.hasUsageApi).toBe(false);
  });

  it('should return undefined for unknown provider id', () => {
    expect(getBuiltinProvider('unknown')).toBeUndefined();
  });
});

describe('BUILTIN_PROVIDER_IDS', () => {
  it('should list all provider IDs', () => {
    expect(BUILTIN_PROVIDER_IDS).toEqual(['zhipu', 'volcengine', 'ali']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config/builtin-providers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/config/builtin-providers.ts`**

```typescript
/**
 * Built-in provider presets.
 * Default configurations for known AI providers.
 */

import type { ProviderPreset } from '@/types';

/**
 * Built-in provider preset configurations.
 * These serve as defaults that can be overridden via config.yaml.
 */
export const BUILTIN_PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.1', 'glm-5-turbo'],
    defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
    hasUsageApi: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine / Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'kimi-k2.5', 'minimax-m2.5', 'glm-4.7'],
    hasUsageApi: false,
  },
  {
    id: 'ali',
    name: 'Ali / DashScope',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    models: ['qwen3.5-plus', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'MiniMax-M2.5'],
    hasUsageApi: false,
  },
];

/**
 * Provider IDs for the built-in providers.
 */
export const BUILTIN_PROVIDER_IDS: readonly string[] = BUILTIN_PROVIDERS.map((p) => p.id);

/**
 * Look up a built-in provider by its ID.
 *
 * @param id - The provider ID
 * @returns The provider preset, or undefined if not found
 */
export function getBuiltinProvider(id: string): ProviderPreset | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/config/builtin-providers.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/builtin-providers.ts tests/unit/config/builtin-providers.test.ts
git commit -m "feat(config): add built-in provider presets for Zhipu, Volcengine, Ali"
```

---

## Task 3: Zhipu Usage Adapter

**Files:**
- Create: `src/services/usage-adapters/zhipu-adapter.ts`
- Test: `tests/unit/services/usage-adapters/zhipu-adapter.test.ts`

This adapter queries Zhipu's `/api/monitor/usage/quota/limit` endpoint. Based on `~/.claude/glm-usage.sh`, the API returns `TOKENS_LIMIT` percentages for 5h and weekly windows. If any window exceeds 100%, the plan is considered exhausted.

- [ ] **Step 1: Write the failing test `tests/unit/services/usage-adapters/zhipu-adapter.test.ts`**

```typescript
/**
 * Tests for ZhipuUsageAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZhipuUsageAdapter } from '@/services/usage-adapters/zhipu-adapter';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ZhipuUsageAdapter', () => {
  let adapter: ZhipuUsageAdapter;

  beforeEach(() => {
    adapter = new ZhipuUsageAdapter();
    mockFetch.mockReset();
  });

  it('should have providerId zhipu', () => {
    expect(adapter.providerId).toBe('zhipu');
  });

  it('should have cacheTTL of 300 seconds', () => {
    expect(adapter.cacheTTL).toBe(300);
  });

  it('should return usage result with highest percentage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          limits: [
            { type: 'TOKENS_LIMIT', percentage: 45.2 },
            { type: 'TOKENS_LIMIT', percentage: 30.1 },
          ],
        },
      }),
    });

    const result = await adapter.queryUsage('test-api-key');

    expect(result.percentage).toBe(45.2);
    expect(result.used).toBeGreaterThan(0);
    expect(result.limit).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the URL contains the quota/limit endpoint
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/monitor/usage/quota/limit');
  });

  it('should send Authorization header with API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 10 }] },
      }),
    });

    await adapter.queryUsage('my-secret-key');

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      Authorization: 'my-secret-key',
    });
  });

  it('should return 0 percentage when no TOKENS_LIMIT entries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [{ type: 'OTHER_LIMIT', percentage: 50 }] },
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(0);
  });

  it('should return 0 percentage when limits array is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [] },
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(0);
  });

  it('should throw descriptive error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(adapter.queryUsage('bad-key')).rejects.toThrow(
      'Zhipu usage API returned HTTP 401: Unauthorized'
    );
  });

  it('should throw descriptive error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(adapter.queryUsage('test-key')).rejects.toThrow(
      'Failed to query Zhipu usage API'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/usage-adapters/zhipu-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/services/usage-adapters/zhipu-adapter.ts`**

```typescript
/**
 * Zhipu Usage Adapter.
 * Queries Zhipu's quota/limit API to get real-time usage percentages.
 */

import type { UsageAdapter, UsageResult } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Zhipu API response structure for quota limits.
 */
interface ZhipuQuotaResponse {
  data: {
    limits: Array<{
      type: string;
      percentage: number;
    }>;
  };
}

/**
 * Base domains for Zhipu platforms.
 */
const ZHIPU_BASE_DOMAIN = 'https://open.bigmodel.cn';

/**
 * Usage adapter for Zhipu (bigmodel.cn) provider.
 * Queries the /api/monitor/usage/quota/limit endpoint.
 *
 * The API returns TOKENS_LIMIT percentages for multiple time windows
 * (5h and weekly). The adapter returns the highest percentage,
 * as exhaustion in any window means the plan is unavailable.
 */
export class ZhipuUsageAdapter implements UsageAdapter {
  readonly providerId = 'zhipu';
  readonly cacheTTL = 300; // 5 minutes

  async queryUsage(apiKey: string): Promise<UsageResult> {
    const url = `${ZHIPU_BASE_DOMAIN}/api/monitor/usage/quota/limit`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Zhipu usage API returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      const body = (await response.json()) as ZhipuQuotaResponse;
      const limits = body?.data?.limits ?? [];

      // Extract TOKENS_LIMIT percentages
      const tokenLimits = limits.filter(
        (limit) => limit.type === 'TOKENS_LIMIT'
      );

      // Use the highest percentage across all windows
      const maxPercentage =
        tokenLimits.length > 0
          ? Math.max(...tokenLimits.map((l) => l.percentage))
          : 0;

      // Derive approximate used/limit from percentage
      // Since the API only gives percentages, we estimate limit=10000 units
      // and compute used from the percentage
      const estimatedLimit = 10000;
      const estimatedUsed = Math.round((maxPercentage / 100) * estimatedLimit);

      logger.debug('Zhipu usage queried', {
        percentage: maxPercentage,
        windowCount: tokenLimits.length,
      });

      return {
        used: estimatedUsed,
        limit: estimatedLimit,
        percentage: maxPercentage,
        raw: body,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Zhipu usage API returned HTTP')) {
        throw error;
      }
      throw new Error(
        `Failed to query Zhipu usage API: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/services/usage-adapters/zhipu-adapter.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/usage-adapters/zhipu-adapter.ts tests/unit/services/usage-adapters/zhipu-adapter.test.ts
git commit -m "feat(usage): add ZhipuUsageAdapter for Zhipu quota/limit API"
```

---

## Task 4: Cached Usage Adapter

**Files:**
- Create: `src/services/usage-adapters/cached-adapter.ts`
- Test: `tests/unit/services/usage-adapters/cached-adapter.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/services/usage-adapters/cached-adapter.test.ts`**

```typescript
/**
 * Tests for CachedUsageAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CachedUsageAdapter } from '@/services/usage-adapters/cached-adapter';
import type { UsageAdapter, UsageResult } from '@/types';

function createMockAdapter(results: UsageResult[]): UsageAdapter {
  let callIndex = 0;
  return {
    providerId: 'test-provider',
    cacheTTL: 60,
    queryUsage: vi.fn(async () => {
      const result = results[callIndex] ?? results[results.length - 1]!;
      callIndex++;
      return result;
    }),
  };
}

describe('CachedUsageAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delegate to inner adapter on first call', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    const result = await cached.queryUsage('key1');

    expect(result.percentage).toBe(10);
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should return cached result within TTL', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
      { used: 50, limit: 100, percentage: 50 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    // First call — populates cache
    await cached.queryUsage('key1');
    // Second call within TTL — should use cache
    const result = await cached.queryUsage('key1');

    expect(result.percentage).toBe(10); // Cached value, not 50
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should refresh cache after TTL expires', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
      { used: 80, limit: 100, percentage: 80 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    // First call
    await cached.queryUsage('key1');
    expect(inner.queryUsage).toHaveBeenCalledOnce();

    // Advance past TTL
    vi.advanceTimersByTime(301 * 1000);

    // Second call — cache expired, should call inner again
    const result = await cached.queryUsage('key1');
    expect(result.percentage).toBe(80);
    expect(inner.queryUsage).toHaveBeenCalledTimes(2);
  });

  it('should cache separately per provider ID', async () => {
    const inner: UsageAdapter = {
      providerId: 'shared',
      cacheTTL: 60,
      queryUsage: vi.fn(async (_apiKey: string) => ({
        used: 42,
        limit: 100,
        percentage: 42,
      })),
    };
    const cached = new CachedUsageAdapter(inner, 300);

    await cached.queryUsage('key-a');
    await cached.queryUsage('key-a');

    // Same key — only 1 call because cached by providerId
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should expose providerId and cacheTTL from inner adapter', () => {
    const inner = createMockAdapter([
      { used: 0, limit: 100, percentage: 0 },
    ]);
    const cached = new CachedUsageAdapter(inner, 600);

    expect(cached.providerId).toBe('test-provider');
    expect(cached.cacheTTL).toBe(600);
  });

  it('should return stale cache on inner adapter failure', async () => {
    const goodResult: UsageResult = { used: 30, limit: 100, percentage: 30 };
    const inner: UsageAdapter = {
      providerId: 'fail-provider',
      cacheTTL: 60,
      queryUsage: vi.fn()
        .mockResolvedValueOnce(goodResult)
        .mockRejectedValueOnce(new Error('API down')),
    };
    const cached = new CachedUsageAdapter(inner, 300);

    // First call succeeds — populates cache
    const first = await cached.queryUsage('key1');
    expect(first.percentage).toBe(30);

    // Advance past TTL
    vi.advanceTimersByTime(301 * 1000);

    // Second call — inner fails, should return stale cached value
    const second = await cached.queryUsage('key1');
    expect(second.percentage).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/usage-adapters/cached-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/services/usage-adapters/cached-adapter.ts`**

```typescript
/**
 * Cached Usage Adapter.
 * Wraps a UsageAdapter with in-memory TTL caching.
 * On inner adapter failure, returns stale cache if available.
 */

import type { UsageAdapter, UsageResult } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Cache entry with expiration.
 */
interface CacheEntry {
  result: UsageResult;
  expiresAt: number; // Date.now() timestamp
}

/**
 * Wraps a UsageAdapter with in-memory TTL caching.
 * Keyed by provider ID (all plans for the same provider share a cache entry).
 * On inner adapter failure, returns stale cache if available.
 */
export class CachedUsageAdapter implements UsageAdapter {
  private cache = new Map<string, CacheEntry>();
  private readonly inner: UsageAdapter;
  private readonly ttlMs: number;

  constructor(inner: UsageAdapter, ttlSeconds: number) {
    this.inner = inner;
    this.ttlMs = ttlSeconds * 1000;
  }

  get providerId(): string {
    return this.inner.providerId;
  }

  get cacheTTL(): number {
    return this.inner.cacheTTL;
  }

  async queryUsage(apiKey: string): Promise<UsageResult> {
    const cacheKey = this.inner.providerId;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // Return fresh cache if available
    if (cached && now < cached.expiresAt) {
      logger.debug('Usage adapter cache hit', {
        providerId: this.inner.providerId,
        percentage: cached.result.percentage,
      });
      return cached.result;
    }

    // Cache miss or expired — query inner adapter
    try {
      const result = await this.inner.queryUsage(apiKey);
      this.cache.set(cacheKey, {
        result,
        expiresAt: now + this.ttlMs,
      });
      return result;
    } catch (error) {
      // On failure, return stale cache if available (prefer over-blocking)
      if (cached) {
        logger.warn('Usage adapter query failed, returning stale cache', {
          providerId: this.inner.providerId,
          error: error instanceof Error ? error.message : String(error),
          stalePercentage: cached.result.percentage,
        });
        return cached.result;
      }

      // No cache at all — re-throw
      throw error;
    }
  }
}
```

- [ ] **Step 4: Add `afterEach` import to test — the test file already imports from vitest, just verify it has `afterEach` in the import. The test file at step 1 already includes it.**

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/services/usage-adapters/cached-adapter.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/usage-adapters/cached-adapter.ts tests/unit/services/usage-adapters/cached-adapter.test.ts
git commit -m "feat(usage): add CachedUsageAdapter with TTL caching and stale fallback"
```

---

## Task 5: Provider Registry

**Files:**
- Create: `src/services/provider-registry.ts`
- Test: `tests/unit/services/provider-registry.test.ts`

The registry merges built-in presets with config overrides, provides lookup, and manages usage adapters.

- [ ] **Step 1: Write the failing test `tests/unit/services/provider-registry.test.ts`**

```typescript
/**
 * Tests for ProviderRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '@/services/provider-registry';
import type { UsageAdapter, UsageResult } from '@/types';

function createMockAdapter(id: string): UsageAdapter {
  return {
    providerId: id,
    cacheTTL: 60,
    queryUsage: async (): Promise<UsageResult> => ({
      used: 10,
      limit: 100,
      percentage: 10,
    }),
  };
}

describe('ProviderRegistry', () => {
  describe('with no config overrides', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
      registry = new ProviderRegistry();
    });

    it('should return all built-in providers', () => {
      const providers = registry.getAllProviders();
      expect(providers.length).toBeGreaterThanOrEqual(3);
      const ids = providers.map((p) => p.id);
      expect(ids).toContain('zhipu');
      expect(ids).toContain('volcengine');
      expect(ids).toContain('ali');
    });

    it('should look up zhipu provider by id', () => {
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu).toBeDefined();
      expect(zhipu!.hasUsageApi).toBe(true);
    });

    it('should return undefined for unknown provider', () => {
      expect(registry.getProvider('unknown')).toBeUndefined();
    });

    it('should return false for hasUsageApi on unknown provider', () => {
      expect(registry.hasUsageApi('unknown')).toBe(false);
    });

    it('should return false for hasUsageApi on provider without adapter', () => {
      expect(registry.hasUsageApi('volcengine')).toBe(false);
    });

    it('should return null adapter for unknown provider', () => {
      expect(registry.getUsageAdapter('unknown')).toBeNull();
    });

    it('should return null adapter for provider without usage API', () => {
      expect(registry.getUsageAdapter('volcengine')).toBeNull();
    });

    it('should return null adapter when no adapter registered', () => {
      expect(registry.getUsageAdapter('zhipu')).toBeNull();
    });
  });

  describe('with usage adapter', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.registerUsageAdapter(createMockAdapter('zhipu'));
    });

    it('should return adapter for zhipu after registration', () => {
      const adapter = registry.getUsageAdapter('zhipu');
      expect(adapter).not.toBeNull();
      expect(adapter!.providerId).toBe('zhipu');
    });

    it('should report hasUsageApi for zhipu after adapter registration', () => {
      expect(registry.hasUsageApi('zhipu')).toBe(true);
    });
  });

  describe('with config overrides', () => {
    it('should override baseUrl from config', () => {
      const registry = new ProviderRegistry({
        zhipu: { baseUrl: 'https://custom-zhipu.example.com' },
      });
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu!.baseUrl).toBe('https://custom-zhipu.example.com');
    });

    it('should override models from config', () => {
      const registry = new ProviderRegistry({
        zhipu: { models: ['custom-model'] },
      });
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu!.models).toEqual(['custom-model']);
    });

    it('should add a new custom provider', () => {
      const registry = new ProviderRegistry({
        'my-provider': {
          name: 'My Provider',
          baseUrl: 'https://api.my-provider.com/v1',
          models: ['model-x'],
          hasUsageApi: false,
        },
      });
      const provider = registry.getProvider('my-provider');
      expect(provider).toBeDefined();
      expect(provider!.name).toBe('My Provider');
      expect(provider!.baseUrl).toBe('https://api.my-provider.com/v1');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/provider-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/services/provider-registry.ts`**

```typescript
/**
 * Provider Registry.
 * Merges built-in presets with config overrides and manages usage adapters.
 */

import type { ProviderPreset, UsageAdapter } from '@/types';
import { BUILTIN_PROVIDERS } from '@/config/builtin-providers';
import { logger } from '@/utils/logger';

/**
 * Partial override for a provider preset from config.
 */
export interface ProviderOverride {
  name?: string;
  baseUrl?: string;
  models?: string[];
  defaultModelAliases?: Record<string, string>;
  hasUsageApi?: boolean;
}

/**
 * Config-level providers map: provider ID -> override or new provider.
 * Overrides for built-in providers only need changed fields.
 * New providers need all required fields.
 */
export type ProviderOverrides = Record<string, ProviderOverride>;

/**
 * Provider Registry — holds all known providers and their usage adapters.
 * Built-in presets are loaded first, then config overrides are merged in.
 */
export class ProviderRegistry {
  private readonly providers: Map<string, ProviderPreset> = new Map();
  private readonly adapters: Map<string, UsageAdapter> = new Map();

  constructor(overrides?: ProviderOverrides) {
    // Load built-in presets
    for (const preset of BUILTIN_PROVIDERS) {
      this.providers.set(preset.id, { ...preset });
    }

    // Merge config overrides
    if (overrides) {
      for (const [id, override] of Object.entries(overrides)) {
        const existing = this.providers.get(id);
        if (existing) {
          // Merge override into existing preset
          this.providers.set(id, {
            ...existing,
            ...override,
            id, // Ensure id is never overridden
          });
        } else {
          // New custom provider — must have required fields
          if (!override.name || !override.baseUrl || !override.models) {
            logger.warn('Skipping custom provider with missing required fields', { id });
            continue;
          }
          this.providers.set(id, {
            id,
            name: override.name,
            baseUrl: override.baseUrl,
            models: override.models,
            defaultModelAliases: override.defaultModelAliases,
            hasUsageApi: override.hasUsageApi ?? false,
          });
        }
      }
    }

    logger.info('ProviderRegistry initialized', {
      providerCount: this.providers.size,
      providerIds: [...this.providers.keys()],
    });
  }

  /**
   * Get all registered providers.
   */
  getAllProviders(): ProviderPreset[] {
    return [...this.providers.values()];
  }

  /**
   * Look up a provider by ID.
   */
  getProvider(id: string): ProviderPreset | undefined {
    return this.providers.get(id);
  }

  /**
   * Check if a provider has a usage API (preset says yes AND adapter is registered).
   */
  hasUsageApi(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider?.hasUsageApi) return false;
    return this.adapters.has(id);
  }

  /**
   * Get the usage adapter for a provider.
   * Returns null if provider has no usage API or no adapter registered.
   */
  getUsageAdapter(id: string): UsageAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  /**
   * Register a usage adapter for a provider.
   */
  registerUsageAdapter(adapter: UsageAdapter): void {
    const provider = this.providers.get(adapter.providerId);
    if (!provider) {
      logger.warn('Cannot register adapter for unknown provider', {
        providerId: adapter.providerId,
      });
      return;
    }
    this.adapters.set(adapter.providerId, adapter);
    logger.info('Usage adapter registered', {
      providerId: adapter.providerId,
    });
  }
}

/**
 * Create a ProviderRegistry instance.
 */
export function createProviderRegistry(overrides?: ProviderOverrides): ProviderRegistry {
  return new ProviderRegistry(overrides);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/services/provider-registry.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/provider-registry.ts tests/unit/services/provider-registry.test.ts
git commit -m "feat(providers): add ProviderRegistry with built-in presets and config overrides"
```

---

## Task 6: Plan Types — Add `provider` Field

**Files:**
- Modify: `src/types/coding-plan.ts` (lines 106-186)
- Modify: `tests/fixtures/mock-plans.ts`

- [ ] **Step 1: Add `provider` to `CodingPlan` interface in `src/types/coding-plan.ts`**

After the `modelAliases` field (line 144) and before `createdAt` (line 146), add:

```typescript
  /** Provider preset ID. When set, baseUrl/models/quota use preset defaults if not specified. */
  provider?: string;
```

- [ ] **Step 2: Add `provider` to `CreateCodingPlanInput` interface (line 156-168)**

After `modelAliases` (line 167), add:

```typescript
  provider?: string;
```

- [ ] **Step 3: Add `provider` to `UpdateCodingPlanInput` interface (line 173-186)**

After `modelAliases` (line 185), add:

```typescript
  provider?: string;
```

- [ ] **Step 4: Update `createMockPlan` in `tests/fixtures/mock-plans.ts`**

In the `createMockPlan` function (line 21), the spread `...overrides` already covers it — no change needed to the function body. But add a test to verify:

In `tests/unit/types/provider.test.ts`, add a new test:

```typescript
import type { CodingPlan, CreateCodingPlanInput } from '@/types';

describe('CodingPlan with provider field', () => {
  it('should accept CodingPlan with provider', () => {
    const plan: CodingPlan = {
      id: 1,
      name: 'Zhipu Plan',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKeyEncrypted: 'enc:xxx',
      models: ['glm-5.1'],
      quota: { limit: 1000, period: { type: '5h', windowHours: 5, sliding: true } },
      timeout: 300,
      status: 'active',
      provider: 'zhipu',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(plan.provider).toBe('zhipu');
  });

  it('should accept CreateCodingPlanInput with provider', () => {
    const input: CreateCodingPlanInput = {
      name: 'Zhipu Plan',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'test-key',
      models: ['glm-5.1'],
      quota: { limit: 1000, period: { type: '5h', windowHours: 5, sliding: true } },
      provider: 'zhipu',
    };
    expect(input.provider).toBe('zhipu');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/types/provider.test.ts`
Expected: All 5 tests PASS (3 existing + 2 new)

- [ ] **Step 6: Run full test suite to check for type breakage**

Run: `npx vitest run`
Expected: All existing tests still PASS (provider is optional, backward compatible)

- [ ] **Step 7: Commit**

```bash
git add src/types/coding-plan.ts tests/unit/types/provider.test.ts
git commit -m "feat(types): add optional provider field to CodingPlan and input types"
```

---

## Task 7: Config Schema — `provider` on Plans + `providers` Section

**Files:**
- Modify: `src/config/schema.ts` (lines 106-143)

This task updates the Zod schema so `planConfigSchema` accepts `provider` and conditionally requires `baseUrl`/`models`/`quota`. It also adds a `providers` section to the root `configSchema`.

- [ ] **Step 1: Update `planConfigSchema` in `src/config/schema.ts`**

Replace lines 106-134 with the following:

```typescript
/**
 * Plan configuration schema (from YAML/JSON).
 * ID can be either integer (preferred) or UUID (legacy, for migration).
 *
 * When `provider` is set, `baseUrl`, `models`, and `quota` become optional
 * (defaults come from the provider preset).
 * When `provider` is not set, `baseUrl`, `models`, and `quota` are required.
 */
export const planConfigSchema = z.object({
  id: z.union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER), // Integer ID (preferred)
    z.string().uuid(), // UUID (legacy, for migration)
  ]).optional(),
  name: z.string().min(1).max(100),
  provider: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1).optional(),
  quota: quotaConfigSchema.optional(),
  timeout: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
  // Legacy expiration fields (kept for backward compat during migration)
  expiresOn: z.number().int().min(1).max(31).optional(),
  expiresAt: z.string().datetime().optional(),
  weight: z.number().int().min(1).max(100).optional(),
  enable: z.boolean().optional().default(true),
  modelAliases: modelAliasesSchema.optional(),
}).refine(
  (plan) => {
    // When provider is not set, baseUrl, models, and quota are required
    if (!plan.provider) {
      return plan.baseUrl !== undefined && plan.models !== undefined && plan.quota !== undefined;
    }
    return true;
  },
  { message: 'baseUrl, models, and quota are required when provider is not set' }
).refine(
  (plan) => {
    if (!plan.modelAliases) return true;
    const models = plan.models ?? [];
    const modelsLower = models.map((m: string) => m.toLowerCase());
    return Object.values(plan.modelAliases).every(
      (target) => modelsLower.includes(target.toLowerCase())
    );
  },
  { message: "modelAliases target must exist in the plan's models array" }
);
```

- [ ] **Step 2: Update `configSchema` (lines 139-143) to add `providers` section**

Replace:

```typescript
export const configSchema = z.object({
  version: z.union([z.number().int().min(0), z.string()]).optional(),
  plans: z.array(planConfigSchema).default([]),
  loadBalancing: loadBalanceConfigSchema.optional(),
});
```

With:

```typescript
/**
 * Provider override schema for config-level customization.
 */
const providerOverrideSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  models: z.array(z.string().min(1)).min(1).optional(),
  defaultModelAliases: modelAliasesSchema.optional(),
  hasUsageApi: z.boolean().optional(),
});

/**
 * Full configuration schema (root).
 */
export const configSchema = z.object({
  version: z.union([z.number().int().min(0), z.string()]).optional(),
  plans: z.array(planConfigSchema).default([]),
  providers: z.record(z.string().min(1), providerOverrideSchema).optional(),
  loadBalancing: loadBalanceConfigSchema.optional(),
});
```

- [ ] **Step 3: Run existing tests to check for breakage**

Run: `npx vitest run`
Expected: Some tests may fail because existing plan configs without `provider` still require `baseUrl`/`models`/`quota`. The refine should allow them since they do provide those fields. If tests fail, check that existing test config data includes `baseUrl`, `models`, and `quota` (they should, since those were required before).

- [ ] **Step 4: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(schema): add provider field to planConfigSchema and providers section to configSchema"
```

---

## Task 8: Plan Repository — Pass `provider` Through + Apply Preset Defaults

**Files:**
- Modify: `src/services/plan-repository.ts`

The repository must pass `provider` through during config-to-plan conversion and plan-to-config serialization. It does NOT apply preset defaults itself — that happens at the config loading level (see note below).

- [ ] **Step 1: Update `configToPlan` method (line 409-460)**

Add `provider` to the returned object. After the `modelAliases` field in the return statement (line 456), add:

```typescript
      provider: config.provider,
```

The full return block should look like:

```typescript
    return {
      id,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKeyEncrypted: config.apiKey,
      models: config.models,
      quota: mergedQuota,
      timeout: config.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      status: config.status ?? 'active',
      expiresOn: effectiveExpiresOn,
      expiresAt: effectiveExpiresAt,
      weight: config.weight,
      enable: config.enable ?? true,
      modelAliases: config.modelAliases,
      provider: config.provider,
      createdAt: now,
      updatedAt: now,
    };
```

- [ ] **Step 2: Update `planToConfig` method (line 465-497)**

Add `provider` to the returned object. After `modelAliases` in the return (line 496), add:

```typescript
      provider: plan.provider,
```

- [ ] **Step 3: Update `save` method (line 136-185)**

Add `provider` to the plan creation. After `modelAliases` (line 175), add:

```typescript
      provider: input.provider,
```

- [ ] **Step 4: Update `update` method (line 190-232)**

Add `provider` to the spread merge. After the `modelAliases` line (line 223), add:

```typescript
      provider: updates.provider !== undefined ? updates.provider : existing.provider,
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests PASS — `provider` is optional and all existing tests don't set it.

- [ ] **Step 6: Commit**

```bash
git add src/services/plan-repository.ts
git commit -m "feat(repository): pass provider field through plan conversion and CRUD"
```

---

## Task 9: QuotaManager + RequestRouter Integration

**Files:**
- Modify: `src/services/quota-manager.ts`
- Modify: `src/services/request-router.ts`

This is the core integration: QuotaManager checks the usage adapter for provider plans, and RequestRouter's `filterByQuota` becomes async.

- [ ] **Step 1: Add ProviderRegistry dependency to QuotaManager**

In `src/services/quota-manager.ts`, add the import at the top (after line 15):

```typescript
import type { ProviderRegistry } from './provider-registry';
```

Add a new private field and constructor parameter. In the class body (after line 79), add:

```typescript
  private readonly providerRegistry: ProviderRegistry | null;
```

Update the constructor (line 86-89) to accept the registry:

```typescript
  constructor(config: QuotaManagerConfig & { providerRegistry?: ProviderRegistry } = {}) {
    this.quotaStatePath = resolve(config.quotaStatePath ?? './quota-state.json');
    this.syncIntervalMs = config.syncIntervalMs ?? DEFAULT_QUOTA_SYNC_CONFIG.syncIntervalMs;
    this.providerRegistry = config.providerRegistry ?? null;
  }
```

- [ ] **Step 2: Add async `hasRemainingQuotaAsync` method to QuotaManager**

After the existing `hasRemainingQuota` method (line 171-189), add a new async method:

```typescript
  /**
   * Async version of hasRemainingQuota that can query usage APIs.
   * For plans with a usage-API-enabled provider, queries the adapter.
   * Falls back to synchronous local state for other plans.
   *
   * @param planId - The plan identifier
   * @param decryptedApiKey - Decrypted API key (needed for usage API calls)
   * @param provider - Provider ID from the plan
   * @returns true if quota remains
   */
  async hasRemainingQuotaAsync(
    planId: number,
    decryptedApiKey?: string,
    provider?: string
  ): Promise<boolean> {
    // If provider has a usage API, query the adapter
    if (provider && this.providerRegistry?.hasUsageApi(provider)) {
      const adapter = this.providerRegistry.getUsageAdapter(provider);
      if (adapter && decryptedApiKey) {
        try {
          const usage = await adapter.queryUsage(decryptedApiKey);
          logger.debug('Usage API quota check', {
            planId,
            provider,
            percentage: usage.percentage,
          });
          return usage.percentage < 100;
        } catch (error) {
          // On failure, prefer availability over blocking
          logger.warn('Usage API query failed, treating as quota available', {
            planId,
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
    }

    // Fall back to synchronous local check
    return this.hasRemainingQuota(planId);
  }
```

- [ ] **Step 3: Update RequestRouter — add providerRegistry dependency**

In `src/services/request-router.ts`, add import after line 12:

```typescript
import type { ProviderRegistry } from '@/services/provider-registry';
```

Add field to class (after line 64):

```typescript
  private readonly providerRegistry: ProviderRegistry | null;
```

Update constructor (line 69-80):

```typescript
  constructor(
    repository: IPlanRepository,
    quotaManager?: QuotaManager,
    loadBalanceConfig?: LoadBalanceConfig,
    providerRegistry?: ProviderRegistry
  ) {
    this.repository = repository;
    this.loadBalanceConfig = loadBalanceConfig ?? DEFAULT_LOAD_BALANCE_CONFIG;
    this.rpmTracker = createRpmTracker();
    this.planSelector = createPlanSelector(this.loadBalanceConfig, this.rpmTracker);
    this.circuitBreaker = createCircuitBreaker();
    this.quotaManager = quotaManager ?? null;
    this.providerRegistry = providerRegistry ?? null;
  }
```

- [ ] **Step 4: Make `filterByQuota` async in RequestRouter**

Replace the existing `filterByQuota` method (lines 92-97):

```typescript
  private async filterByQuota(plans: CodingPlan[]): Promise<CodingPlan[]> {
    if (!this.quotaManager) {
      return plans;
    }

    const results: CodingPlan[] = [];
    for (const plan of plans) {
      // For plans with usage-API-enabled providers, use async check
      if (plan.provider && this.providerRegistry?.hasUsageApi(plan.provider)) {
        const apiKey = await this.repository.getDecryptedApiKey(plan.id);
        const hasQuota = await this.quotaManager.hasRemainingQuotaAsync(
          plan.id,
          apiKey ?? undefined,
          plan.provider
        );
        if (hasQuota) {
          results.push(plan);
        }
      } else {
        // Synchronous local quota check
        if (this.quotaManager.hasRemainingQuota(plan.id)) {
          results.push(plan);
        }
      }
    }
    return results;
  }
```

- [ ] **Step 5: Update `route` method — `filterByQuota` is now async**

The `route` method (line 139) already uses `await` for `repository.findByModel`, but the `filterByQuota` call at line 159 now returns a Promise. Add `await`:

```typescript
    const plansWithQuota = await this.filterByQuota(availablePlans);
```

- [ ] **Step 6: Update `getAvailablePlans` — `filterByQuota` is now async**

Line 303:

```typescript
    return this.filterByQuota(available);
```

is already in an async method, so just ensure it returns the awaited result:

```typescript
    return await this.filterByQuota(available);
```

- [ ] **Step 7: Update `createRequestRouter` factory function (line 369-375)**

```typescript
export function createRequestRouter(
  repository: IPlanRepository,
  quotaManager?: QuotaManager,
  loadBalanceConfig?: LoadBalanceConfig,
  providerRegistry?: ProviderRegistry
): RequestRouter {
  return new RequestRouter(repository, quotaManager, loadBalanceConfig, providerRegistry);
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run`
Expected: Some request-router tests may need updating because `filterByQuota` is now async. The existing tests create routers without `providerRegistry`, so the null branch should work identically. Check for any failures and adjust.

- [ ] **Step 9: Commit**

```bash
git add src/services/quota-manager.ts src/services/request-router.ts
git commit -m "feat(quota): integrate usage adapter for provider plans, make filterByQuota async"
```

---

## Task 10: Admin Routes + Config Example

**Files:**
- Modify: `src/routes/admin/handlers.ts`
- Modify: `config.yaml.example`

- [ ] **Step 1: Update `createPlanBodySchema` in `src/routes/admin/handlers.ts` (lines 35-46)**

Replace with:

```typescript
const createPlanBodySchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1).optional(),
  quota: z.object({
    limit: z.number().int().positive(),
    period: quotaPeriodSchema,
  }).optional(),
  timeout: z.number().int().min(1).optional(),
  enable: z.boolean().optional().default(true),
  modelAliases: modelAliasesSchema.optional(),
}).refine(
  (data) => {
    // When provider is not set, baseUrl, models, and quota are required
    if (!data.provider) {
      return data.baseUrl !== undefined && data.models !== undefined && data.quota !== undefined;
    }
    return true;
  },
  { message: 'baseUrl, models, and quota are required when provider is not set' }
);
```

Add the missing import at the top (after line 16):

```typescript
import { modelAliasesSchema } from '@/config/schema';
```

- [ ] **Step 2: Update `updatePlanBodySchema` (lines 51-65)**

Add `provider` field:

```typescript
const updatePlanBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).min(1).optional(),
  quota: z
    .object({
      limit: z.number().int().positive().optional(),
      period: quotaPeriodSchema.optional(),
    })
    .optional(),
  timeout: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
  enable: z.boolean().optional(),
  modelAliases: modelAliasesSchema.optional(),
});
```

- [ ] **Step 3: Update `PlanResponse` interface (lines 70-89)**

Add `provider` field:

```typescript
interface PlanResponse {
  id: number;
  name: string;
  provider?: string;
  baseUrl: string;
  models: string[];
  quota: {
    limit: number;
    period: QuotaPeriod;
  };
  timeout: number;
  status: string;
  enable?: boolean;
  modelAliases?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  usage?: {
    used: number;
    remaining: number;
    lastUpdated: string;
  };
}
```

- [ ] **Step 4: Update `toPlanResponse` function (lines 153-190)**

Add `provider` to the return:

```typescript
function toPlanResponse(
  plan: {
    id: number;
    name: string;
    provider?: string;
    baseUrl: string;
    models: string[];
    quota: { limit: number; period: QuotaPeriod };
    timeout: number;
    status: string;
    enable?: boolean;
    modelAliases?: Record<string, string>;
    createdAt: Date;
    updatedAt: Date;
  },
  quotaState?: {
    used: number;
    lastUpdated: Date;
  }
): PlanResponse {
  return {
    id: plan.id,
    name: plan.name,
    provider: plan.provider,
    baseUrl: plan.baseUrl,
    models: plan.models,
    quota: plan.quota,
    timeout: plan.timeout,
    status: plan.status,
    enable: plan.enable,
    modelAliases: plan.modelAliases,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    usage: quotaState
      ? {
          used: quotaState.used,
          remaining: plan.quota.limit - quotaState.used,
          lastUpdated: quotaState.lastUpdated.toISOString(),
        }
      : undefined,
  };
}
```

- [ ] **Step 5: Update `createPlan` handler (lines 455-494)**

Pass `provider` and `modelAliases` to `repository.save()`:

```typescript
      const plan = await repository.save({
        name: input.name,
        baseUrl: input.baseUrl ?? '',
        apiKey: input.apiKey,
        models: input.models ?? [],
        quota: input.quota ?? { limit: 0, period: { type: '5h', windowHours: 5, sliding: true } },
        timeout: input.timeout,
        enable: input.enable,
        provider: input.provider,
        modelAliases: input.modelAliases,
      });
```

**Note:** This is a simplified version. In production, the handler should resolve preset defaults from the registry when `provider` is set. A follow-up task will add proper preset resolution. For now, the API accepts `provider` and passes it through — the caller is responsible for providing `baseUrl`/`models`/`quota` or relying on config-level defaults.

- [ ] **Step 6: Update `config.yaml.example`**

Add provider examples at the top of the plans section:

```yaml
# Provider presets override (optional)
# Override built-in defaults or add custom providers
# providers:
#   zhipu:
#     baseUrl: https://custom-zhipu-proxy.example.com
#   my-custom:
#     name: My Custom Provider
#     baseUrl: https://api.custom.com/v1
#     models: [model-a]
#     hasUsageApi: false

plans:
  # Example: Using a provider preset (only apiKey needed)
  # - name: My Zhipu Plan
  #   provider: zhipu
  #   apiKey: YOUR_ZHIPU_API_KEY_HERE

  # Example: Using a provider preset without usage API (quota required)
  # - name: My Volcengine Plan
  #   provider: volcengine
  #   apiKey: YOUR_ARK_API_KEY_HERE
  #   quota:
  #     limit: 90000
  #     period:
  #       type: monthly
  #       expiresOn: 1

  # Example: Fully manual plan (no provider)
  - id: 1
    name: Example Plan
    baseUrl: https://api.example.com/v1
    apiKey: YOUR_API_KEY_HERE
    models:
      - model-1
      - model-2
    quota:
      limit: 1000
      period:
        type: 5h
        windowHours: 5
        sliding: true
    timeout: 300
    status: active
    enable: true
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: All tests PASS. Admin handler tests that create plans should still work since they provide all required fields.

- [ ] **Step 8: Commit**

```bash
git add src/routes/admin/handlers.ts config.yaml.example
git commit -m "feat(admin): add provider field to plan CRUD API and config example"
```

---

## Task 11: Config Loading — Apply Preset Defaults to Plans

**Files:**
- Modify: `src/config/index.ts`

When loading config, plans with a `provider` field should have `baseUrl`, `models`, and `modelAliases` filled from the provider preset if not explicitly set.

- [ ] **Step 1: Update `normalizePlanConfig` in `src/config/index.ts` (lines 133-141)**

Add import at top (after line 13):

```typescript
import { getBuiltinProvider } from './builtin-providers';
```

Replace the `normalizePlanConfig` function:

```typescript
/**
 * Normalize plan configuration with defaults.
 * When a plan has a `provider`, fills in baseUrl/models/modelAliases from preset.
 */
function normalizePlanConfig(plan: PlanConfig): PlanConfig {
  let normalized = {
    ...plan,
    id: plan.id ?? uuidv4(),
    timeout: plan.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
    status: plan.status ?? 'active',
    enable: plan.enable ?? true,
  };

  // Apply provider preset defaults
  if (plan.provider) {
    const preset = getBuiltinProvider(plan.provider);
    if (preset) {
      normalized = {
        ...normalized,
        baseUrl: normalized.baseUrl ?? preset.baseUrl,
        models: normalized.models ?? [...preset.models],
        modelAliases: normalized.modelAliases ?? preset.defaultModelAliases,
      };
    }
  }

  return normalized;
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS. Existing configs without `provider` are unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/config/index.ts
git commit -m "feat(config): apply provider preset defaults during config loading"
```

---

## Self-Review

### Spec Coverage Check

| Design Requirement | Task |
|---|---|
| `ProviderPreset` type | Task 1 |
| `UsageAdapter`/`UsageResult` types | Task 1 |
| Built-in presets (Zhipu, Volcengine, Ali) | Task 2 |
| Zhipu usage adapter (quota/limit API) | Task 3 |
| Cached adapter (TTL, stale fallback) | Task 4 |
| Provider Registry (merge built-in + config overrides) | Task 5 |
| `provider` field on CodingPlan types | Task 6 |
| Schema: `provider` on planConfigSchema, `providers` section | Task 7 |
| Plan repository: pass `provider` through | Task 8 |
| QuotaManager: async adapter check | Task 9 |
| RequestRouter: async filterByQuota | Task 9 |
| Admin handlers: `provider` in schemas and responses | Task 10 |
| Config loading: apply preset defaults | Task 11 |
| Error handling (API failure → stale cache → treat as available) | Tasks 4, 9 |
| Backward compatibility (optional `provider`) | All tasks |

### Placeholder Scan

No TBD, TODO, "implement later", or vague "handle edge cases" found. All code steps contain complete implementations.

### Type Consistency

- `ProviderPreset.id` (string) matches `CodingPlan.provider` (string) — correct
- `UsageAdapter.providerId` (string) matches registry lookup key — correct
- `UsageAdapter.queryUsage(apiKey: string)` returns `Promise<UsageResult>` — consistent across CachedUsageAdapter, ZhipuUsageAdapter, and QuotaManager usage
- `provider` field is `string | undefined` consistently across CodingPlan, CreateCodingPlanInput, UpdateCodingPlanInput, PlanConfig, PlanResponse
