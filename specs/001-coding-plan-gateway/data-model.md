# Data Model: Coding Plan Gateway

**Date**: 2026-03-20 | **Feature**: 001-coding-plan-gateway

## Entity Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CodingPlan                              │
│  - id: string (UUID)                                         │
│  - name: string                                              │
│  - baseUrl: string (URL)                                     │
│  - apiKeyEncrypted: string                                   │
│  - models: string[]                                          │
│  - quota: QuotaConfig                                        │
│  - timeout: number (ms)                                      │
│  - status: PlanStatus                                        │
│  - createdAt: Date                                           │
│  - updatedAt: Date                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ has one
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      QuotaState                              │
│  - planId: string (FK)                                       │
│  - used: number                                              │
│  - limit: number                                             │
│  - period: QuotaPeriod                                       │
│  - lastUpdated: Date                                         │
│  - resetAt: Date (optional)                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   RequestLog (future)                        │
│  - id: string (UUID)                                         │
│  - planId: string (FK, optional)                             │
│  - model: string                                             │
│  - inputTokens: number                                       │
│  - outputTokens: number                                      │
│  - status: RequestStatus                                     │
│  - durationMs: number                                        │
│  - error: string (optional)                                  │
│  - timestamp: Date                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Entity Definitions

### 1. CodingPlan

Represents an AI provider subscription configuration.

```typescript
interface CodingPlan {
  /** Unique identifier (UUID v4) */
  id: string;

  /** Human-readable name for the plan */
  name: string;

  /** Base URL for the provider API */
  baseUrl: string;

  /** Encrypted API key (AES-256-GCM) */
  apiKeyEncrypted: string;

  /** List of model identifiers this plan supports */
  models: string[];

  /** Quota configuration */
  quota: QuotaConfig;

  /** Request timeout in milliseconds */
  timeout: number;

  /** Current operational status */
  status: PlanStatus;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

interface QuotaConfig {
  /** Maximum allowed usage */
  limit: number;

  /** Quota reset period */
  period: QuotaPeriod;
}

type PlanStatus =
  | 'active'      // Normal operation
  | 'paused'      // Manually disabled
  | 'error'       // Recent failures, circuit breaker open
  | 'exhausted';  // Quota depleted

type QuotaPeriod =
  | 'daily'       // Resets daily at UTC midnight
  | 'monthly'     // Resets on billing date
  | 'total';      // One-time quota, never resets
```

**Validation Rules**:
- `id`: Valid UUID v4 format
- `name`: 1-100 characters, non-empty
- `baseUrl`: Valid HTTPS URL
- `apiKeyEncrypted`: Non-empty string (encrypted)
- `models`: Array of 1-100 model identifiers
- `quota.limit`: Positive integer
- `timeout`: 1000-300000 ms (1 second to 5 minutes)

**State Transitions**:
```
                ┌──────────┐
                │  active  │◄─────────────┐
                └────┬─────┘              │
                     │                    │
        ┌────────────┼────────────┐       │
        │            │            │       │
        ▼            ▼            ▼       │
  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
  │  paused  │ │  error   │ │ exhausted│ │
  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
       │            │            │       │
       │            │            │       │
       └────────────┴────────────┴───────┘
              (manual or auto recovery)
```

---

### 2. QuotaState

Tracks real-time quota usage for a coding plan.

```typescript
interface QuotaState {
  /** Reference to the coding plan */
  planId: string;

  /** Current usage count */
  used: number;

  /** Maximum allowed (copied from config) */
  limit: number;

  /** Quota period type */
  period: QuotaPeriod;

  /** Last usage update timestamp */
  lastUpdated: Date;

  /** When quota will reset (for daily/monthly) */
  resetAt: Date | null;
}

interface QuotaUpdate {
  planId: string;
  delta: number;  // Can be positive (consume) or negative (refund)
  timestamp: Date;
}
```

**Business Rules**:
- `used` cannot exceed `limit` (enforced at routing time)
- `resetAt` calculated based on `period`:
  - `daily`: Next UTC midnight
  - `monthly`: Next billing date (configured per plan)
  - `total`: null

