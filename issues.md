# CPG CLI Issues Found During Manual Testing

**Date**: 2026-03-25
**Environment**: Docker production environment (docker compose up)
**Branch**: 006-cpg-cli

## Summary

Three critical issues were found when testing the CPG CLI in a Docker production environment:

1. **Critical**: `/internal/reload` endpoint not registered - causes notification failure
2. **Critical**: API keys created via CLI are invalid for authentication
3. **Major**: API keys lost after container restart

---

## Issue 1: `/internal/reload` Endpoint Not Registered

### Description

When creating an API key via `cpg key create`, the CLI attempts to notify the gateway via `POST /internal/reload` to refresh its in-memory key cache. However, this endpoint returns 404 because it was never registered with the Fastify application.

### Root Cause

The `registerReloadRoutes` function exists in `src/routes/internal/reload.ts` but is **never called** in `src/app.ts`.

**Evidence**:
- `src/routes/internal/reload.ts` defines `registerReloadRoutes` function
- `src/routes/internal/index.ts` exports `registerReloadRoutes`
- `src/app.ts` only registers `registerInternalApiKeyRoutes` (lines 82-88) but never imports or calls `registerReloadRoutes`

### Code Reference

```typescript
// src/app.ts - Missing reload routes registration
// Line 82-88: Only registerInternalApiKeyRoutes is called
if (options.apiKeyManager) {
  await registerInternalApiKeyRoutes(app, {
    apiKeyManager: options.apiKeyManager,
    usageTracker: options.usageTracker,
    prefix: '/internal',
  });
}
// registerReloadRoutes is never called!
```

### Reproduction Steps

1. Start the gateway: `docker compose up -d`
2. Create a key: `docker exec gateway cpg key create --name "Test Key"`
3. Observe the warning message:
   ```
   Warning: Failed to notify gateway. Key may not be immediately available.
   Restart the gateway or run: curl -X POST http://localhost:8080/internal/reload
   ```
4. Verify the endpoint doesn't exist:
   ```bash
   docker exec gateway wget -qO- --post-data='{"type":"api-keys"}' --header='Content-Type: application/json' http://localhost:8080/internal/reload
   # Returns 404 Not Found
   ```

### Expected Behavior

The `/internal/reload` endpoint should:
1. Be registered and accessible
2. Accept POST requests without authentication (per spec)
3. Reload the gateway's in-memory key cache from storage

### Impact

- API keys created via CLI are not immediately available for authentication
- Users must manually restart the gateway for new keys to take effect
- Breaks the "real-time key availability" feature specified in FR-011a

---

## Issue 2: API Keys Created via CLI Are Invalid

### Description

API keys created using `cpg key create` cannot be used with Claude Code. The authentication fails with "Invalid API key" error.

### Root Cause

This is a **consequence of Issue 1**. The key creation flow is:

1. CLI creates key and writes to `/app/data/api-keys.json`
2. CLI calls `POST /internal/reload` to notify gateway - **fails with 404**
3. Gateway's in-memory `ApiKeyManager` is never refreshed
4. Authentication attempts fail because the key doesn't exist in memory

The `ApiKeyManager` loads keys only during `initialize()`:
- On startup (line 51 in `src/index.ts`)
- When `/internal/reload` is called (line 78 in `src/routes/internal/reload.ts`)

Since the reload endpoint doesn't exist, the gateway never reloads keys after CLI modifications.

### Reproduction Steps

1. Start gateway: `docker compose up -d`
2. Create a key: `docker exec gateway cpg key create --name "Test Key"`
3. Note the generated key (e.g., `cpg_xxxx...`)
4. Test the key:
   ```bash
   docker exec gateway cpg key test cpg_xxxx...
   # Result: Key is invalid (not found)
   ```
5. Try using with Claude Code (configures ANTHROPIC_API_KEY environment variable)
6. Claude Code fails with authentication error

### Expected Behavior

After `cpg key create`:
1. Key should be immediately valid
2. `cpg key test <key>` should return "valid"
3. Key should work for API authentication

### Workaround

Restart the gateway after creating a key:
```bash
docker compose restart gateway
```

