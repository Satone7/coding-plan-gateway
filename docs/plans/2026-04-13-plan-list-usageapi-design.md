# Design: Plan List Enhancement for UsageApi Plans

**Date**: 2026-04-13
**Status**: Approved

## Problem Statement

Two issues with `cpg plan list` command:

1. **UsageApi plans display incorrectly** - Plans with `provider: zhipu` (hasUsageApi=true) show `Number.MAX_SAFE_INTEGER` as limit (9,007,199,254,740,991), which is meaningless
2. **Missing plan ID column** - Users need plan ID for operations like `cpg plan set-usage --id <id>`

## Solution Overview

- Add file-based cache store for usageApi query results, accessible by both gateway and CLI
- Update `plan list` table to include ID column and display cached percentage for usageApi plans
- Gateway writes to cache during periodic sync; CLI reads from cache (no API calls)

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│    Gateway      │────▶│  UsageApiCacheStore  │
│ (periodic sync) │     │  (data/usage-api-    │
└─────────────────┘     │   cache.json)        │
                        └──────────────────────┘
                                   │
                                   ▼
┌─────────────────┐     ┌──────────────────────┐
│      CLI        │◀────│  plan list reads     │
│  (plan list)    │     │  cached percentages  │
└─────────────────┘     └──────────────────────┘
```

## Data Model

**File: `data/usage-api-cache.json`**

```json
{
  "version": "1.0",
  "lastSync": "2026-04-13T03:13:52.141Z",
  "entries": {
    "3": {
      "planId": 3,
      "planName": "Zhipu_3",
      "provider": "zhipu",
      "percentage": 72,
      "windows": [
        { "type": "TOKENS_LIMIT", "percentage": 72, "windowLabel": "5h", "nextResetTime": 1712981234 },
        { "type": "TOKENS_LIMIT", "percentage": 45, "windowLabel": "1w", "nextResetTime": 1713381234 }
      ],
      "lastUpdated": "2026-04-13T03:13:52.141Z",
      "expiresAt": "2026-04-13T03:18:52.141Z"
    }
  }
}
```

**Type extension in `src/types/cli.ts`:**

```typescript
export interface PlanUsageSummaryDisplay {
  planId: number;
  planName: string;
  limit: number;
  used: number;
  remaining: number;
  percentage: number;
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  resetAt: Date | null;
  // New fields for usageApi plans
  isUsageApi?: boolean;
  usageApiPercentage?: number;
  usageApiWindows?: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
}
```

## New Service: UsageApiCacheStore

**File: `src/services/usage-api-cache-store.ts`**

| Method | Purpose |
|--------|---------|
| `initialize()` | Load existing cache from file, create if missing |
| `loadReadOnly()` | Load for CLI (read-only, no lock/persist concerns) |
| `updateEntry(planId, data)` | Update cache entry after gateway API query |
| `getEntry(planId)` | Get cached entry (returns null if missing, includes `isStale` if expired) |
| `getAllEntries()` | Get all entries for CLI plan list |
| `persist()` | Write cache to disk (gateway only) |
| `clearOrphanEntries(validPlanIds)` | Remove entries for deleted plans |

**Configuration:**

Add to `src/config/defaults.ts`:
```typescript
export const DEFAULT_USAGE_API_CACHE_PATH = './data/usage-api-cache.json';
```

## Gateway Integration

**File: `src/index.ts`**

After providerRegistry initialization:
1. Create and initialize `UsageApiCacheStore`
2. In `refreshQuotaData()` loop, after `adapter.queryUsage()` success:
   - Call `usageApiCacheStore.updateEntry(plan.id, {...})`
   - Call `usageApiCacheStore.persist()`
3. Add shutdown hook for cache store

## CLI Integration

**File: `src/cli/commands/plan.ts`**

Changes to `handlePlanListCommand()`:
1. Load `UsageApiCacheStore` with `loadReadOnly()`
2. For each plan, check `providerRegistry.hasUsageApi(plan.provider)`
3. For usageApi plans: build summary from cache entry
4. For non-usageApi plans: existing logic unchanged

## Table Display

**New format:**
```
  ID  Name                 Limit            Used     Remaining  %     Period    Reset
  --- -------------------- ---------------- -------- ---------- ----- --------- -------------------
  1   Ark                      90,000        429     89,571   0%  monthly (1st) 2026-05-01 00:00:00
  2   Ali                      90,000      3,933     86,067   4%  monthly (27th) 2026-04-27 00:00:00
  3   Zhipu_3              API-managed       N/A      N/A    72%  API            2026-04-13 03:18:52
  4   Zhipu_6              API-managed       N/A      N/A    45%  API (stale)    N/A
```

**File: `src/cli/output/table.ts`**

Changes to `formatPlanList()`:
- Add `ID` column (first column, width 3)
- Adjust column widths: Limit (16 chars), Used (8), Remaining (10)
- For `isUsageApi=true` entries: display "API-managed", "N/A", percentage, "API"/"API (stale)"

## Files Changed

| File | Change |
|------|--------|
| `src/services/usage-api-cache-store.ts` | **New** - cache store service |
| `src/types/cli.ts` | Extend `PlanUsageSummaryDisplay` with usageApi fields |
| `src/config/defaults.ts` | Add `DEFAULT_USAGE_API_CACHE_PATH` |
| `src/index.ts` | Wire cache store into gateway startup and periodic sync |
| `src/cli/commands/plan.ts` | Read cache, differentiate usageApi vs non-usageApi plans |
| `src/cli/output/table.ts` | Update table header, handle usageApi display |
| `tests/unit/services/usage-api-cache-store.test.ts` | **New** - unit tests |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Cache file missing/corrupted | CLI: treat all usageApi as "API (stale)"; Gateway: recreate on persist |
| Gateway not running | CLI: stale cache entries display "API (stale)" label |
| Usage API query fails | Gateway: no cache update; CLI: shows stale if available |
| Plan deleted but in cache | CLI ignores orphans; Gateway clears during sync |
| Concurrent access | No contention: gateway writes during sync, CLI reads only |

## TTL Behavior

- Cache TTL: 5 minutes (matching `CachedUsageAdapter.cacheTTL = 300`)
- Entry includes `expiresAt` timestamp
- CLI checks `Date.now() >= expiresAt` to determine stale status
- Gateway refreshes every 60 seconds (existing behavior), so cache rarely stale while running