# Technical Design: Enhance Gateway Routing and Load Balancing

**Branch**: `009-enhance-routing-lb` | **Date**: 2026-03-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/009-enhance-routing-lb/spec.md`

## Summary

This feature addresses four critical issues in the gateway:
1. **Request Passthrough**: Fix Zod validation dropping unknown fields in OpenAI endpoint
2. **Consistent Validation**: Ensure both OpenAI and Anthropic endpoints behave identically
3. **Load Balancing Strategies**: Implement round-robin, weighted-round-robin, and random strategies
4. **Multi-Factor Selection**: Add expiration, RPM, and quota-based scoring for plan selection

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), Vitest (testing)
**Storage**: YAML/JSON files (configuration), in-memory (RPM tracking, quota state)
**Testing**: Vitest with MSW (mocking), integration tests for routing
**Target Platform**: Linux server (Docker container or bare-metal Node.js)
**Project Type**: Single (monolithic API gateway)
**Performance Goals**: <5ms load balancing decision, <50ms total routing overhead (p95)
**Constraints**: Single-user local deployment, no multi-tenancy, in-memory state
**Scale/Scope**: 10+ coding plans, 100+ concurrent requests

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Code Quality** | ✅ Pass | Design follows existing patterns (services, types structure); single responsibility maintained per component |
| **II. Testing** | ✅ Pass | All new features require tests; existing test coverage will be extended; TDD approach for LB strategies |
| **III. User Experience** | ✅ Pass | N/A - Backend API only; error messages remain consistent with existing patterns |
| **IV. Performance** | ✅ Pass | LB decision <5ms target; pure in-memory operations; no blocking I/O in request path |
| **Security** | ✅ Pass | Input validation via Zod (with passthrough); no new secrets/credentials; existing security patterns maintained |
| **Workflow** | ✅ Pass | Changes via PR; conventional commits; existing lint/format standards |

**Gate Status**: ✅ PASSED - No violations, proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/009-enhance-routing-lb/
├── spec.md              # Feature specification
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── config-schema.json
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (NOT created by /rainbow.design)
```

### Source Code (repository root)

```text
src/
├── config/
│   └── schema.ts              # Add expiresOn, expiresAt, weight fields to plan schema
├── routes/
│   ├── openai/
│   │   └── handlers.ts        # Add .passthrough() to Zod schema
│   └── anthropic/
│       └── handlers.ts        # Already has .passthrough(), verify consistency
├── services/
│   ├── plan-selector.ts       # Refactor: multi-strategy support, multi-factor scoring
│   ├── rpm-tracker.ts         # New: sliding window RPM tracking
│   ├── quota-manager.ts       # Existing: no changes needed
│   └── request-router.ts      # Minor: pass RPM tracker to plan selector
├── types/
│   ├── coding-plan.ts         # Add expiresOn, expiresAt, weight fields
│   ├── load-balancing.ts      # New: LB strategy types, scoring types
│   └── rpm-tracker.ts         # New: RPM tracking types
└── utils/
    └── expiration.ts          # New: expiration calculation utilities

tests/
├── unit/
│   ├── services/
│   │   ├── plan-selector.test.ts      # Extended: test all strategies
│   │   └── rpm-tracker.test.ts        # New: RPM tracking tests
│   └── utils/
│       └── expiration.test.ts         # New: expiration calculation tests
└── integration/
    └── routes/
        ├── openai-passthrough.test.ts # New: passthrough verification
        └── anthropic-passthrough.test.ts # New: consistency verification
```

**Structure Decision**: Single project structure - existing pattern maintained. All new code follows the established `src/services/`, `src/types/`, `tests/unit/` organization.

## Architecture Alignment

This design aligns with existing architectural decisions from `docs/architecture.md`:

| ADR | Alignment |
|-----|-----------|
| ADR-001 | Monolithic Single-Process - All LB logic runs in-memory within the single process |
| ADR-002 | File-Based Configuration - Plan config schema extended (expiresOn, expiresAt, weight) |
| ADR-003 | In-Memory Quota Tracking - RPM tracking also in-memory with sliding window |
| ADR-004 | Dual API Format Support - Both endpoints now have consistent passthrough behavior |
| ADR-005 | Quota-Based Load Balancing - Extended with multiple strategies and multi-factor scoring |

## Key Design Decisions

### D1: Zod Passthrough for Request Validation

**Decision**: Add `.passthrough()` to OpenAI endpoint schema to match Anthropic behavior.

**Rationale**:
- Anthropic endpoint already uses `.passthrough()` (line 50 in handlers.ts)
- Transparent proxy behavior requires preserving all fields
- No security concern - upstream provider validates unknown fields

**Implementation**:
```typescript
// src/routes/openai/handlers.ts
const chatCompletionSchema = z.object({
  // ... existing fields
}).passthrough(); // Add passthrough
```

### D2: Strategy Pattern for Load Balancing

**Decision**: Implement strategy pattern with configurable strategy selection.

**Rationale**:
- Open-closed principle - easy to add new strategies
- Configurable per deployment
- Testable in isolation

**Implementation**:
```typescript
// src/types/load-balancing.ts
type LoadBalanceStrategy = 'quota-priority' | 'round-robin' | 'weighted-round-robin' | 'random';

interface LoadBalanceConfig {
  strategy: LoadBalanceStrategy;
  factorWeights?: {
    expiration: number;  // default 0.4
    rpm: number;         // default 0.4
    quota: number;       // default 0.2
  };
}
```

### D3: Sliding Window for RPM Tracking

**Decision**: Use time-bucketed sliding window (6 buckets of 10 seconds each).

**Rationale**:
- O(1) memory per plan (fixed 6 buckets)
- O(1) update and query operations
- Acceptable accuracy (10-second granularity)
- No external dependencies

**Implementation**:
```typescript
// src/services/rpm-tracker.ts
class RpmTracker {
  private buckets: Map<string, number[]>; // planId -> [count per 10s bucket]
  private currentBucketIndex: number;

  recordRequest(planId: string): void { ... }
  getRpm(planId: string): number { ... }
}
```

### D4: Expiration Score Calculation

**Decision**: Use tiered scoring based on time remaining until expiration.

**Rationale**:
- Simple implementation
- Predictable behavior
- Covers all use cases (expiring soon vs long-term plans)

**Score Table**:
| Time Remaining | Score |
|----------------|-------|
| Expired | 0 |
| < 1 hour | 100 |
| 1-24 hours | 90 |
| 1-7 days | 60 |
| 7-30 days | 30 |
| > 30 days | 20 |
| No expiration | 10 |

## Complexity Tracking

> No violations to justify - design follows existing patterns and ground-rules.