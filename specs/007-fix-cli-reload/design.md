# Technical Design: Fix CLI Reload and Key Persistence

**Branch**: `007-fix-cli-reload` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/007-fix-cli-reload/spec.md`

---

## Summary

This feature fixes critical bugs preventing CLI-based API key management from working correctly:
1. **Missing endpoint registration**: The `/internal/reload` endpoint exists but is never registered
2. **Authentication blocking internal routes**: Internal routes require auth when they shouldn't
3. **Docker volume persistence verification**: Ensure keys persist across container restarts

The fix involves minimal code changes: importing and calling `registerReloadRoutes` in `src/app.ts` and adding `/internal/*` to authentication exempt paths.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Vitest, Zod
**Storage**: JSON files (`api-keys.json`, `usage-data.json`) in Docker named volume
**Testing**: Vitest (unit, integration), E2E tests in Docker
**Target Platform**: Linux Docker container
**Project Type**: Single (backend only)
**Performance Goals**: <50ms routing overhead (p95), reload request <100ms
**Constraints**: Single-user local deployment, no external network exposure
**Scale/Scope**: Single container, <10 API keys expected

---

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Code Quality | PASS | Minimal changes, following existing patterns |
| Testing | PASS | Will add E2E tests for reload endpoint |
| User Experience | PASS | Keys immediately available improves UX |
| Performance | PASS | No performance impact |
| Security | PASS | Internal routes localhost-only is sufficient |
| Development Workflow | PASS | PR with conventional commits |

**Gate Status**: ✅ PASSED - No violations

---

## Project Structure

### Documentation (this feature)

```text
specs/007-fix-cli-reload/
├── spec.md              # Feature specification
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── openapi.yaml
└── checklists/
    └── requirements.md  # Validation checklist
```

### Source Code (repository root)

```text
src/
├── app.ts                    # MODIFIED: Add registerReloadRoutes call
├── middleware/
│   └── auth.ts               # Context: authentication exemption
├── routes/
│   └── internal/
│       ├── index.ts          # Context: exports registerReloadRoutes
│       ├── reload.ts         # Context: existing reload implementation
│       └── api-keys.ts       # Context: internal API routes
└── config/
    └── defaults.ts           # Context: AUTH_EXEMPT_PATHS default

docker-compose.yaml           # MODIFIED: Add /internal/* to AUTH_EXEMPT_PATHS
tests/
├── e2e/
│   ├── e2e-cli.test.ts       # MODIFIED: Add reload endpoint test
│   └── docker-cli.test.ts    # Context: existing CLI tests
└── integration/
    └── cli/
        └── realtime-key.test.ts  # Context: reload tests
```

**Structure Decision**: Single project structure - minimal changes to existing codebase.

---

## Architecture Alignment

### ADR Alignment

| ADR | Relevance | Alignment |
|-----|-----------|-----------|
| ADR-001 | Monolithic Single-Process | ✅ Fix maintains single-process architecture |
| ADR-002 | File-Based Configuration | ✅ Keys stored in JSON files |
| ADR-003 | In-Memory with Persistence | ✅ Reload syncs memory with file |
| ADR-004 | Dual API Format | ✅ No changes to API format |
| ADR-005 | Quota-Based Load Balancing | ✅ Not affected by this fix |

### Quality Attribute Alignment

| Attribute | Target | Impact |
|-----------|--------|--------|
| Performance | <50ms routing overhead | No impact - reload is admin operation |
| Availability | 99.9% uptime | Improved - keys immediately available |
| Security | API key encryption | Maintained - internal routes localhost-only |
| Maintainability | Tests >80% coverage | Improved - adding E2E tests |

---

## Root Cause Analysis

### Issue 1: Reload Endpoint Not Registered

**Location**: `src/app.ts` line 11-12, 82-88

**Current Code**:
```typescript
import { registerInternalApiKeyRoutes } from '@/routes/internal';
// ...
if (options.apiKeyManager) {
  await registerInternalApiKeyRoutes(app, { ... });
}
```

**Missing**: `registerReloadRoutes` import and call

**Fix**: Add import and call after `registerInternalApiKeyRoutes`

### Issue 2: Authentication Blocking Internal Routes

**Location**: `docker-compose.yaml` line 21

**Current Config**:
```yaml
AUTH_EXEMPT_PATHS=/health,/ready
```

**Missing**: `/internal/*` pattern

**Fix**: Update to `AUTH_EXEMPT_PATHS=/health,/ready,/internal/*`

### Issue 3: Key Persistence

**Investigation Required**: Verify Docker volume `gateway-data` persists correctly.

**Potential Issues**:
1. Volume permissions (non-root user)
2. Directory creation timing
3. User running `docker compose down -v`

---

## Implementation Approach

### Phase 1: Fix Reload Registration (Critical)

1. Import `registerReloadRoutes` in `src/app.ts`
2. Call `registerReloadRoutes` after `registerInternalApiKeyRoutes`
3. Pass `apiKeyManager` and `usageTracker` to reload handler

### Phase 2: Fix Authentication Exemption

1. Update `AUTH_EXEMPT_PATHS` in `docker-compose.yaml`
2. Update default in `src/config/defaults.ts`
3. Verify wildcard pattern works in `isExemptPath` function

### Phase 3: Add E2E Tests

1. Test `/internal/reload` returns 200
2. Test key immediately available after creation
3. Test key persists across container restart

### Phase 4: Verify Volume Persistence

1. Manual test: create key, restart container
2. Verify file exists in volume
3. Add test for persistence