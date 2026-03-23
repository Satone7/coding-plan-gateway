# Technical Design: Fix Task Completion Issues

**Branch**: `002-fix-task-completion-issues` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/002-fix-task-completion-issues/spec.md`

## Summary

Fix four incomplete task implementations in the Coding Plan Gateway:
1. **Graceful shutdown**: Hook `quotaManager.shutdown()` into Fastify's close lifecycle
2. **NPM scripts**: Add `reload` and `config:validate` scripts
3. **Test coverage**: Achieve 80%+ coverage by adding tests for uncovered code paths
4. **Lint warnings**: Resolve 20 warnings by refactoring long functions and removing unused imports

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Vitest, Zod, ESLint
**Storage**: YAML/JSON file-based configuration
**Testing**: Vitest with v8 coverage
**Target Platform**: Linux server (local/Docker)
**Project Type**: Single project (backend API)
**Performance Goals**: <50ms routing overhead (p95)
**Constraints**: <30s graceful shutdown timeout
**Scale/Scope**: Single-user local deployment

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Notes |
|------|--------|-------|
| All code MUST follow linting standards | ⚠️ VIOLATED | 20 lint warnings exist |
| All new features MUST include tests | ⚠️ VIOLATED | Coverage at 71%, below 80% threshold |
| Functions MUST have single responsibility | ⚠️ VIOLATED | Several functions exceed 50 lines |
| Tests MUST be independent and isolated | ✅ PASS | Existing tests follow AAA pattern |
| Error messages MUST be clear and actionable | ✅ PASS | Error handling follows standards |

**Justification for violations**: This feature specifically addresses these violations as its primary goal.

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-task-completion-issues/
├── spec.md             # Feature specification
├── design.md           # This file
├── research.md         # Phase 0 research findings
├── data-model.md       # Data model (minimal changes)
├── quickstart.md       # Quick implementation guide
└── contracts/          # N/A - no new APIs
```

### Source Code (repository root)

```text
src/
├── app.ts                    # MODIFIED: Add shutdown hook
├── config/
│   └── index.ts              # EXISTS: Has validation logic
├── routes/
│   ├── anthropic/handlers.ts # MODIFIED: Refactor for lint compliance
│   ├── openai/handlers.ts    # MODIFIED: Refactor for lint compliance
│   └── health/index.ts       # NEEDS TESTS
├── services/
│   ├── request-proxy.ts      # MODIFIED: Refactor for lint compliance
│   └── request-router.ts     # MODIFIED: Refactor for lint compliance
└── utils/
    └── validators.ts         # NEEDS TESTS

tests/
├── integration/routes/        # EXISTS: Integration tests
└── unit/                     # EXISTS: Unit tests
    ├── routes/               # NEW: Add health route tests
    └── utils/                # NEW: Add validators tests

package.json                   # MODIFIED: Add npm scripts
```

**Structure Decision**: Single project structure maintained. Changes are isolated to specific files without structural changes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| ----------- | ------------ | ------------------------------------- |
| None | N/A | N/A |

All changes are simplifications (reducing complexity) rather than additions.