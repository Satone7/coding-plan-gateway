# Technical Design: Plan Usage Statistics Enhancement

**Branch**: `008-plan-usage-stats` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/008-plan-usage-stats/spec.md`

## Summary

Enhance the plan usage tracking system with daily usage records, manual usage adjustment capabilities, and fix the existing `cpg usage-report` CLI command. The implementation extends the existing QuotaManager to track daily usage per plan and adds new CLI commands for plan usage management.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), Commander.js (CLI), Vitest (testing)
**Storage**: JSON files (plan-usage-data.json, usage-adjustment-history.json)
**Testing**: Vitest with AAA pattern
**Target Platform**: Linux server (Docker), local development
**Project Type**: single
**Performance Goals**: <50ms routing overhead (p95), usage reports <2s for 90 days data
**Constraints**: Single-user local deployment, file-based storage
**Scale/Scope**: 10+ coding plans, 90 days usage history retention

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Code Quality | ✅ Pass | Following established patterns from QuotaManager and UsageTracker |
| Testing | ✅ Pass | Unit tests for all new services, integration tests for CLI commands |
| User Experience | ✅ Pass | Clear error messages, backward compatible CLI commands |
| Performance | ✅ Pass | In-memory tracking with periodic persistence, <2s report generation |
| Security | ✅ Pass | Input validation with Zod, no sensitive data in usage records |
| Development Workflow | ✅ Pass | Conventional commits, PR review process |

## Project Structure

### Documentation (this feature)

```text
specs/008-plan-usage-stats/
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── plan-usage-api.yaml
└── tasks.md             # Phase 2 output (NOT created by this command)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── plan-usage-tracker.ts    # NEW: Daily usage tracking per plan
│   └── quota-manager.ts         # MODIFY: Integration with plan usage
├── cli/
│   ├── commands/
│   │   ├── usage.ts             # MODIFY: Add --plan flag support
│   │   └── plan.ts              # NEW: plan set-usage, plan list commands
│   └── output/
│       └── table.ts             # MODIFY: Add plan usage formatting
├── types/
│   ├── plan-usage.ts            # NEW: Plan usage types and schemas
│   └── index.ts                 # MODIFY: Export new types
└── routes/
    └── admin/
        └── handlers.ts          # MODIFY: Usage adjustment API endpoint

tests/
├── unit/
│   └── services/
│       └── plan-usage-tracker.test.ts  # NEW: Unit tests
└── integration/
    └── cli/
        └── plan-commands.test.ts       # NEW: CLI integration tests
```

**Structure Decision**: Extends existing single-project structure. New `PlanUsageTracker` service follows the same pattern as `UsageTracker` and `QuotaManager`. CLI commands extend existing `cpg` command structure.

## Architecture Decisions

### ADR-001: Separate PlanUsageTracker Service

**Context**: Need to track daily usage per plan with history and adjustments.

**Decision**: Create a dedicated `PlanUsageTracker` service separate from `QuotaManager`.

**Rationale**:
- Single Responsibility: QuotaManager handles quota state; PlanUsageTracker handles daily records
- QuotaManager tracks current usage count (scalar), PlanUsageTracker tracks daily breakdown (time-series)
- Clear separation allows independent testing and evolution

**Consequences**:
- Two services to maintain
- QuotaManager consumes PlanUsageTracker for current usage
- Consistent pattern with existing UsageTracker for API keys

### ADR-002: File-Based Storage for Plan Usage

**Context**: Need persistent storage for daily usage records and adjustment history.

**Decision**: Use JSON files (`plan-usage-data.json`, `usage-adjustment-history.json`) following existing patterns.

**Rationale**:
- Consistent with existing architecture (ADR-002 in architecture.md)
- Human-readable and debuggable
- Simple backup and restore
- Sufficient for single-user local deployment

**Consequences**:
- Same file I/O patterns as existing services
- Atomic writes via temp file + rename
- Periodic sync for durability

### ADR-003: Merge Adjustments into Daily Records

**Context**: When user manually adjusts usage, how to reflect in daily records?

**Decision**: Merge adjustment delta into today's daily record while preserving adjustment history separately.

**Rationale**:
- Daily records remain self-consistent (sum of daily = current usage)
- Adjustment history provides audit trail
- Simplifies report generation

**Consequences**:
- Today's record may have large delta from adjustment
- Historical records remain unchanged
- Adjustment history file grows with each manual adjustment