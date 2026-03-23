# Research: Fix Task Completion Issues

**Feature**: 002-fix-task-completion-issues
**Date**: 2026-03-23

## Research Findings

### 1. Graceful Shutdown Implementation

**Decision**: Use Fastify's `onClose` hook to trigger `quotaManager.shutdown()`

**Rationale**:
- Fastify provides lifecycle hooks specifically for cleanup operations
- The `onClose` hook is called during `app.close()` which is already invoked on SIGINT/SIGTERM
- This approach aligns with Fastify best practices and ADR-001 (Monolithic Single-Process Architecture)

**Investigation Results**:
- Current implementation in `src/app.ts` (lines 60-75) handles SIGINT/SIGTERM but only calls `app.close()`
- `QuotaManager.shutdown()` exists and is well-implemented (`src/services/quota-manager.ts` lines 337-341)
- The quota manager instance is created but not exposed to the app for shutdown

**Implementation Approach**:
1. Modify `createApp()` to accept a `QuotaManager` instance
2. Register an `onClose` hook that calls `quotaManager.shutdown()`
3. Update `src/index.ts` to create and pass the quota manager

**Alternatives Considered**:
- **Process exit handlers**: Less reliable, doesn't integrate with Fastify's lifecycle
- **Separate shutdown service**: Overkill for a single cleanup operation

**Architecture Alignment**: Aligns with ADR-003 (In-Memory Quota Tracking with Persistence)

---

### 2. NPM Scripts Implementation

**Decision**: Add `reload` and `config:validate` scripts using existing configuration utilities

**Rationale**:
- `config:validate` can use the existing `configSchema` from `src/config/schema.ts`
- `reload` requires a running server endpoint or signal mechanism
- Architecture documentation (Section 4) specifies these scripts as expected deployment commands

**Investigation Results**:
- `configSchema` and `planConfigSchema` already exist in `src/config/schema.ts`
- `loadConfig()` in `src/config/index.ts` performs validation
- No hot-reload mechanism currently exists

**Implementation Approach**:
1. **`config:validate`**: Create a CLI script that loads and validates config, exits with appropriate code
2. **`reload`**: Either:
   - Option A: Send SIGHUP to running process (requires PID file)
   - Option B: HTTP endpoint to trigger reload (simpler)
   - **Selected**: Option B - add `/api/reload` endpoint and use curl in npm script

**Alternatives Considered**:
- **External CLI tool**: Unnecessary complexity
- **Signal-based reload**: Requires PID tracking, more complex

**Architecture Alignment**: Aligns with ADR-002 (File-Based Configuration Storage)

---

### 3. Test Coverage Gap Analysis

**Decision**: Add targeted tests for uncovered files to reach 80% threshold

**Current Coverage Analysis**:

| File | Current | Target | Gap | Priority |
|------|---------|--------|-----|----------|
| `src/routes/health/index.ts` | 0% | 80% | 80% | P1 |
| `src/utils/validators.ts` | 0% | 80% | 80% | P1 |
| `src/services/request-proxy.ts` | 51% | 80% | 29% | P1 |
| `src/routes/anthropic/handlers.ts` | 63% | 80% | 17% | P2 |
| `src/routes/openai/handlers.ts` | 69% | 80% | 11% | P2 |

**Uncovered Lines Identified**:
- `health/index.ts`: All 163 lines (streaming health checks, readiness probes)
- `validators.ts`: All 256 lines (input validation helpers)
- `request-proxy.ts`: Lines 297-308, 320-399 (error handling, streaming edge cases)
- `handlers.ts`: Error branches, edge cases in message transformation

**Implementation Approach**:
1. Create `tests/unit/routes/health.test.ts`
2. Create `tests/unit/utils/validators.test.ts`
3. Expand `tests/unit/services/request-proxy.test.ts` for error paths
4. Expand handler tests for error branches

**Architecture Alignment**: Aligns with quality target of 80% minimum coverage (standards.md Section 7.5)

---

### 4. Lint Warning Resolution

**Decision**: Refactor code to meet linting standards without disabling rules

**Warning Categories**:

| Category | Count | Files Affected | Resolution Strategy |
|----------|-------|----------------|---------------------|
| `max-lines-per-function` | 6 | handlers.ts, request-proxy.ts, request-router.ts | Extract helper functions |
| `max-depth` | 2 | handlers.ts | Early returns, guard clauses |
| `max-params` | 2 | request-proxy.ts | Use options object pattern |
| `@typescript-eslint/no-unused-vars` | 10 | test files | Remove or prefix with `_` |

**Refactoring Approach**:

For `max-lines-per-function` (>50 lines):
- Extract streaming response handling into separate functions
- Extract error handling logic into dedicated error handlers
- Use helper functions for repeated patterns

For `max-depth` (>3 levels):
- Use early returns to reduce nesting
- Extract complex conditionals to well-named boolean variables
- Use guard clauses

For `max-params` (>4 parameters):
- Create `RequestOptions` interface for request-proxy methods
- Bundle related parameters into objects

**Code Quality Alignment**:
- Standards.md Section 10.4 specifies: function length max 50 lines, nesting depth max 3, parameters max 4
- This refactoring directly addresses the "Code MUST follow linting standards" ground-rule

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Refactoring breaks existing functionality | Medium | High | Run full test suite after each change |
| Coverage improvements miss edge cases | Low | Medium | Focus on uncovered lines identified by coverage report |
| Shutdown hook not called in all exit scenarios | Low | High | Test with SIGINT, SIGTERM, and normal close |

## Dependencies

- No new external dependencies required
- All changes use existing Fastify, Vitest, and ESLint capabilities

## Open Questions

None - all clarifications resolved through codebase investigation.