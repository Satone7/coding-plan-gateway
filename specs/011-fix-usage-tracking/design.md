# Technical Design: Fix Usage Tracking Issues

**Branch**: `011-fix-usage-tracking` | **Date**: 2026-03-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/011-fix-usage-tracking/spec.md`

## Summary

Fix two usage tracking bugs: (1) `expiresOn` configuration not reflected in usage report reset dates, and (2) `set-usage` command not syncing with `QuotaManager` causing data inconsistency. The solution unifies usage tracking with `PlanUsageTracker` as the single source of truth.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), Vitest (testing), bcrypt (key hashing)
**Storage**: JSON files (`plan-usage-data.json`, `usage-adjustment-history.json`)
**Testing**: Vitest for unit/integration tests
**Target Platform**: Linux server (Docker or bare-metal)
**Project Type**: Single project (backend-only)
**Performance Goals**: <50ms routing overhead (p95), quota lookups <1ms
**Constraints**: Single-user local deployment, file-based persistence
**Scale/Scope**: 10+ coding plans, in-memory quota tracking

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | ✅ Pass | Follows existing patterns, single responsibility maintained |
| II. Testing | ✅ Pass | All new features will include tests, existing tests must pass |
| III. User Experience | ✅ Pass | Fix improves data consistency and report accuracy |
| IV. Performance | ✅ Pass | No performance regression, maintains <50ms routing overhead |
| Security Requirements | ✅ Pass | No new security-sensitive operations |
| Development Workflow | ✅ Pass | Changes through PR, conventional commits |

## Project Structure

### Documentation (this feature)

```text
specs/011-fix-usage-tracking/
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/rainbow.taskify)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── plan-usage-tracker.ts   # Modified: Add expiresOn support, become single source of truth
│   └── quota-manager.ts        # Modified: Query PlanUsageTracker instead of maintaining own counter
├── cli/
│   └── commands/
│       ├── plan.ts             # Modified: set-usage syncs with QuotaManager
│       └── usage.ts            # Modified: Pass expiresOn to report
├── routes/
│   └── admin/
│       └── handlers.ts         # Modified: API usage reports respect expiresOn
├── types/
│   └── plan-usage.ts           # Modified: PlanInfo interface includes expiresOn
└── utils/
    └── expiration.ts           # Existing: Reuse calculateEffectiveExpiration

tests/
├── unit/
│   └── services/
│       ├── plan-usage-tracker.test.ts  # Modified: Add expiresOn tests
│       └── quota-manager.test.ts       # Modified: Add integration tests
└── integration/
    └── cli/
        └── plan-usage-sync.test.ts     # New: E2E tests for set-usage sync
```

**Structure Decision**: Single project structure maintained. Changes are localized to services, CLI commands, and routes. No new directories required.

## Architecture Alignment

| ADR | Alignment |
|-----|-----------|
| ADR-001 | ✅ Single-process architecture preserved |
| ADR-002 | ✅ File-based storage continued (`plan-usage-data.json`) |
| ADR-003 | ✅ In-memory tracking with persistence maintained, unified source |
| ADR-004 | ✅ No changes to API format support |
| ADR-005 | ✅ Quota-based load balancing unchanged |

## Complexity Tracking

> No violations requiring justification.