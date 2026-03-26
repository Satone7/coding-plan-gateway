# Data Model: Fix Usage Tracking Issues

**Feature**: 011-fix-usage-tracking
**Date**: 2026-03-26

## Entity Relationship Diagram

```mermaid
erDiagram
    CodingPlan ||--o{ DailyUsageRecord : "has"
    CodingPlan ||--o| UsageAdjustment : "has"
    CodingPlan {
        number id PK
        string name
        string baseUrl
        string apiKeyEncrypted
        string[] models
        object quota
        number quota.limit
        string quota.period
        number quota.expiresOn "optional, 1-31"
        string quota.expiresAt "optional, ISO 8601"
        number weight "optional, 1-100"
        string status
        date createdAt
        date updatedAt
    }
    DailyUsageRecord {
        number planId FK
        string date PK "YYYY-MM-DD"
        number requestCount
        date lastUpdated
    }
    UsageAdjustment {
        string id PK
        number planId FK
        date timestamp
        number oldValue
        number newValue
        string adjustmentType "count|percent"
        number adjustmentValue
    }
```

## Entities

### DailyUsageRecord

Records daily request counts per plan. This becomes the **single source of truth** for current usage.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| planId | number | Plan identifier | Required, references CodingPlan.id |
| date | string | Date of record (YYYY-MM-DD) | Required, primary key component |
| requestCount | number | Number of requests made | Required, >= 0 |
| lastUpdated | Date | Last modification timestamp | Auto-updated |

**Storage Key**: `${date}:${planId}` (compound string key in Map)

**State Transitions**: None (append-only with updates to existing records)

### UsageAdjustment

Audit trail for manual usage adjustments made via `set-usage`.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | string | UUID identifier | Auto-generated |
| planId | number | Plan identifier | Required |
| timestamp | Date | When adjustment was made | Auto-set |
| oldValue | number | Usage before adjustment | Calculated |
| newValue | number | Usage after adjustment | User-provided |
| adjustmentType | string | How adjustment was specified | "count" or "percent" |
| adjustmentValue | number | Original input value | User-provided |

### PlanInfo (Internal Interface Extension)

Extended to support `expiresOn` in usage reports.

```typescript
interface PlanInfo {
  id: number;
  name: string;
  quota: {
    limit: number;
    period: 'daily' | 'monthly' | 'total';
    expiresOn?: number;    // NEW: Day of month (1-31)
    expiresAt?: string;    // NEW: ISO 8601 datetime
  };
}
```

## Storage Files

### plan-usage-data.json

```json
{
  "version": "1.0",
  "lastSync": "2026-03-26T10:30:00.000Z",
  "records": {
    "2026-03-26": {
      "1": {
        "requestCount": 150,
        "lastUpdated": "2026-03-26T10:30:00.000Z"
      },
      "2": {
        "requestCount": 75,
        "lastUpdated": "2026-03-26T10:25:00.000Z"
      }
    }
  }
}
```

### usage-adjustment-history.json

```json
{
  "version": "1.0",
  "lastSync": "2026-03-26T10:30:00.000Z",
  "adjustments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "planId": 1,
      "timestamp": "2026-03-26T10:30:00.000Z",
      "oldValue": 50,
      "newValue": 100,
      "adjustmentType": "count",
      "adjustmentValue": 100
    }
  ]
}
```

### quota-state.json (Deprecation Path)

**Current**: Stores `used` counter per plan
**Future**: Will be deprecated. `used` will be derived from `PlanUsageTracker.getTotalUsage()`.

Migration approach:
1. Phase 1: `QuotaManager` reads from both sources, prefers `PlanUsageTracker`
2. Phase 2: Remove `used` from `quota-state.json`, use `PlanUsageTracker` only

## Validation Rules

| Rule | Entity | Constraint |
|------|--------|------------|
| VR-001 | DailyUsageRecord | requestCount >= 0 |
| VR-002 | PlanInfo.quota.expiresOn | 1 <= expiresOn <= 31 |
| VR-003 | UsageAdjustment | newValue >= 0 |
| VR-004 | PlanInfo.quota.period | One of: "daily", "monthly", "total" |

## Computed Values

### Current Usage

```typescript
getTotalUsage(planId: number): number {
  // Sum of all daily records for plan
  return Array.from(this.usage.values())
    .filter(r => r.planId === planId)
    .reduce((sum, r) => sum + r.requestCount, 0);
}
```

### Reset Date (with expiresOn)

```typescript
calculateResetDate(plan: PlanInfo): Date | null {
  if (plan.quota.period === 'total') return null;

  // Use calculateEffectiveExpiration for expiresOn/expiresAt support
  const expiration = calculateEffectiveExpiration({
    expiresOn: plan.quota.expiresOn,
    expiresAt: plan.quota.expiresAt
  } as CodingPlan);

  if (expiration) return expiration;

  // Fallback: 1st of next month (monthly) or midnight (daily)
  return this.defaultResetDate(plan.quota.period);
}
```