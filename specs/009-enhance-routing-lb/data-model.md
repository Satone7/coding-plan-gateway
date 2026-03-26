# Data Model: Enhance Gateway Routing and Load Balancing

**Feature**: 009-enhance-routing-lb
**Date**: 2026-03-26

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Plan Configuration                        │
│  (Extended from existing)                                        │
├─────────────────────────────────────────────────────────────────┤
│  + expiresOn?: number (1-31)     # Day of month expiration      │
│  + expiresAt?: string (ISO 8601) # Exact expiration datetime    │
│  + weight?: number (1-100)       # LB weight, default 1         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Quota State                             │
│  (Existing - no changes)                                         │
├─────────────────────────────────────────────────────────────────┤
│  planId: string                                                  │
│  used: number                                                    │
│  limit: number                                                   │
│  lastUpdated: Date                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          RPM Tracker                             │
│  (New entity)                                                    │
├─────────────────────────────────────────────────────────────────┤
│  planId: string                                                  │
│  buckets: RpmBucket[6]  # 6 buckets × 10 seconds each           │
│  currentBucketIndex: number                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Load Balancing Config                        │
│  (New entity)                                                    │
├─────────────────────────────────────────────────────────────────┤
│  strategy: LoadBalanceStrategy                                   │
│  factorWeights: FactorWeights                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Entities

### 1. Plan Configuration (Extended)

**Source**: `src/types/coding-plan.ts`

```typescript
interface CodingPlan {
  // Existing fields
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;  // Encrypted at rest
  models: string[];
  quota: {
    limit: number;
    used: number;
    period: 'daily' | 'monthly' | 'total';
  };
  timeout?: number;
  isActive?: boolean;

  // NEW FIELDS
  expiresOn?: number;    // Day of month (1-31), null = no expiration
  expiresAt?: string;    // ISO 8601 datetime, takes precedence over expiresOn
  weight?: number;       // LB weight (1-100), default 1, higher = more priority
}
```

**Validation Rules**:
| Field | Type | Constraints |
|-------|------|-------------|
| expiresOn | number? | 1-31 if specified |
| expiresAt | string? | Valid ISO 8601 datetime if specified |
| weight | number? | 1-100 if specified, default 1 |

**Field Precedence**: When both `expiresOn` and `expiresAt` are specified, `expiresAt` takes precedence.

### 2. Quota State (Existing)

**Source**: `src/types/quota.ts`

No changes required. Existing entity tracks:
- `planId: string`
- `used: number`
- `limit: number`
- `lastUpdated: Date`

### 3. RPM Tracker (New)

**Source**: `src/types/rpm-tracker.ts`

```typescript
interface RpmBucket {
  timestamp: number;  // Unix timestamp / 10 (10-second granularity)
  count: number;      // Request count in this bucket
}

interface RpmTrackerState {
  planId: string;
  buckets: RpmBucket[6];  // Fixed 6 buckets for 60-second window
}
```

**State Transitions**:
```
[New Request] → recordRequest() → Update current bucket count
[Query RPM]   → getRpm()        → Sum all non-expired buckets
[10s elapsed] → rotateBucket()  → Advance bucket index, reset count
```

### 4. Load Balancing Config (New)

**Source**: `src/types/load-balancing.ts`

```typescript
type LoadBalanceStrategy =
  | 'quota-priority'      // Highest quota remaining (existing behavior)
  | 'round-robin'         // Cycle through plans
  | 'weighted-round-robin' // Cycle with weights
  | 'random';             // Random selection

interface FactorWeights {
  expiration: number;  // Weight for expiration factor (default 0.4)
  rpm: number;         // Weight for RPM factor (default 0.4)
  quota: number;       // Weight for quota factor (default 0.2)
}

interface LoadBalanceConfig {
  strategy: LoadBalanceStrategy;
  factorWeights: FactorWeights;
}
```

**Validation Rules**:
- `factorWeights.expiration + factorWeights.rpm + factorWeights.quota` must equal 1.0
- Each weight must be >= 0 and <= 1

### 5. Plan Score (Computed)

**Source**: `src/services/plan-selector.ts`

```typescript
interface PlanScore {
  planId: string;
  totalScore: number;
  components: {
    expiration: number;  // 0-100
    rpm: number;         // 0-100
    quota: number;       // 0-100
  };
}
```

**Score Calculation**:
```
totalScore = (expirationScore × 0.4) + (rpmScore × 0.4) + (quotaScore × 0.2)
```

## Relationships

```
CodingPlan 1───1 QuotaState
CodingPlan 1───1 RpmTrackerState
CodingPlan *───* LoadBalanceConfig (via strategy selection)
```

## Configuration Schema Changes

### config.yaml Extension

```yaml
# Existing structure
plans:
  - id: "plan-1"
    name: "Primary Plan"
    baseUrl: "https://api.example.com"
    apiKey: "${PLAN_1_API_KEY}"
    models: ["gpt-4", "claude-sonnet-4-6"]
    quota:
      limit: 100000
      used: 0
      period: "monthly"
    # NEW FIELDS
    expiresOn: 28        # Expires on 28th of each month
    weight: 2            # Higher priority for this plan
```

### Gateway Configuration

```yaml
# New top-level config section
loadBalancing:
  strategy: "round-robin"  # or "quota-priority", "weighted-round-robin", "random"
  factorWeights:
    expiration: 0.4
    rpm: 0.4
    quota: 0.2
```

## Data Migration

**Backward Compatibility**: All new fields are optional. Existing configurations work without modification.

| Scenario | Behavior |
|----------|----------|
| No `expiresOn`/`expiresAt` | Plan has no expiration, receives score 10 |
| No `weight` | Default weight of 1 applied |
| No `loadBalancing` config | Default strategy "quota-priority" with default weights |

## Persistence

| Entity | Storage | Persistence |
|--------|---------|-------------|
| Plan Configuration | `config.yaml` | File-based, hot-reload supported |
| Quota State | `quota-state.json` | Periodic sync (60s), in-memory primary |
| RPM Tracker | In-memory only | Lost on restart (acceptable) |
| LB Config | `config.yaml` | File-based, hot-reload supported |