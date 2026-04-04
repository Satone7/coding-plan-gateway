# Fix Reload Endpoint Path Mismatch

> Date: 2026-04-04 | Fixes: #26 | Issue: #28

## Problem

`GatewayNotifier.notifyReload()` sends POST to `/internal/reload` but the gateway registers the route at `/api/internal/reload` (due to Fastify prefix in `app.ts:97`). This mismatch causes CLI reload notifications to fail, leaving newly created API keys unavailable until gateway restart.

## Root Cause

```
gateway-notifier.ts:140  →  ${gatewayUrl}/internal/reload      (wrong)
app.ts:97                →  registerReloadRoutes(prefix: '/api/internal')
Actual endpoint          →  /api/internal/reload                (correct)
Auth exemption           →  /api/internal/*                     (correct)
```

## Design Decision

**Approach A: Fix hardcoded path** — minimal surgical change.

Alternatives considered:
- Shared constant: only used in one place, doesn't eliminate coupling with Fastify prefix composition
- Configurable path: YAGNI — one caller, one endpoint

## Changes

### Source (1 file, 1 line)

| File | Line | Change |
|------|------|--------|
| `src/services/gateway-notifier.ts` | 140 | `/internal/reload` → `/api/internal/reload` |

### Tests (2 files changed)

| File | Lines | Change |
|------|-------|--------|
| `tests/unit/services/gateway-notifier.test.ts` | 62 | Update expected URL |
| `tests/e2e/e2e-cli.test.ts` | 267, 270 | Update E2E test path |

### No Change Needed

- `tests/integration/request-tracing.test.ts` — registers a mock route directly on a fresh Fastify instance (no `/api` prefix), not the actual reload endpoint
- `tests/integration/cli/realtime-key.test.ts` — registers `registerReloadRoutes` directly on a fresh Fastify instance (no `/api` prefix)
- `tests/unit/routes/internal/reload.test.ts` — tests the route handler in isolation without prefix
- `src/cli/commands/key.ts:83` — fallback URL already correct
- `src/routes/internal/reload.ts`, `src/app.ts`, `src/config/defaults.ts` — all correct

## Testing

- All unit + integration tests pass with updated expectations
- E2E test updated (Docker-dependent, skipped without Docker)
