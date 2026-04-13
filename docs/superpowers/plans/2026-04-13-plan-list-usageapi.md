# Plan List Enhancement for UsageApi Plans - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `cpg plan list` to display cached percentage for usageApi plans and add plan ID column.

**Architecture:** Add file-based `UsageApiCacheStore` service that gateway writes to during periodic sync and CLI reads for plan list. Extend table display to handle usageApi plans with "API-managed" text and add ID column.

**Tech Stack:** TypeScript, Zod validation, file-based JSON storage, existing CLI formatter pattern

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/usage-api-cache-store.ts` | **New** - cache store service |
| `src/types/cli.ts` | Extend `PlanUsageSummaryDisplay` with usageApi fields |
| `src/config/defaults.ts` | Add `DEFAULT_USAGE_API_CACHE_PATH` and `loadPlanUsageConfig` extension |
| `src/index.ts` | Wire cache store into gateway startup and periodic sync |
| `src/cli/commands/plan.ts` | Load cache, handle usageApi vs non-usageApi plans, add ProviderRegistry dependency |
| `src/cli/output/table.ts` | Update table header, add ID column, handle usageApi display |
| `tests/unit/services/usage-api-cache-store.test.ts` | **New** - unit tests |

---

### Task 1: Add UsageApiCacheStore Types and Config

**Files:**
- Modify: `src/types/cli.ts:95-104`
- Modify: `src/config/defaults.ts:134-157`

- [ ] **Step 1: Extend PlanUsageSummaryDisplay in src/types/cli.ts**

Add usageApi fields to the interface:

```typescript
/**
 * Plan usage summary for list display.
 */
export interface PlanUsageSummaryDisplay {
  planId: number;
  planName: string;
  limit: number;
  used: number;
  remaining: number;
  percentage: number;
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  resetAt: Date | null;
  /** True if this plan's provider has a usage API */
  isUsageApi?: boolean;
  /** Cached percentage from usage API (0-100) */
  usageApiPercentage?: number;
  /** Quota windows from usage API */
  usageApiWindows?: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
  /** Whether cached data is stale (past TTL) */
  isCacheStale?: boolean;
}
```

- [ ] **Step 2: Add cache path config in src/config/defaults.ts**

Extend `PLAN_USAGE_DEFAULTS` and `loadPlanUsageConfig`:

```typescript
/**
 * Plan usage tracking configuration defaults.
 */
export const PLAN_USAGE_DEFAULTS = {
  planUsageDataPath: './data/plan-usage-data.json',
  adjustmentHistoryPath: './data/usage-adjustment-history.json',
  usageApiCachePath: './data/usage-api-cache.json',
  syncIntervalMs: 60000, // 60 seconds
  retentionDays: 90,
};

/**
 * Plan usage environment variable names.
 */
export const PLAN_USAGE_ENV_VARS = {
  PLAN_USAGE_DATA_PATH: 'PLAN_USAGE_DATA_PATH',
  ADJUSTMENT_HISTORY_PATH: 'ADJUSTMENT_HISTORY_PATH',
  USAGE_API_CACHE_PATH: 'USAGE_API_CACHE_PATH',
} as const;

/**
 * Loads plan usage configuration from environment variables.
 * Falls back to defaults for missing values.
 */
