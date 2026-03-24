# NPM Scripts Contract

**Feature**: 003-e2e-docker-testing
**Date**: 2026-03-24

## Overview

This document defines the npm scripts contract for the e2e testing environment lifecycle management.

---

## Scripts

### `npm run e2e:start`

**Purpose**: Build and start the complete e2e test environment.

**Preconditions**:
- Docker daemon running
- `test-config.yaml` exists (copy from `test-config.example.yaml`)

**Postconditions**:
- Gateway container running and healthy
- Claude Code container running
- Logs directories created

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Docker not available |
| 2 | Config file missing |
| 3 | Build failed |
| 4 | Health check timeout |

**Example**:
```bash
$ npm run e2e:start
Building e2e environment...
Creating network 'e2e-network'...
Building gateway image...
Building claude-code image...
Starting containers...
Waiting for gateway to be healthy...
Environment ready!
Gateway: http://localhost:8080
Claude Code: docker exec -it claude-code claude
```

---

### `npm run e2e:stop`

**Purpose**: Stop all e2e test containers without removing them.

**Preconditions**:
- Containers exist (running or stopped)

**Postconditions**:
- All containers stopped
- Containers still exist (can be restarted)

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success (or already stopped) |
| 1 | Docker not available |

**Example**:
```bash
$ npm run e2e:stop
Stopping e2e environment...
Stopping claude-code...
Stopping gateway...
Environment stopped.
```

---

### `npm run e2e:reset`

**Purpose**: Complete cleanup - stop containers, remove containers, remove volumes, rebuild.

**Preconditions**:
- None (safe to run on clean state)

**Postconditions**:
- All containers removed
- All volumes removed
- Images rebuilt

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Docker not available |
| 2 | Cleanup failed |

**Example**:
```bash
$ npm run e2e:reset
Resetting e2e environment...
Stopping containers...
Removing containers...
Removing volumes...
Rebuilding images...
Environment reset complete. Run 'npm run e2e:start' to start fresh.
```

---

### `npm run e2e:logs`

**Purpose**: Tail logs from all containers in real-time.

**Preconditions**:
- Containers running

**Postconditions**:
- Logs streamed to stdout until interrupted (Ctrl+C)

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Interrupted by user |
| 1 | Docker not available |

**Example**:
```bash
$ npm run e2e:logs
Attaching to logs...
gateway      | [INFO] Gateway started on port 8080
gateway      | [INFO] Config loaded: 1 plan(s)
claude-code  | Claude Code ready
^C
```

---

### `npm run e2e:status`

**Purpose**: Check current status of e2e environment.

**Preconditions**:
- None

**Postconditions**:
- Status printed to stdout

**Output Format**:
```
E2E Environment Status:
  Gateway:     [running|stopped|not created]
  Claude Code: [running|stopped|not created]
  Config:      [valid|missing|invalid]
  Logs:        [path to logs directory]
```

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | All services running |
| 1 | Some services not running |
| 2 | Docker not available |

---

## Script Implementation Location

All scripts defined in `package.json` under `scripts` section:

```json
{
  "scripts": {
    "e2e:start": "bash scripts/e2e/start.sh",
    "e2e:stop": "bash scripts/e2e/stop.sh",
    "e2e:reset": "bash scripts/e2e/reset.sh",
    "e2e:logs": "docker-compose -f docker-compose.e2e.yml logs -f",
    "e2e:status": "bash scripts/e2e/status.sh"
  }
}
```

---

## Error Messages

All scripts MUST output clear, actionable error messages:

| Scenario | Error Message |
|----------|---------------|
| Docker not running | "Error: Docker daemon not running. Please start Docker and try again." |
| Config missing | "Error: test-config.yaml not found. Copy test-config.example.yaml and configure your API keys." |
| Build failed | "Error: Failed to build [service]. Check Docker logs for details." |
| Health check timeout | "Error: Gateway failed to start within 60 seconds. Check logs/gateway/ for details." |