This causes the gateway to reload keys on startup.

---

## Issue 3: API Keys Lost After Container Restart

### Description

After running `docker compose down` followed by `docker compose up`, previously created API keys are lost. Running `cpg key list` returns empty.

### Initial Hypothesis

Data persistence issue with Docker volumes. However, investigation shows the volume configuration appears correct.

### Configuration Review

```yaml
# docker-compose.yaml
services:
  gateway:
    volumes:
      - gateway-data:/app/data  # Named volume for persistence

volumes:
  gateway-data:
    driver: local
```

Environment variables:
```yaml
- API_KEYS_PATH=/app/data/api-keys.json
- USAGE_DATA_PATH=/app/data/usage-data.json
```

### Possible Root Causes

**Hypothesis A: Volume not being used correctly**
- Named volume `gateway-data` should persist data
- Need to verify if data is actually written to `/app/data/api-keys.json`

**Hypothesis B: User running `docker compose down -v`**
- The `-v` flag removes volumes
- Standard `docker compose down` preserves named volumes

**Hypothesis C: Permission issues**
- Dockerfile creates non-root user `gateway` (uid 1001)
- Volume mount might have permission issues

### Reproduction Steps

1. Start gateway: `docker compose up -d`
2. Create a key: `docker exec gateway cpg key create --name "Persistent Test"`
3. Verify key exists: `docker exec gateway cpg key list`
4. Stop containers: `docker compose down` (NOT `docker compose down -v`)
5. Start again: `docker compose up -d`
6. Check keys: `docker exec gateway cpg key list`
   - Expected: Key should still exist
   - Actual: List is empty (keys lost)

### Verification Commands

```bash
# Check if volume exists
docker volume ls | grep gateway-data

# Inspect volume
docker volume inspect coding-plan-gateway_gateway-data

# Check if file exists in volume
docker exec gateway ls -la /app/data/
docker exec gateway cat /app/data/api-keys.json
```

### Impact

- Users lose all API keys on container restart
- Makes the CLI unusable for production key management
- Requires re-creating keys after every deployment

---

## Additional Finding: `/internal/reload` Requires Authentication

### Description

Even if `registerReloadRoutes` was called, the `/internal/reload` endpoint would require authentication because:

1. `registerAuthMiddleware` is called first (line 69-74 in `src/app.ts`)
2. `registerInternalApiKeyRoutes` is called after (line 82-88)
3. Auth middleware applies to all routes except exempt paths

### Auth Exempt Paths

Current exempt paths (from `docker-compose.yaml`):
```yaml
AUTH_EXEMPT_PATHS=/health,/ready
```

The `/internal/reload` path is NOT exempted.

### Spec Requirement

From `specs/006-cpg-cli/spec.md`:
> Q: Does internal API endpoint (`/internal/keys/reload`) require authentication? → A: No authentication needed, localhost-only access provides sufficient security isolation.

### Fix Required

Either:
1. Add `/internal/*` to `AUTH_EXEMPT_PATHS`, OR
2. Register internal routes before auth middleware, OR
3. Use a separate Fastify instance for internal routes

---

## Recommended Fixes

### Fix for Issue 1 & 2: Register Reload Routes

In `src/app.ts`, add:

```typescript
import { registerInternalApiKeyRoutes, registerReloadRoutes } from '@/routes/internal';

// After registerInternalApiKeyRoutes (around line 88):
if (options.apiKeyManager) {
  await registerReloadRoutes(app, {
    apiKeyManager: options.apiKeyManager,
    usageTracker: options.usageTracker,
  });
}
```

### Fix for Authentication Issue

Add `/internal/*` to exempt paths or handle authentication differently for internal routes.

### Fix for Issue 3: Investigate Volume Persistence

1. Verify file is being written to `/app/data/api-keys.json`
2. Check volume mount permissions
3. Ensure volume is not being removed unintentionally

---

## Test Cases to Add

1. E2E test: Verify `/internal/reload` endpoint exists and returns 200
2. E2E test: Create key, call reload, verify key is immediately valid
3. E2E test: Create key, restart container, verify key persists
4. Integration test: Verify reload endpoint works without authentication