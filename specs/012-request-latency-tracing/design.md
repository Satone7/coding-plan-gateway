# Technical Design: Request Latency Tracing

**Branch**: `012-request-latency-tracing` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/012-request-latency-tracing/spec.md`

## Summary

Implement request latency tracing to measure and log elapsed time for each processing stage in the Gateway request lifecycle. The feature assigns ANSI colors to concurrent requests for visual differentiation and outputs structured JSON timing summaries. This addresses the user's need to identify performance bottlenecks—specifically, why Gateway access is slower than direct platform access.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x (existing), no new dependencies required
**Storage**: In-memory per-request timing state (no persistence required)
**Testing**: Vitest (existing)
**Target Platform**: Linux server (local Docker or bare-metal)
**Project Type**: Single monolithic API gateway
**Performance Goals**: <1ms overhead per request (FR-007)
**Constraints**: 10-color ANSI palette, JSON log format, external API endpoints only
**Scale/Scope**: Single-user local deployment; assume ≤10 concurrent requests

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Evidence |
|------|--------|----------|
| Code MUST follow linting/formatting standards | ✓ PASS | TypeScript strict mode, ESLint configured |
| Functions MUST have single responsibility | ✓ PASS | Tracer component handles timing only |
| All new features MUST include tests | ✓ PASS | Unit + integration tests planned |
| Tests MUST be independent, isolated, repeatable | ✓ PASS | Per-request timing state is isolated |
| All endpoints MUST respond within latency targets | ✓ PASS | <1ms overhead, total <50ms routing (p95) |
| Inputs MUST be validated | ✓ PASS | requestId from Fastify, no user input for timing |
| Changes MUST go through PR review | ✓ PASS | Feature branch workflow |

**Gate Status**: ✓ PASS — All ground-rules satisfied

## Project Structure

### Documentation (this feature)

```text
specs/012-request-latency-tracing/
├── spec.md              # Feature specification (complete)
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal JSON schema)
└── tasks.md             # Phase 2 output (/rainbow.taskify)
```

### Source Code (repository root)

```text
src/
├── middleware/
│   └── request-timer.ts       # NEW: Timing middleware + tracer
├── utils/
│   └── logger.ts              # MODIFIED: Add color prefix support
├── types/
│   └── request-trace.ts       # NEW: RequestTrace, StageTiming types
├── routes/
│   ├── openai/handlers.ts     # MODIFIED: Integrate timing
│   └── anthropic/handlers.ts  # MODIFIED: Integrate timing
└── services/
    └── request-router.ts      # MODIFIED: Stage timing hooks

tests/
├── unit/
│   └── middleware/
│       └── request-timer.test.ts    # NEW: Unit tests
└── integration/
    └── request-tracing.test.ts      # NEW: Integration tests
```

**Structure Decision**: Follow existing project structure. New `request-timer.ts` middleware component in `src/middleware/` with types in `src/types/`. Minimal modifications to existing handlers to inject timing hooks.

## Complexity Tracking

> No ground-rules violations. Simpler design chosen: single tracer module attached to request lifecycle via Fastify hooks rather than distributed timing across all components.

---

## Phase 0: Research Summary

See [research.md](./research.md) for detailed findings.

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Use Fastify `onRequest` + `onResponse` hooks | Minimal code change, captures full request lifecycle automatically |
| Store timing state in `request.timings` (decorated) | Per-request isolation, no global state management needed |
| Use `performance.now()` for precision | Sub-millisecond precision, Node.js built-in, low overhead |
| ANSI color via `\x1b[3Xm` escape sequences | Standard terminal support, no external color library needed |
| JSON log via existing logger | Consistent with current logging, no new output infrastructure |

### Architecture Alignment

- **ADR-001 (Monolithic Single-Process)**: ✓ Tracer runs in same process
- **ADR-003 (In-Memory State)**: ✓ Timing state is in-memory, per-request
- **Quality Target (<50ms routing)**: ✓ <1ms overhead preserves this target

---

## Phase 1: Design Details

See [data-model.md](./data-model.md) for entity definitions.

See [contracts/timing-schema.json](./contracts/timing-schema.json) for JSON schema.

### Component Design

#### RequestTimer Middleware

```typescript
// Pseudocode structure
interface RequestTimer {
  startStage(request: FastifyRequest, stage: string): void;
  endStage(request: FastifyRequest, stage: string): void;
  getTrace(request: FastifyRequest): RequestTrace;
  logSummary(request: FastifyRequest): void;
}
```

**Lifecycle Integration**:
1. `onRequest` hook: Initialize trace, assign color, record `requestReceived`
2. Handler execution: Manual stage markers via `startStage`/`endStage`
3. `onResponse` hook: Record `responseSent`, log JSON summary

#### Color Assignment

```typescript
// Modulo-based color assignment
const COLORS = [31, 32, 33, 34, 35, 36, 37, 90, 91, 92]; // ANSI codes
let requestCounter = 0;

function assignColor(): number {
  return COLORS[requestCounter++ % COLORS.length];
}
```

### Stage Definitions

| Stage | When Recorded | Handler |
|-------|---------------|---------|
| `requestReceived` | onRequest hook | Timer middleware |
| `validation` | Before Zod parse | Handler wrapper |
| `routing` | Before router.route() | Handler wrapper |
| `quotaCheck` | Before consumeQuota() | Handler wrapper |
| `apiKeyDecryption` | Before getDecryptedApiKey() | Handler wrapper |
| `upstreamRequest` | Before proxy.forward*() | Handler wrapper |
| `responseSent` | onResponse hook | Timer middleware |

### Error Handling

- Failed stages: Record partial timing, log with `incomplete: true` flag
- Missing stages: Include in output with `durationMs: null`
- Exceptions: Caught by error handler, timing still logged via `onResponse`

### Performance Considerations

- **Avoid sync Date calls**: Use `performance.now()` (async-safe, high precision)
- **Minimize object creation**: Reuse timing arrays, no per-stage allocation
- **No I/O in hot path**: All timing is CPU-only, no file/network access