# Data Model: Plan ID Integer Optimization

**Branch**: `010-plan-id-int` | **Date**: 2026-03-26

## Entity Changes

### 1. CodingPlan (Modified)

The `CodingPlan` interface changes its `id` field from `string` to `number`.

**Before (Current)**:
```typescript
interface CodingPlan {
  id: string;  // UUID v4 format
  name: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  models: string[];
  quota: QuotaConfig;
  timeout: number;
  status: PlanStatus;
  expiresOn?: number;
  expiresAt?: string;
}
```

**After (New)**:
```typescript
interface CodingPlan {
  id: number;  // Auto-incremented integer (1, 2, 3...)
  name: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  models: string[];
  quota: QuotaConfig;
  timeout: number;
  status: PlanStatus;
  expiresOn?: number;
  expiresAt?: string;
}
```

**Validation Rules**:
- `id` MUST be a positive integer
- `id` MUST be <= Number.MAX_SAFE_INTEGER (2^53-1)
- `id` MUST be auto-assigned (no manual specification)
- `id` MUST NOT be modified after creation

**State Transitions**:
```
[No ID] → create() → [Assigned ID N]
[Assigned ID N] → delete() → [ID N retired, never reused]
```

---

### 2. PlanIdCounter (New)

Tracks the highest assigned plan ID for auto-increment.

**Interface**:
```typescript
interface PlanIdCounterState {
  /** Highest assigned plan ID */
  lastAssignedId: number;
  /** Migration flag - set after UUID→int migration completes */
  migrationComplete: boolean;
  /** Migration timestamp (ISO 8601) */
  migratedAt?: string;
}
```

**Storage Location**: `{dataDir}/plan-id-counter.json`

**Validation Rules**:
- `lastAssignedId` MUST be >= 0 (0 means no plans created yet)
- `migrationComplete` MUST be true after migration

**State Transitions**:
```
[No file] → initialize() → [lastAssignedId: 0, migrationComplete: false]
[lastAssignedId: N] → increment() → [lastAssignedId: N+1]
[UUID config detected] → migrate() → [migrationComplete: true, migratedAt: timestamp]
```

---

### 3. QuotaState (Modified)

The `planId` field changes from `string` to `number`.

**Before (Current)**:
```typescript
interface QuotaState {
  planId: string;  // UUID
  used: number;
  limit: number;
  period: QuotaPeriod;
  lastResetAt?: string;
  periodStartDate: string;
}
```

**After (New)**:
```typescript
interface QuotaState {
  planId: number;  // Integer ID
  used: number;
  limit: number;
  period: QuotaPeriod;
  lastResetAt?: string;
  periodStartDate: string;
}
```

---

## Relationship Diagram

```
┌─────────────────┐
│ PlanIdCounter   │
│─────────────────│
│ lastAssignedId  │
│ migrationComplete│
└────────┬────────┘
         │ generates
         ▼
┌─────────────────┐       references       ┌─────────────────┐
│   CodingPlan    │◄────────────────────────│   QuotaState    │
│─────────────────│                         │─────────────────│
│ id (PK)         │─────────────────────────│ planId (FK)     │
│ name            │                         │ used            │
│ baseUrl         │                         │ limit           │
│ apiKeyEncrypted │                         │ period          │
│ models[]        │                         └─────────────────┘
│ quota           │
│ timeout         │
│ status          │
└─────────────────┘
         │
         │ tracked by
         ▼
┌─────────────────┐
│   RpmTracker    │
│─────────────────│
│ buckets[planId] │
│ timestamps[]    │
└─────────────────┘
```

## Storage Files

| File | Purpose | Format |
|------|---------|--------|
| `config.json` | Plan configurations | `{ plans: CodingPlan[] }` |
| `plan-id-counter.json` | ID counter state | `PlanIdCounterState` |
| `quota-state.json` | Quota tracking | `QuotaState[]` |
| `usage-data.json` | Usage history | `UsageRecord[]` (planId: number) |

## Migration Mapping

During UUID→Integer migration, a mapping log is created:

```typescript
interface MigrationLog {
  timestamp: string;
  mappings: Array<{
    oldUuid: string;
    newId: number;
    planName: string;
  }>;
}
```

**Storage Location**: `{dataDir}/migration-log.json`

**Retention**: Permanent (for audit purposes)