export function loadPlanUsageConfig(): {
  planUsageDataPath: string;
  adjustmentHistoryPath: string;
  usageApiCachePath: string;
} {
  return {
    planUsageDataPath: process.env[PLAN_USAGE_ENV_VARS.PLAN_USAGE_DATA_PATH] ?? PLAN_USAGE_DEFAULTS.planUsageDataPath,
    adjustmentHistoryPath: process.env[PLAN_USAGE_ENV_VARS.ADJUSTMENT_HISTORY_PATH] ?? PLAN_USAGE_DEFAULTS.adjustmentHistoryPath,
    usageApiCachePath: process.env[PLAN_USAGE_ENV_VARS.USAGE_API_CACHE_PATH] ?? PLAN_USAGE_DEFAULTS.usageApiCachePath,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/cli.ts src/config/defaults.ts
git commit -m "feat(config): add UsageApiCache config and extend PlanUsageSummaryDisplay

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create UsageApiCacheStore Service

**Files:**
- Create: `src/services/usage-api-cache-store.ts`
- Test: `tests/unit/services/usage-api-cache-store.test.ts`

- [ ] **Step 1: Write the failing test for cache store initialization**

Create `tests/unit/services/usage-api-cache-store.test.ts`:

```typescript
/**
 * Unit tests for UsageApiCacheStore service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  UsageApiCacheStore,
  createUsageApiCacheStore,
  type UsageApiCacheEntry,
} from '@/services/usage-api-cache-store';

describe('UsageApiCacheStore', () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `usage-api-cache-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    cachePath = join(tempDir, 'usage-api-cache.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create empty cache file if not exists', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const content = await readFile(cachePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.version).toBe('1.0');
      expect(data.entries).toEqual({});
    });

    it('should load existing cache entries', async () => {
      const existingData = {
        version: '1.0',
        lastSync: '2026-04-13T03:00:00.000Z',
        entries: {
          '3': {
            planId: 3,
            planName: 'Zhipu_3',
            provider: 'zhipu',
            percentage: 72,
            windows: [{ type: 'TOKENS_LIMIT', percentage: 72, windowLabel: '5h' }],
            lastUpdated: '2026-04-13T03:00:00.000Z',
            expiresAt: '2026-04-13T03:05:00.000Z',
          },
        },
      };
      await writeFile(cachePath, JSON.stringify(existingData, null, 2), 'utf-8');

      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entry = store.getEntry(3);
      expect(entry).not.toBeNull();
      expect(entry?.planName).toBe('Zhipu_3');
      expect(entry?.percentage).toBe(72);
    });
  });

  describe('updateEntry and getEntry', () => {
    it('should update and retrieve cache entry', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entryData: UsageApiCacheEntry = {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [{ type: 'TOKENS_LIMIT', percentage: 72, windowLabel: '5h' }],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };

      store.updateEntry(3, entryData);
      const entry = store.getEntry(3);

      expect(entry?.percentage).toBe(72);
      expect(entry?.isStale).toBe(false);
    });

    it('should mark entry as stale when expired', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entryData: UsageApiCacheEntry = {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Expired 5 min ago
      };

      store.updateEntry(3, entryData);
      const entry = store.getEntry(3);

      expect(entry?.isStale).toBe(true);
    });

    it('should return null for missing entry', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      const entry = store.getEntry(999);
      expect(entry).toBeNull();
    });
  });

  describe('getAllEntries', () => {
    it('should return all entries', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.updateEntry(4, {
        planId: 4,
        planName: 'Zhipu_6',
        provider: 'zhipu',
        percentage: 45,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      const entries = store.getAllEntries();
      expect(entries.size).toBe(2);
      expect(entries.get(3)?.percentage).toBe(72);
      expect(entries.get(4)?.percentage).toBe(45);
    });
  });

  describe('persist', () => {
    it('should persist entries to file', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      await store.persist();

      const content = await readFile(cachePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.entries['3'].percentage).toBe(72);
    });
  });

  describe('clearOrphanEntries', () => {
    it('should remove entries for deleted plans', async () => {
      const store = createUsageApiCacheStore({ cachePath });
      await store.initialize();

      store.updateEntry(3, {
        planId: 3,
        planName: 'Zhipu_3',
        provider: 'zhipu',
        percentage: 72,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.updateEntry(5, {
        planId: 5,
        planName: 'DeletedPlan',
        provider: 'zhipu',
        percentage: 10,
        windows: [],
        lastUpdated: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      store.clearOrphanEntries([3]);

      const entries = store.getAllEntries();
      expect(entries.size).toBe(1);
      expect(entries.has(5)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/services/usage-api-cache-store.test.ts`
Expected: FAIL with "Cannot find module '@/services/usage-api-cache-store'"

- [ ] **Step 3: Create UsageApiCacheStore service**

Create `src/services/usage-api-cache-store.ts`:

```typescript
/**
 * UsageApiCacheStore - Persists usage API query results for CLI access.
 * Gateway writes during periodic sync; CLI reads for plan list display.
 *
 * @module services/usage-api-cache-store
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { PLAN_USAGE_DEFAULTS } from '@/config/defaults';
import { logger } from '@/utils/logger';

/**
 * Cache entry for a single plan's usage API data.
 */
export interface UsageApiCacheEntry {
  planId: number;
  planName: string;
  provider: string;
  percentage: number;
  windows: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
  lastUpdated: string;
  expiresAt: string;
}

/**
 * Retrieved entry with stale status.
 */
export interface UsageApiCacheEntryWithStatus extends UsageApiCacheEntry {
  isStale: boolean;
}

/**
 * File storage format.
 */
interface UsageApiCacheFile {
  version: string;
  lastSync: string;
  entries: Record<string, UsageApiCacheEntry>;
}

/**
 * UsageApiCacheStore configuration.
 */
export interface UsageApiCacheStoreConfig {
  cachePath?: string;
}

/**
 * UsageApiCacheStore - File-based cache for usage API results.
 *
 * Keyed by planId (not provider+apiKey hash) because CLI doesn't have decrypted keys.
 * Gateway writes after each successful API query; CLI reads for plan list.
 *
 * TTL: 5 minutes (matching CachedUsageAdapter.cacheTTL)
 */
export class UsageApiCacheStore {
  private readonly cachePath: string;
  private readonly entries: Map<number, UsageApiCacheEntry> = new Map();

  constructor(config: UsageApiCacheStoreConfig = {}) {
    this.cachePath = resolve(config.cachePath ?? PLAN_USAGE_DEFAULTS.usageApiCachePath);
  }

  /**
   * Initialize by loading existing cache from file.
   */
  async initialize(): Promise<void> {
    await this.loadFromFile();
    logger.info('UsageApiCacheStore initialized', {
      entryCount: this.entries.size,
      cachePath: this.cachePath,
    });
  }

  /**
   * Load cache for read-only access (CLI mode).
   * Same as initialize but without logging initialization.
   */
  async loadReadOnly(): Promise<void> {
    await this.loadFromFile();
  }

  /**
   * Update or create a cache entry.
   *
   * @param planId - The plan ID
   * @param entry - The entry data
   */
  updateEntry(planId: number, entry: UsageApiCacheEntry): void {
    this.entries.set(planId, entry);
  }

  /**
   * Get a cache entry with stale status.
   * Returns null if entry doesn't exist.
   *
   * @param planId - The plan ID
   * @returns Entry with stale status, or null
   */
  getEntry(planId: number): UsageApiCacheEntryWithStatus | null {
    const entry = this.entries.get(planId);
    if (!entry) {
      return null;
    }

    const isStale = Date.now() >= new Date(entry.expiresAt).getTime();
    return { ...entry, isStale };
  }

  /**
   * Get all entries as a map.
   *
   * @returns Map of planId to entry
   */
  getAllEntries(): Map<number, UsageApiCacheEntry> {
    return new Map(this.entries);
  }

  /**
   * Remove entries for plans that no longer exist in config.
   *
   * @param validPlanIds - Set of valid plan IDs
   */
  clearOrphanEntries(validPlanIds: number[]): void {
    const validSet = new Set(validPlanIds);
    for (const [planId] of this.entries) {
      if (!validSet.has(planId)) {
        this.entries.delete(planId);
        logger.debug('Removed orphan cache entry', { planId });
      }
    }
  }

  /**
   * Persist cache to file.
   */
  async persist(): Promise<void> {
    const entriesRecord: Record<string, UsageApiCacheEntry> = {};

    for (const [planId, entry] of this.entries) {
      entriesRecord[String(planId)] = entry;
    }

    const data: UsageApiCacheFile = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      entries: entriesRecord,
    };

    // Ensure directory exists
    const dir = dirname(this.cachePath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.cachePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    const { rename } = await import('fs/promises');
    await rename(tempPath, this.cachePath);

    logger.debug('Usage API cache persisted', {
      path: this.cachePath,
      entryCount: this.entries.size,
    });
  }

  /**
   * Load cache from file.
   */
  private async loadFromFile(): Promise<void> {
    try {
      await access(this.cachePath, constants.R_OK);
    } catch {
      // File doesn't exist, start with empty cache
      return;
    }

    try {
      const content = await readFile(this.cachePath, 'utf-8');
      const data = JSON.parse(content) as UsageApiCacheFile;

      for (const [planIdStr, entry] of Object.entries(data.entries)) {
        const planId = parseInt(planIdStr, 10);
        if (isNaN(planId)) {
          logger.warn('Skipping invalid planId in cache', { planIdStr });
          continue;
        }
        this.entries.set(planId, entry);
      }

      logger.debug('Loaded usage API cache from file', {
        entryCount: this.entries.size,
        lastSync: data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load usage API cache, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get the cache file path.
   */
  getCachePath(): string {
    return this.cachePath;
  }
}

/**
 * Create a new UsageApiCacheStore instance.
 */
export function createUsageApiCacheStore(config?: UsageApiCacheStoreConfig): UsageApiCacheStore {
  return new UsageApiCacheStore(config);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/services/usage-api-cache-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/usage-api-cache-store.ts tests/unit/services/usage-api-cache-store.test.ts
git commit -m "feat(cache): add UsageApiCacheStore for gateway/CLI data sharing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Wire UsageApiCacheStore into Gateway

**Files:**
- Modify: `src/index.ts:46-178`

- [ ] **Step 1: Import and create cache store in gateway startup**

Read the current `src/index.ts` around line 46 where providerRegistry is created, and add the cache store integration.

Add import near top of file after other service imports:
```typescript
import { createUsageApiCacheStore } from '@/services/usage-api-cache-store';
```

Add after providerRegistry creation (around line 46-50):
```typescript
// Create and initialize usage API cache store for gateway/CLI data sharing
const usageApiCacheStore = createUsageApiCacheStore({
  cachePath: planUsageConfig.usageApiCachePath,
});
await usageApiCacheStore.initialize();
```

- [ ] **Step 2: Update refreshQuotaData loop to write cache**

Modify the `refreshQuotaData` function (around line 131-156) to update cache store after successful API query:

```typescript
const refreshQuotaData = async (): Promise<void> => {
  // Refresh usage-API plans
  for (const plan of usageApiPlans) {
    try {
      const decryptedKey = isApiKeyEncrypted(plan.apiKey)
        ? decryptApiKey(plan.apiKey, encryptionKey)
        : plan.apiKey;
      const adapter = providerRegistry.getUsageAdapter(plan.provider!);
      if (!adapter) continue;
      const result = await adapter.queryUsage(decryptedKey);

      // Update dashboard metrics
      dashboardMetrics.setProviderUsage(plan.name, {
        windows: (result.windows ?? []).map((w) => ({
          type: w.type,
          percentage: w.percentage,
          windowLabel: w.windowLabel,
          nextResetTime: w.nextResetTime,
        })),
        lastUpdated: new Date().toISOString(),
      });

      // Update cache store for CLI access
      const planId = typeof plan.id === 'number' ? plan.id : undefined;
      if (planId) {
        usageApiCacheStore.updateEntry(planId, {
          planId,
          planName: plan.name,
          provider: plan.provider!,
          percentage: result.percentage,
          windows: (result.windows ?? []).map((w) => ({
            type: w.type,
            percentage: w.percentage,
            windowLabel: w.windowLabel,
            nextResetTime: w.nextResetTime,
          })),
          lastUpdated: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min TTL
        });
      }
    } catch (err) {
      logger.debug('Failed to fetch usage-API data for dashboard', {
        planName: plan.name,
        error: (err as Error).message,
      });
    }
  }

  // Persist cache after all updates
  await usageApiCacheStore.persist();

  // Clear orphan entries (plans that no longer exist in config)
  const validPlanIds = config.plans
    .map((p) => typeof p.id === 'number' ? p.id : undefined)
    .filter((id) => id !== undefined) as number[];
  usageApiCacheStore.clearOrphanEntries(validPlanIds);

  // ... rest of existing refresh logic for non-usageApi plans
};
```

- [ ] **Step 3: Add shutdown hook for cache store**

Add near other shutdown hooks (around line 200-214):
```typescript
// Add shutdown hook for usage API cache store
app.addHook('onClose', async () => {
  logger.info('Shutting down usage API cache store...');
  await usageApiCacheStore.persist();
});
```

- [ ] **Step 4: Run type-check**

Run: `pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(gateway): integrate UsageApiCacheStore into periodic sync

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update CLI plan list command

**Files:**
- Modify: `src/cli/commands/plan.ts:49-104`

- [ ] **Step 1: Add imports for cache store and provider registry**

Add imports at top of file:
```typescript
import { createUsageApiCacheStore } from '@/services/usage-api-cache-store';
import { createProviderRegistry } from '@/services/provider-registry';
```

- [ ] **Step 2: Update handlePlanListCommand to load cache and handle usageApi**

Replace the summary building logic (lines 79-101) with:

```typescript
export async function handlePlanListCommand(context: CliContext): Promise<void> {
  const { formatter } = context;

  // Load plans from repository
  const configPath = process.env.CONFIG_PATH || './config.yaml';
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const planUsageConfig = loadPlanUsageConfig();

  const repository = createPlanRepository(configPath, encryptionKey);
  const tracker = createPlanUsageTracker({ planUsageDataPath: planUsageConfig.planUsageDataPath });
  const usageApiCache = createUsageApiCacheStore({ cachePath: planUsageConfig.usageApiCachePath });
  const providerRegistry = createProviderRegistry();

  try {
    await repository.reload();
    await tracker.initialize();
    await usageApiCache.loadReadOnly();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to initialize: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }

  const plans = await repository.findAll();

  if (plans.length === 0) {
    console.log(formatter.formatPlanList([]));
    return;
  }

  // Build plan usage summaries
  const summaries: PlanUsageSummaryDisplay[] = plans.map((plan) => {
    const planId = plan.id;

    // Check if this plan has a usage API provider
    const isUsageApi = plan.provider && providerRegistry.hasUsageApi(plan.provider);

    if (isUsageApi) {
      // Usage API plan: get cached data
      const cacheEntry = usageApiCache.getEntry(planId);

      // Get next reset time from first window if available
      const resetAt = cacheEntry?.windows?.[0]?.nextResetTime
        ? new Date(cacheEntry.windows[0].nextResetTime)
        : null;

      return {
        planId,
        planName: plan.name,
        isUsageApi: true,
        usageApiPercentage: cacheEntry?.percentage ?? undefined,
        usageApiWindows: cacheEntry?.windows ?? undefined,
        isCacheStale: cacheEntry?.isStale ?? true, // Stale if no cache
        // Placeholder values for display (will show "API-managed" / "N/A")
        limit: 0,
        used: 0,
        remaining: 0,
        percentage: cacheEntry?.percentage ?? 0,
        quotaPeriod: { type: 'total' }, // Displayed as "API" or "API (stale)"
        resetAt,
      };
    }

    // Non-usage API plan: use existing logic
    const usage = tracker.getTotalUsage(planId);
    const remaining = plan.quota.limit - usage;
    const percentage = plan.quota.limit > 0 ? Math.round((usage / plan.quota.limit) * 100) : 0;

    const resetAt = tracker.calculateResetAt(
      plan.quota.period,
      plan.expiresOn,
      plan.expiresAt
    );

    return {
      planId,
      planName: plan.name,
      isUsageApi: false,
      limit: plan.quota.limit,
      used: usage,
      remaining,
      percentage,
      quotaPeriod: plan.quota.period,
      resetAt,
    };
  });

  console.log(formatter.formatPlanList(summaries));
}
```

- [ ] **Step 3: Run type-check**

Run: `pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/plan.ts
git commit -m "feat(cli): integrate UsageApiCacheStore into plan list command

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Update table formatter display

**Files:**
- Modify: `src/cli/output/table.ts:422-454`

- [ ] **Step 1: Update formatPlanList table header and display logic**

Replace `formatPlanList` method (lines 422-454) with:

```typescript
formatPlanList(plans: PlanUsageSummaryDisplay[]): string {
  if (plans.length === 0) {
    return [
      '',
      'No plans found.',
      '',
    ].join('\n');
  }

  const lines: string[] = ['', 'Plans with Usage Summary:', ''];

  const header = '  ID  Name                 Limit            Used     Remaining  %     Period    Reset';
  const separator = '  --- -------------------- ---------------- -------- ---------- ----- --------- -------------------';

  lines.push(header);
  lines.push(separator);

  for (const plan of plans) {
    const id = String(plan.planId).padStart(3);
    const name = truncate(plan.planName, 20).padEnd(20);

    if (plan.isUsageApi) {
      // Usage API plan display
      const limit = 'API-managed'.padEnd(16);
      const used = 'N/A'.padStart(8);
      const remaining = 'N/A'.padStart(10);
      const percentage = (plan.usageApiPercentage ?? 0).toString().padStart(3);
      const periodLabel = plan.isCacheStale ? 'API (stale)' : 'API';
      const period = periodLabel.padEnd(9);
      const reset = plan.resetAt ? formatDateTime(plan.resetAt) : 'N/A';

      lines.push(`  ${id}  ${name} ${limit} ${used} ${remaining} ${percentage}%  ${period} ${reset}`);
    } else {
      // Regular plan display
      const limit = plan.limit.toLocaleString().padStart(16);
      const used = plan.used.toLocaleString().padStart(8);
      const remaining = plan.remaining.toLocaleString().padStart(10);
      const percentage = plan.percentage.toString().padStart(3);
      const period = formatQuotaPeriod(plan.quotaPeriod).padEnd(9);
      const reset = plan.resetAt ? formatDateTime(plan.resetAt) : 'N/A';

      lines.push(`  ${id}  ${name} ${limit} ${used} ${remaining} ${percentage}%  ${period} ${reset}`);
    }
  }

  lines.push(separator);
  lines.push('', `  Total: ${plans.length} plan(s)`, '');
  return lines.join('\n');
}
```

- [ ] **Step 2: Run type-check**

Run: `pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/output/table.ts
git commit -m "feat(cli): update plan list table with ID column and usageApi display

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Integration test and final verification

**Files:**
- Test manually with CLI

- [ ] **Step 1: Build the project**

Run: `pnpm build`
Expected: SUCCESS

- [ ] **Step 2: Run all unit tests**

Run: `pnpm test:unit`
Expected: All PASS

- [ ] **Step 3: Manual verification - test plan list command**

Run the CLI plan list command against a config with usageApi plans:
```bash
./cpg plan list
```

Expected output should show:
- ID column with plan IDs
- UsageApi plans (like Zhipu) show "API-managed" for Limit, "N/A" for Used/Remaining
- Percentage from cache (or 0% if no cache)
- "API" or "API (stale)" for Period

- [ ] **Step 4: Final commit if any fixes needed**

If any issues found during manual testing, fix and commit.

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Add plan ID column - Task 5
- [x] Display cached percentage for usageApi plans - Task 4, Task 5
- [x] Show "API-managed" / "N/A" for usageApi limit/used/remaining - Task 5
- [x] Indicate stale cache status - Task 4, Task 5

**2. Placeholder scan:**
- No TBD/TODO placeholders found
- All code blocks contain actual implementation code
- All test blocks contain actual test code

**3. Type consistency:**
- `PlanUsageSummaryDisplay` extended consistently across cli.ts, plan.ts, table.ts
- `UsageApiCacheEntry` defined in cache store and used consistently
- `isUsageApi`, `usageApiPercentage`, `isCacheStale` fields used consistently

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-13-plan-list-usageapi.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**