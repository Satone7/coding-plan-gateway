# Quickstart: Plan ID Integer Optimization

**Branch**: `010-plan-id-int` | **Date**: 2026-03-26

## Overview

This feature changes plan identifiers from UUID strings to simple integers (1, 2, 3...) for easier user interaction.

## For Users

### Creating a Plan

```bash
# Create a new plan - ID is auto-assigned
curl -X POST http://localhost:8080/api/plans \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Claude Pro",
    "baseUrl": "https://api.anthropic.com",
    "apiKey": "sk-ant-...",
    "models": ["claude-sonnet-4-6"],
    "quota": { "limit": 1000, "period": "monthly" }
  }'

# Response - notice the integer ID
{
  "data": {
    "id": 1,
    "name": "Claude Pro",
    ...
  }
}
```

### Referencing a Plan

```bash
# Get plan by integer ID (instead of UUID)
curl http://localhost:8080/api/plans/1

# Reset quota for plan 2
curl -X POST http://localhost:8080/api/quota/2/reset

# Delete plan 3
curl -X DELETE http://localhost:8080/api/plans/3
```

### Migration (Automatic)

If you have existing plans with UUID IDs:

1. Upgrade the gateway
2. Restart the service
3. Plans are automatically migrated to integer IDs
4. Check `migration-log.json` for the UUID→integer mapping

## For Developers

### Key Changes

| Component | Change |
|-----------|--------|
| `CodingPlan.id` | `string` → `number` |
| `QuotaState.planId` | `string` → `number` |
| URL params | Parse as integer |
| Validators | Integer validation |

### New Files

```
src/
├── services/plan-id-counter.ts    # ID generation service
└── migration/uuid-to-int.ts       # Migration logic
```

### Running Tests

```bash
# Unit tests
npm test -- --grep "plan-id-counter"

# Integration tests
npm test -- --grep "plan.*id"

# All tests
npm test
```

### Validation

The new integer ID schema:

```typescript
const planIdSchema = z.number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
```

### Error Handling

| Scenario | HTTP Status | Error Code |
|----------|-------------|------------|
| Invalid ID format (non-integer) | 400 | INVALID_ID_FORMAT |
| ID not found | 404 | PLAN_NOT_FOUND |
| ID specified in create request | 422 | ID_NOT_ALLOWED |
| Max ID exceeded | 500 | MAX_ID_EXCEEDED |

## Migration Details

### Files Modified

| File | Change |
|------|--------|
| `config.yaml` or `config.json` | Plan IDs converted to integers |
| `quota-state.json` | `planId` converted to integers |
| `plan-id-counter.json` | Created with migration flag |

### Backup

Before migration, original files are backed up:

```
config.yaml.bak.{timestamp}
quota-state.json.bak.{timestamp}
```

### Rollback

If migration fails:

1. Restore from `.bak` files
2. Check `migration-log.json` for error details
3. Report issue with logs attached