# Quickstart: Fix CLI Reload and Key Persistence

**Feature**: 007-fix-cli-reload
**Date**: 2026-03-25

---

## Overview

This feature fixes critical bugs that prevent CLI-based API key management from working correctly. After the fix, API keys created via CLI will be immediately available for authentication.

---

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ LTS for local development
- `ENCRYPTION_KEY` environment variable set (64-character hex string)

---

## Quick Verification

### 1. Start the Gateway

```bash
# Set encryption key
export ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Start the gateway
docker compose up -d
```

### 2. Create an API Key

```bash
# Create a new key
docker exec gateway cpg key create --name "Test Key"

# Expected output:
# API Key Created
# ===============
# ID: 550e8400-e29b-41d4-a716-446655440000
# Name: Test Key
# Key: cpg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Prefix: cpg_a1b2c3d4
# Status: active
# Created: 2026-03-25
#
# ⚠️  Save this key securely - it will not be shown again!
```

### 3. Test the Key Immediately

```bash
# Test the key
docker exec gateway cpg key test cpg_xxxx...

# Expected output:
# Key Test Result
# ===============
# Prefix: cpg_a1b2c3d4
# Status: valid
# Name: Test Key
```

### 4. Verify Reload Endpoint

```bash
# Test the reload endpoint directly
docker exec gateway wget -qO- --post-data='{"type":"api-keys"}' \
  --header='Content-Type: application/json' \
  http://localhost:8080/internal/reload

# Expected output:
# {"success":true,"message":"Reloaded: api-keys","timestamp":"2026-03-25T10:00:00.000Z"}
```

### 5. Test Persistence

```bash
# Create a key
docker exec gateway cpg key create --name "Persistence Test"

# Restart the container
docker compose down
docker compose up -d

# Check if key still exists
docker exec gateway cpg key list

# Expected: The "Persistence Test" key should be listed
```

---

## E2E Testing

### Run E2E Tests

```bash
# Start E2E environment
npm run e2e:start

# Run E2E tests
npm run test:e2e

# All tests should pass
```

### Manual E2E Test

```bash
# Start E2E environment
docker compose -f docker-compose.e2e.yml up -d

# Wait for services to be ready (about 10 seconds)
sleep 10

# Create a key
docker exec gateway cpg key create --name "E2E Test" --json

# Use Claude Code with the key
docker exec -it claude-code claude -p "Say hello in one word"

# Expected: AI responds with a greeting
```

---

## Troubleshooting

### Reload Endpoint Returns 404

**Cause**: `registerReloadRoutes` was not called.

**Fix**: Verify the import and call in `src/app.ts`:
```typescript
import { registerInternalApiKeyRoutes, registerReloadRoutes } from '@/routes/internal';
// ...
await registerReloadRoutes(app, {
  apiKeyManager: options.apiKeyManager,
  usageTracker: options.usageTracker,
});
```

### Reload Returns 401 Unauthorized

**Cause**: `/internal/*` not in `AUTH_EXEMPT_PATHS`.

**Fix**: Update `docker-compose.yaml`:
```yaml
AUTH_EXEMPT_PATHS=/health,/ready,/internal/*
```

### Keys Lost After Restart

**Cause**: Docker volume was removed with `-v` flag.

**Fix**: Use `docker compose down` without `-v` to preserve volumes:
```bash
# Correct - preserves volumes
docker compose down

# Incorrect - removes volumes
docker compose down -v
```

### Permission Denied Writing Keys

**Cause**: `/app/data` directory has wrong permissions.

**Fix**: Verify Dockerfile creates directory with correct ownership:
```dockerfile
RUN mkdir -p /app/config /app/data && chown -R gateway:nodejs /app
```

---

## Verification Checklist

After deploying this fix, verify:

- [ ] `POST /internal/reload` returns 200 without authentication
- [ ] API keys are immediately valid after `cpg key create`
- [ ] `cpg key test` returns "valid" for newly created keys
- [ ] Keys persist across `docker compose down && docker compose up`
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] Claude Code can authenticate with created keys