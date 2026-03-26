# Technical Design: Plan ID Integer Optimization

**Branch**: `010-plan-id-int` | **Date**: 2026-03-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/010-plan-id-int/spec.md`

## Summary

Replace UUID-based plan identifiers with simple auto-incrementing integers (1, 2, 3...) to improve usability. The implementation includes: (1) modifying the `CodingPlan` type to use `number` for IDs, (2) adding a `PlanIdCounter` for atomic ID generation, (3) migrating existing UUID configs to integers on startup, and (4) updating all internal services that reference plan IDs.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: Fastify 4.x, Zod (validation), Vitest (testing)
**Storage**: JSON files (config.json, plan-id-counter.json, quota-state.json)
**Testing**: Vitest with AAA pattern
**Target Platform**: Node.js 20+ LTS, Docker deployment
**Project Type**: Single backend service
**Performance Goals**: <50ms routing overhead (p95), migration completes in <1s
**Constraints**: Single-user local deployment, atomic ID assignment required
**Scale/Scope**: <100 plans expected per user, max 2^53-1 ID value

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Notes |
|------|--------|-------|
| Code follows linting/formatting standards | ✅ PASS | Will follow existing ESLint/Prettier config |
| Functions have single responsibility | ✅ PASS | ID generation, migration, and validation are separate |
| All new features include tests | ✅ PASS | Unit and integration tests planned |
| Tests are independent, isolated, repeatable | ✅ PASS | Using Vitest with proper mocking |
| All inputs validated and sanitized | ✅ PASS | Zod schemas for ID validation |
| Response times meet latency targets | ✅ PASS | Integer comparison is faster than UUID |
| Performance regressions detected in CI | ✅ PASS | Existing test coverage maintained |

**Gate Status**: ✅ PASS - All ground-rules satisfied

## Project Structure

### Documentation (this feature)

```text
specs/010-plan-id-int/
├── spec.md             # Feature specification
├── design.md           # This file
├── research.md         # Phase 0 output
├── data-model.md       # Phase 1 output
├── quickstart.md       # Phase 1 output
├── contracts/          # Phase 1 output
│   └── plan-api.yaml   # OpenAPI spec for plan endpoints
└── tasks.md            # Phase 2 output (not yet created)
```

### Source Code (repository root)

```text
src/
├── types/
│   └── coding-plan.ts          # Modified: id: string → id: number
├── services/
│   ├── plan-id-counter.ts      # NEW: Atomic ID generation service
│   ├── quota-manager.ts        # Modified: Update planId type
│   ├── rpm-tracker.ts          # Modified: Update planId type
│   └── plan-selector.ts        # Modified: Update planId type
├── routes/
│   └── admin/
│       └── handlers.ts         # Modified: Parse integer IDs from params
├── utils/
│   └── validators.ts           # Modified: Integer ID validation
└── migration/
    └── uuid-to-int.ts          # NEW: One-time migration logic

tests/
├── unit/
│   ├── services/
│   │   └── plan-id-counter.test.ts  # NEW: ID generation tests
│   └── migration/
│       └── uuid-to-int.test.ts      # NEW: Migration tests
└── integration/
    └── routes/
        └── plan-id.test.ts          # NEW: API integration tests
```

**Structure Decision**: Single project structure maintained. New `migration/` directory added for one-time migration logic. No new projects or packages required.

## Complexity Tracking

> No violations to justify - design follows existing patterns.

| Aspect | Decision |
|--------|----------|
| ID Type | `number` (JavaScript safe integer) - simplest option |
| Counter Storage | JSON file - consistent with existing config pattern |
| Migration | One-time startup migration - minimal complexity |
| Type Changes | Incremental updates to existing services - no new abstractions |