**Persistence**:
- In-memory during operation
- Persisted to `quota-state.json` every 60 seconds
- Persisted immediately on graceful shutdown

---

### 3. RequestLog (Future Feature)

Records request history for analytics and debugging.

```typescript
interface RequestLog {
  id: string;
  planId: string | null;  // null if routing failed
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: RequestStatus;
  durationMs: number;
  errorMessage?: string;
  timestamp: Date;
}

type RequestStatus =
  | 'success'     // Completed successfully
  | 'failed'      // Provider error
  | 'timeout'     // Request timed out
  | 'cancelled';  // Client disconnected
```

---

## Storage Schema

### Current: File-Based Storage

**config.yaml** (coding plans):
```yaml
version: "1.0"
plans:
  - id: "550e8400-e29b-41d4-a716-446655440000"
    name: "Kimi K2.5 Plan"
    baseUrl: "https://api.moonshot.cn/v1"
    apiKeyEncrypted: "enc:..."  # AES-256-GCM encrypted
    models:
      - "kimi-k2.5"
      - "kimi-k2"
    quota:
      limit: 1000
      period: "monthly"
    timeout: 30000
    status: "active"
    createdAt: "2026-03-20T00:00:00Z"
    updatedAt: "2026-03-20T00:00:00Z"
```

**quota-state.json** (runtime state):
```json
{
  "version": "1.0",
  "lastSync": "2026-03-20T12:00:00Z",
  "states": {
    "550e8400-e29b-41d4-a716-446655440000": {
      "planId": "550e8400-e29b-41d4-a716-446655440000",
      "used": 450,
      "limit": 1000,
      "period": "monthly",
      "lastUpdated": "2026-03-20T11:59:00Z",
      "resetAt": "2026-04-01T00:00:00Z"
    }
  }
}
```

### Future: PostgreSQL Schema

```sql
-- When database is added
CREATE TABLE coding_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  models TEXT[] NOT NULL,
  quota_limit INTEGER NOT NULL,
  quota_period VARCHAR(20) NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID  -- For multi-tenancy (future)
);

CREATE TABLE quota_states (
  plan_id UUID PRIMARY KEY REFERENCES coding_plans(id) ON DELETE CASCADE,
  used INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reset_at TIMESTAMPTZ
);

CREATE TABLE request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES coding_plans(id) ON DELETE SET NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status VARCHAR(20) NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_message TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID  -- For multi-tenancy (future)
);

CREATE INDEX idx_request_logs_plan ON request_logs(plan_id);
CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp);
```

---

## Data Access Patterns

### Read Operations

| Operation | Frequency | Latency Target |
|-----------|-----------|----------------|
| Get plan by ID | High (per request) | <1ms |
| List all plans | Medium (startup, admin) | <10ms |
| Find plans by model | High (per request) | <1ms |
| Get quota state | High (per request) | <1ms |

### Write Operations

| Operation | Frequency | Latency Target |
|-----------|-----------|----------------|
| Update quota usage | High (per request) | <1ms |
| Create/update plan | Low (admin) | <100ms |
| Delete plan | Low (admin) | <100ms |
| Persist quota state | Medium (every 60s) | <100ms |

---

## Data Integrity

### Consistency Rules

1. **Referential Integrity**: QuotaState must reference existing CodingPlan
2. **Quota Bounds**: `used` ≤ `limit` at all times
3. **Status Consistency**: `exhausted` status when `used >= limit`
4. **Encryption**: API keys never stored in plaintext

### Concurrency Handling

- Single-process architecture = no concurrent writes
- File writes use atomic rename pattern
- Future database: use transactions and row-level locking

---

## Future Extensions (Multi-User)

When multi-tenancy is added:

```typescript
interface CodingPlan {
  // ... existing fields ...
  userId: string;  // NEW: Owner reference
}

interface User {
  id: string;
  email: string;
  apiKeyHash: string;  // For API key authentication
  createdAt: Date;
  settings: UserSettings;
}
```

**Migration**:
1. Add `userId` column (nullable initially)
2. Backfill with single default user
3. Make `userId` required
4. Add user-scoped queries