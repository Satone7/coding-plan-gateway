# Research: Fix CLI Reload and Key Persistence

**Feature**: 007-fix-cli-reload
**Date**: 2026-03-25

---

## Research Tasks

### R-001: Reload Endpoint Implementation Analysis

**Question**: How is the reload endpoint currently implemented and why is it not registered?

**Findings**:

The reload endpoint implementation exists at `src/routes/internal/reload.ts`:

```typescript
export async function registerReloadRoutes(
  app: FastifyInstance,
  options: ReloadRoutesOptions
): Promise<void> {
  const { apiKeyManager, usageTracker, prefix = '/internal' } = options;
  const handlers = createHandlers(apiKeyManager, usageTracker);

  await app.register(
    (fastify, _options, done) => {
      // POST /internal/reload - Reload data from storage
      fastify.post('/reload', handlers.reload);
      done();
    },
    { prefix }
  );
}
```

**Root Cause**: In `src/app.ts`, the `registerReloadRoutes` function is **never imported or called**. Only `registerInternalApiKeyRoutes` is imported and called.

**Decision**: Import `registerReloadRoutes` from `@/routes/internal` and call it in `createApp()`.

**Rationale**: The existing implementation is correct; only the registration is missing.

**Alternatives Considered**:
1. Combine reload into internal API routes - Rejected because reload is a separate concern from CRUD operations
2. Create separate route file - Rejected because implementation already exists

---

### R-002: Authentication Exemption Pattern

**Question**: How does the authentication exemption work and how should `/internal/*` be exempted?

**Findings**:

The authentication middleware in `src/middleware/auth.ts` uses `isExemptPath` function:

```typescript
export function isExemptPath(path: string, exemptPaths: string[]): boolean {
  return exemptPaths.some((exemptPath) => {
    // Exact match
    if (path === exemptPath) {
      return true;
    }
    // Prefix match for paths ending with *
    if (exemptPath.endsWith('*')) {
      const prefix = exemptPath.slice(0, -1);
      return path.startsWith(prefix);
    }
    return false;
  });
}
```

**Decision**: Add `/internal/*` to `AUTH_EXEMPT_PATHS` environment variable. The wildcard pattern will match all paths starting with `/internal/`.

**Rationale**:
- Minimal change - just update configuration
- Follows existing pattern for exemption
- Wildcard matches all internal routes including reload

**Alternatives Considered**:
1. Register internal routes before auth middleware - Rejected because it requires restructuring app initialization
2. Use separate Fastify instance for internal routes - Rejected as over-engineering
3. Add authentication exemption inside route handlers - Rejected as mixing concerns

---

### R-003: Docker Volume Persistence

**Question**: Why might API keys be lost after container restart?

**Findings**:

Docker compose configuration:
```yaml
volumes:
  - gateway-data:/app/data

volumes:
  gateway-data:
    driver: local
```

This configuration is **correct**. Named volumes persist across `docker compose down` (without `-v`).

**Potential Issues**:
1. **User running `docker compose down -v`**: The `-v` flag removes volumes
2. **Permission issues**: Container runs as non-root user `gateway` (uid 1001)
3. **Directory creation timing**: `/app/data` must exist before volume mount

**Verification Steps**:
1. Check if `/app/data` exists with correct permissions
2. Verify file is written to `/app/data/api-keys.json`
3. Test persistence with `docker compose down && docker compose up`

**Decision**: Verify Dockerfile creates `/app/data` directory with correct permissions. The current Dockerfile already does this:
```dockerfile
RUN mkdir -p /app/config /app/data && chown -R gateway:nodejs /app
```

**Rationale**: The configuration appears correct; need to verify in actual runtime.

---

### R-004: E2E Test Structure

**Question**: How should E2E tests verify the reload endpoint?

**Findings**:

Existing E2E tests in `tests/e2e/e2e-cli.test.ts` use `execInGateway()` helper to run commands in the container.

**Decision**: Add test case for reload endpoint using `httpInGateway()` helper:

```typescript
describe('POST /internal/reload', () => {
  it('should return 200 without authentication', () => {
    const result = httpInGateway('POST', '/internal/reload', { type: 'api-keys' });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });
});
```

**Rationale**: Follows existing test patterns, tests both endpoint registration and authentication exemption.

---

## Architecture Alignment

| Decision | Architecture Principle | Alignment |
|----------|----------------------|-----------|
| Import and call existing function | Simplicity | ✅ Minimal code change |
| Wildcard exemption pattern | Security | ✅ Localhost-only access |
| Verify volume configuration | Reliability | ✅ Data persistence |
| Follow existing test patterns | Maintainability | ✅ Consistent test structure |

---

## Summary of Decisions

| ID | Decision | Implementation |
|----|----------|----------------|
| D-001 | Import and call `registerReloadRoutes` | 2-line change in `src/app.ts` |
| D-002 | Add `/internal/*` to exempt paths | Update `docker-compose.yaml` and `defaults.ts` |
| D-003 | Verify volume persistence | Manual testing, add E2E test |
| D-004 | Add E2E tests for reload | New test case in `e2e-cli.test.ts` |