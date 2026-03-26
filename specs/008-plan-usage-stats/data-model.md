# Data Model: Plan Usage Statistics

**Feature**: 008-plan-usage-stats
**Date**: 2026-03-25

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PlanUsageRecord                          │
│  Daily usage entry for a specific plan                          │
├─────────────────────────────────────────────────────────────────┤
│  planId: string (UUID)         - Reference to CodingPlan       │
│  date: string (YYYY-MM-DD)     - Date of usage                 │
│  requestCount: number          - Number of requests that day   │
│  lastUpdated: Date             - Last modification timestamp   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ aggregates to
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PlanUsageReport                          │
│  Aggregated usage report for a plan over a date range           │
├─────────────────────────────────────────────────────────────────┤
│  planId: string (UUID)         - Reference to CodingPlan       │
│  planName: string              - Plan name for display          │
│  totalRequests: number         - Sum of daily request counts    │
│  limit: number                 - Quota limit from plan config   │
│  remaining: number             - Calculated: limit - used       │
│  percentage: number            - Calculated: (used/limit) * 100│
│  dateRange: DateRange          - Start and end dates            │
│  dailyBreakdown: DailyUsage[]  - Array of daily records         │
│  quotaPeriod: QuotaPeriod      - daily | monthly | total        │
│  resetAt: Date | null          - Next reset date if applicable  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    UsageAdjustmentHistory                       │
│  Record of manual usage adjustments                             │
├─────────────────────────────────────────────────────────────────┤
│  id: string (UUID)             - Unique adjustment record ID    │
│  planId: string (UUID)         - Reference to CodingPlan       │
│  timestamp: Date               - When adjustment was made       │
│  oldValue: number              - Usage before adjustment        │
│  newValue: number              - Usage after adjustment         │
│  adjustmentType: 'count' | 'percent' - How adjustment was made │
│  adjustmentValue: number       - Original input value           │
└─────────────────────────────────────────────────────────────────┘
```

## Entity Definitions

### PlanUsageRecord

Daily usage record tracking request counts per plan per day.

```typescript
interface PlanUsageRecord {
  /** Reference to the coding plan (UUID) */
  planId: string;

  /** Date of usage in YYYY-MM-DD format */
  date: string;

  /** Number of requests made on this date */
  requestCount: number;

  /** Timestamp of last update to this record */
  lastUpdated: Date;
}
```

**Validation Rules**:
- `planId` must be a valid UUID
- `date` must match `YYYY-MM-DD` format
- `requestCount` must be non-negative integer
- `lastUpdated` must be a valid Date

**State Transitions**: N/A (append-only with updates)

---

### PlanUsageReport

Aggregated report for display purposes.

```typescript
interface PlanUsageReport {
  /** Reference to the coding plan (UUID) */
  planId: string;

  /** Plan name for display (from CodingPlan config) */
  planName: string;

  /** Total requests in the date range */
  totalRequests: number;

  /** Quota limit from plan configuration */
  limit: number;

  /** Remaining quota: limit - totalRequests */
  remaining: number;

  /** Usage percentage: (totalRequests / limit) * 100 */
  percentage: number;

  /** Date range covered by report */
  dateRange: {
    start: string;
    end: string;
  };

  /** Daily breakdown within the date range */
  dailyBreakdown: DailyPlanUsage[];

  /** Quota period type from plan configuration */
  quotaPeriod: 'daily' | 'monthly' | 'total';

  /** Next reset date for daily/monthly plans */
  resetAt: Date | null;
}

interface DailyPlanUsage {
  /** Date in YYYY-MM-DD format */
  date: string;

  /** Number of requests on this date */
  requestCount: number;
}
```

**Validation Rules**:
- All numeric fields must be non-negative
- `percentage` is calculated, not user-provided
- `remaining` can be negative if usage exceeds limit (overage tracking)

---

### UsageAdjustmentHistory

Audit trail for manual usage corrections.

```typescript
interface UsageAdjustmentHistory {
  /** Unique identifier for this adjustment record (UUID) */
  id: string;

  /** Reference to the coding plan (UUID) */
  planId: string;

  /** When the adjustment was made */
  timestamp: Date;

  /** Usage value before adjustment */
  oldValue: number;

  /** Usage value after adjustment */
  newValue: number;

  /** Method used for adjustment */
  adjustmentType: 'count' | 'percent';

  /** Original input value (e.g., 75 for --percent 75) */
  adjustmentValue: number;
}
```

**Validation Rules**:
- `oldValue` and `newValue` must be non-negative
- `adjustmentType` must be 'count' or 'percent'
- `adjustmentValue` for percent must be 0-100

---

## Storage Schema

### plan-usage-data.json

```json
{
  "version": "1.0",
  "lastSync": "2026-03-25T10:30:00Z",
  "records": {
    "2026-03-25": {
      "plan-uuid-1": {
        "requestCount": 42,
        "lastUpdated": "2026-03-25T10:30:00Z"
      },
      "plan-uuid-2": {
        "requestCount": 15,
        "lastUpdated": "2026-03-25T09:15:00Z"
      }
    },
    "2026-03-24": {
      "plan-uuid-1": {
        "requestCount": 38,
        "lastUpdated": "2026-03-24T23:45:00Z"
      }
    }
  }
}
```

### usage-adjustment-history.json

```json
{
  "version": "1.0",
  "lastSync": "2026-03-25T10:30:00Z",
  "adjustments": [
    {
      "id": "adj-uuid-1",
      "planId": "plan-uuid-1",
      "timestamp": "2026-03-25T10:30:00Z",
      "oldValue": 50,
      "newValue": 100,
      "adjustmentType": "count",
      "adjustmentValue": 100
    },
    {
      "id": "adj-uuid-2",
      "planId": "plan-uuid-2",
      "timestamp": "2026-03-25T09:00:00Z",
      "oldValue": 40,
      "newValue": 150,
      "adjustmentType": "percent",
      "adjustmentValue": 75
    }
  ]
}
```

---

## Relationships

```
CodingPlan (existing)          PlanUsageRecord
┌──────────────────┐           ┌──────────────────┐
│ id: string       │◄──────────│ planId: string   │
│ name: string     │           │ date: string     │
│ quota.limit      │           │ requestCount     │
│ quota.period     │           └──────────────────┘
└──────────────────┘                    │
        │                               │
        │                               ▼
        │                    UsageAdjustmentHistory
        │                    ┌──────────────────┐
        └───────────────────►│ planId: string   │
                             │ oldValue         │
                             │ newValue         │
                             └──────────────────┘
```

---

## Data Lifecycle

1. **Record Creation**: When a request is routed through a plan, `requestCount` is incremented for today's date.

2. **Daily Reset**: For plans with `period: 'daily'`, records remain but `requestCount` resets at midnight UTC.

3. **Manual Adjustment**:
   - Creates `UsageAdjustmentHistory` entry
   - Updates today's `PlanUsageRecord.requestCount` with the delta
   - Updates `QuotaManager` state

4. **Retention**: Records older than 90 days are deleted during cleanup cycle.

5. **Query**: Reports aggregate records within specified date range.