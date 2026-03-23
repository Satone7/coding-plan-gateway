# NPM Scripts Contract

**Feature**: 002-fix-task-completion-issues
**Version**: 1.0

## Overview

This document defines the interface contract for new npm scripts introduced by this feature.

## Script: `config:validate`

### Purpose
Validates the configuration file without starting the server.

### Command
```bash
npm run config:validate
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Configuration is valid |
| 1 | Configuration is invalid or file not found |

### Output

**Success**:
```
✓ Configuration valid: ./config.yaml
```

**Failure**:
```
✗ Configuration invalid: ./config.yaml
plans.0.baseUrl: Invalid url
plans.0.quota.limit: Must be a positive number
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_PATH` | `./config.yaml` | Path to configuration file |

### Arguments

Optional positional argument for config path:
```bash
npm run config:validate -- /path/to/config.yaml
```

---

## Script: `reload`

### Purpose
Triggers configuration hot-reload on a running server.

### Command
```bash
npm run reload
```

### Implementation
Uses HTTP POST to `/api/reload` endpoint.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Reload successful |
| 1 | Reload failed (server not running, invalid config) |

### Output

**Success**:
```json
{"success":true,"planCount":3}
```

**Failure**:
```json
{"success":false,"error":"Configuration validation failed: ..."}
```

### Prerequisites
- Server must be running on `localhost:8080`
- `/api/reload` endpoint must be accessible

---

## Graceful Shutdown Contract

### Behavior

When the application receives `SIGINT` or `SIGTERM`:

1. Stop accepting new requests
2. Complete in-flight requests (within timeout)
3. Call `quotaManager.shutdown()`:
   - Stop periodic sync timer
   - Persist quota state to file
4. Exit with code 0

### Guarantees

- Quota state is persisted before exit
- Shutdown completes within 30 seconds
- Process exits cleanly (no hanging)

### Error Handling

If quota persistence fails:
- Log the error
- Continue shutdown (don't hang)
- Exit with code 1 (indicates issue)