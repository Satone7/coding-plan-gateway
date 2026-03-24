# Data Model: API Key Management

**Feature**: 005-api-key-management
**Date**: 2026-03-24

## Entities

### API Key

Represents a client credential for gateway access.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID) | Yes | Unique identifier |
| name | string | Yes | Human-readable name for the key |
| keyHash | string | Yes | bcrypt hash of the API key (cost 12) |
| prefix | string | Yes | First 8 chars after prefix for identification (e.g., `abc12345`) |
| status | enum | Yes | `active` or `disabled` |
| createdAt | Date | Yes | Key creation timestamp |
| expiresAt | Date | No | Optional expiration date |
| lastUsedAt | Date | No | Last successful authentication timestamp |

**TypeScript Interface**:
```typescript
interface ApiKey {
  id: string;                    // UUID v4
  name: string;                  // 1-100 characters
  keyHash: string;               // bcrypt hash
  prefix: string;                // 8 characters for identification
  status: 'active' | 'disabled';
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}
```

**Validation Rules**:
- `id`: Must be valid UUID v4 format
- `name`: 1-100 characters, alphanumeric with spaces/hyphens/underscores
- `prefix`: Exactly 8 alphanumeric characters
- `status`: Must be 'active' or 'disabled'
- `expiresAt`: If present, must be future date

**State Transitions**:
```
[Created] --> active
    |
    v
[Disabled] <-- active --> [Enabled] --> active
    |
    v
[Deleted] (permanently removed)
```

---

### Usage Record (Daily)

Represents aggregated usage metrics for an API key on a specific day.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| keyId | string (UUID) | Yes | Reference to API Key |
| date | string (YYYY-MM-DD) | Yes | Date of usage |
| requestCount | number | Yes | Number of API requests |
| inputTokens | number | Yes | Total input tokens consumed |
| outputTokens | number | Yes | Total output tokens consumed |
| lastRequest | Date | Yes | Timestamp of most recent request |

**TypeScript Interface**:
```typescript
interface UsageRecord {
  keyId: string;                 // UUID v4, references ApiKey.id
  date: string;                  // ISO date format YYYY-MM-DD
  requestCount: number;          // Non-negative integer
  inputTokens: number;           // Non-negative integer
  outputTokens: number;          // Non-negative integer
  lastRequest: Date;             // ISO timestamp
}
```

**Composite Key**: `(keyId, date)` - One record per key per day.

---

### Usage Report

Aggregated view of usage data for reporting.

| Field | Type | Description |
|-------|------|-------------|
| keyId | string | API Key ID |
| keyName | string | API Key name (for display) |
| totalRequests | number | Sum of request counts |
| totalInputTokens | number | Sum of input tokens |
| totalOutputTokens | number | Sum of output tokens |
| totalTokens | number | Sum of all tokens |
| dateRange | object | Start and end dates |
| dailyBreakdown | array | Daily records within range |

**TypeScript Interface**:
```typescript
interface UsageReport {
  keyId: string;
  keyName: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  dateRange: {
    start: string;
    end: string;
  };
  dailyBreakdown: DailyUsage[];
}

interface DailyUsage {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}
```

---

## File Storage Schema

### api-keys.json

```json
{
  "version": "1.0",
  "lastUpdated": "2026-03-24T10:30:00Z",
  "keys": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Development Key",
      "keyHash": "$2b$12$...",
      "prefix": "abc12345",
      "status": "active",
      "createdAt": "2026-03-24T10:00:00Z",
      "expiresAt": null,
      "lastUsedAt": "2026-03-24T10:25:00Z"
    }
  ]
}
```

### usage-data.json

```json
{
  "version": "1.0",
  "lastSync": "2026-03-24T10:30:00Z",
  "usage": {
    "2026-03-24": {
      "550e8400-e29b-41d4-a716-446655440000": {
        "requestCount": 150,
        "inputTokens": 45000,
        "outputTokens": 12000,
        "lastRequest": "2026-03-24T10:25:00Z"
      }
    }
  }
}
```

---

## Relationships

```
┌─────────────┐         ┌──────────────────┐
│   ApiKey    │ 1     * │   UsageRecord    │
│─────────────│─────────│──────────────────│
│ id          │         │ keyId (FK)       │
│ name        │         │ date             │
│ keyHash     │         │ requestCount     │
│ prefix      │         │ inputTokens      │
│ status      │         │ outputTokens     │
│ createdAt   │         │ lastRequest      │
│ expiresAt   │         └──────────────────┘
│ lastUsedAt  │
└─────────────┘
```

**Relationship**: One API Key has many Usage Records (one per day of usage).

---

## Index Strategy (In-Memory)

For efficient lookups:

1. **Key by ID**: `Map<string, ApiKey>` - O(1) lookup by UUID
2. **Key by Prefix**: `Map<string, ApiKey>` - O(1) lookup by prefix for display
3. **Usage by Date**: `Map<string, Map<string, UsageRecord>>` - O(1) lookup by date then keyId

---

## Data Migration

No migration needed - this is a new feature. Files will be created on first use if they don't exist.