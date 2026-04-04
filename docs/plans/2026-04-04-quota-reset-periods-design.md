# Quota Reset Periods Redesign

**Date**: 2026-04-04
**Status**: Approved

## Problem

Current quota reset periods (`daily`, `monthly`, `total`) don't match actual usage patterns. Need to support 5-hour sliding window, weekly, and monthly periods with extensibility for future fixed-time resets.

## Decision

Replace string-based `QuotaPeriod` with structured discriminated-union objects using a `type` field.

## New Period Types

| Type | Behavior | Config Fields |
|------|----------|---------------|
| `5h` | Sliding 5-hour window. Next reset = current resetAt + 5h | `windowHours` (default 5), `sliding` (default true, reserved) |
| `weekly` | Fixed weekday reset at 00:00 UTC | `weekday` (1=Mon, 7=Sun, required) |
| `monthly` | Fixed day-of-month reset at 00:00 UTC | `expiresOn` (1-31, default 1) |
| `total` | Never resets | (none) |

## Type System

```typescript
export type QuotaPeriodType = '5h' | 'weekly' | 'monthly' | 'total';

interface FiveHourPeriod {
  type: '5h';
  windowHours: 5;
  sliding: true;
}

interface WeeklyPeriod {
  type: 'weekly';
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

interface MonthlyPeriod {
  type: 'monthly';
  expiresOn?: number;
}

interface TotalPeriod {
  type: 'total';
}

export type QuotaPeriod = FiveHourPeriod | WeeklyPeriod | MonthlyPeriod | TotalPeriod;
```

## Config Format

```yaml
quota:
  limit: 90000
  period:
    type: "5h"

quota:
  limit: 50000
  period:
    type: "weekly"
    weekday: 1

quota:
  limit: 100000
  period:
    type: "monthly"
    expiresOn: 15

quota:
  limit: 999999
  period:
    type: "total"
```

## Auto-Migration

Old string-based periods are migrated in-memory on config load with a warning log:

| Old format | Migrated to |
|---|---|
| `period: "daily"` | `period: { type: "5h" }` |
| `period: "monthly"` + `expiresOn: 15` | `period: { type: "monthly", expiresOn: 15 }` |
| `period: "monthly"` (no expiresOn) | `period: { type: "monthly", expiresOn: 1 }` |
| `period: "total"` | `period: { type: "total" }` |

No file writes — migration is in-memory only.

## Reset Logic

| Period | `calculateResetAt` behavior |
|--------|-----------------------------|
| `5h` sliding | First: `now + 5h`. Subsequent: `currentResetAt + 5h` (predictable cadence) |
| `weekly` | Next occurrence of `weekday` at 00:00 UTC. Handles same-day and week wrap |
| `monthly` | Next occurrence of `expiresOn` at 00:00 UTC (existing logic, unchanged) |
| `total` | `null` (never resets) |

## Validation Schema

```typescript
const quotaPeriodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('5h'), windowHours: z.number().int().min(1).max(24).optional().default(5), sliding: z.boolean().optional().default(true) }),
  z.object({ type: z.literal('weekly'), weekday: z.number().int().min(1).max(7) }),
  z.object({ type: z.literal('monthly'), expiresOn: z.number().int().min(1).max(31).optional().default(1) }),
  z.object({ type: z.literal('total') }),
]);
```

## API Impact

- `POST/PUT /api/plans`: Accept structured `period` object
- `GET /api/plans`: Return structured `period` object
- `GET /api/usage/:planId`: Return structured `period` in usage report
- `POST /api/quota/:planId/reset`: No change (internal logic)
- `GET /v1/models`: No change

## CLI Impact

`plan list` output updated to display period format: "5h (sliding)", "weekly (Mon)", "monthly (15th)", "total".

## Testing

### Unit Tests

- `calculateResetAt` for each period type including edge cases
- Auto-migration from old string format
- Zod schema validation (valid/invalid objects)
- QuotaManager reset cycle for 5h sliding window

### Integration Tests

- Config loading with new format
- Config migration from old format
- Usage report and admin CRUD with structured period

### Edge Cases

- 5h sliding: consecutive resets use `resetAt + 5h`, not `now + 5h`
- Weekly: UTC timezone to avoid DST issues
- Monthly: month-boundary handling (Feb 31 → Feb 28/29) preserved from existing code

## Files to Modify

- `src/types/coding-plan.ts` — QuotaPeriod type, QuotaConfig interface
- `src/types/quota.ts` — QuotaState, calculateResetAt
- `src/types/plan-usage.ts` — PlanInfo.quota
- `src/config/schema.ts` — Zod schemas
- `src/utils/validators.ts` — quotaPeriodSchema
- `src/utils/expiration.ts` — Expiration calculation utilities
- `src/services/quota-manager.ts` — Reset logic
- `src/services/plan-usage-tracker.ts` — calculateResetAt, resetPlanUsage
- `src/services/expiration-scheduler.ts` — checkExpirations
- `src/routes/admin/handlers.ts` — API handlers
- `src/cli/commands/plan.ts` — CLI display
- `config.yaml.example` — Updated example config
- All related test files
