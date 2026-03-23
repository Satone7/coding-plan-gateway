# Data Model: Fix Task Completion Issues

**Feature**: 002-fix-task-completion-issues
**Date**: 2026-03-23

## Overview

This feature does not introduce new data entities. It modifies behavior and code quality of existing components. This document describes the relevant existing data structures.

## Existing Entities

### QuotaState

The quota state that must be persisted during shutdown.

```typescript
interface QuotaState {
  planId: string;
  used: number;
  limit: number;
  period: 'daily' | 'monthly' | 'total';
  lastUpdated: Date;
  resetAt: Date | null;
}
```

**Persistence Location**: `quota-state.json`

**Shutdown Behavior**:
- `QuotaManager.shutdown()` calls `persist()` to write state to file
- File write uses atomic rename (temp file → final file) for corruption safety

### QuotaStateFile (Persistence Format)

```typescript
interface QuotaStateFile {
  version: string;        // "1.0"
  lastSync: string;       // ISO timestamp
  states: Record<string, QuotaStateSerialized>;
}
```

### Config (Configuration File)

```typescript
interface Config {
  version?: string;
  plans: PlanConfig[];
}

interface PlanConfig {
  id: string;             // UUID
  name: string;
  baseUrl: string;        // URL
  apiKey: string;         // Encrypted with 'enc:' prefix
  models: string[];
  quota: {
    limit: number;
    period: 'daily' | 'monthly' | 'total';
  };
  timeout?: number;       // milliseconds
  status?: 'active' | 'paused';
}
```

**Validation**: Performed by Zod schemas in `src/config/schema.ts`

## State Transitions

### Graceful Shutdown Flow

```
Running State
     │
     ▼ (SIGINT/SIGTERM received)
Signal Handler
     │
     ▼
app.close() called
     │
     ▼
onClose hook triggered
     │
     ▼
quotaManager.shutdown()
     │
     ├── stopPeriodicSync()
     │
     └── persist() → quota-state.json
     │
     ▼
Process exits (code 0)
```

### Configuration Validation Flow

```
config.yaml/json file
     │
     ▼
Parse content (YAML/JSON)
     │
     ▼
Expand environment variables
     │
     ▼
configSchema.safeParse()
     │
     ├── Success → Exit 0
     │
     └── Failure → Print errors, Exit 1
```

## Data Integrity

### Quota State Persistence Guarantees

1. **Atomic writes**: Uses temp file + rename pattern
2. **Directory creation**: Ensures parent directory exists before write
3. **Error handling**: Logs errors but doesn't prevent shutdown completion
4. **Periodic sync**: Every 60 seconds (configurable) as backup to shutdown persistence

### Configuration Validation Rules

Enforced by Zod schemas:
- `planConfigSchema`: Validates plan structure
- `configSchema`: Validates full configuration
- All plans must have valid UUIDs, URLs, and non-empty names/models
- Quota limits must be positive integers