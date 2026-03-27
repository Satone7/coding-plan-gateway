# Research: Request Latency Tracing

**Feature**: 012-request-latency-tracing
**Date**: 2026-03-27
**Status**: Complete

## Research Questions

### R1: How to implement per-request timing in Fastify?

**Decision**: Use Fastify's hook system with `onRequest` and `onResponse` hooks.

**Rationale**:
- Fastify hooks run in the request lifecycle automatically
- `onRequest` fires before any handler, perfect for initialization
- `onResponse` fires after response is sent, captures final state
- Hooks can decorate the request object with custom properties

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| Wrap every handler | Too much boilerplate, error-prone |
| Use async_hooks | Overkill for single-process, adds complexity |
| Middleware-only approach | Cannot capture internal stage transitions |

**Implementation Pattern**:
```typescript
app.addHook('onRequest', async (request, reply) => {
  request.timings = createRequestTrace(request.id, assignColor());
  request.timings.startStage('requestReceived');
});

app.addHook('onResponse', async (request, reply) => {
  request.timings.endStage('responseSent');
  request.timings.logSummary();
});
```

---

### R2: What precision is needed for timing measurements?

**Decision**: Use `performance.now()` for sub-millisecond precision.

**Rationale**:
- `Date.now()` has ~1ms precision, insufficient for stages that may take <1ms
- `performance.now()` provides microsecond precision (µs)
- Node.js built-in, no external dependency
- Lower overhead than `process.hrtime.bigint()`

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| `Date.now()` | Only ms precision, may miss fast stages |
| `process.hrtime.bigint()` | More verbose, nanosecond precision unnecessary |
| `console.time()` | Not programmatic, cannot extract values |

**Implementation**:
```typescript
import { performance } from 'perf_hooks';

const start = performance.now();
// ... stage execution ...
const duration = performance.now() - start;
```

---

### R3: How to handle ANSI color codes in logging?

**Decision**: Use raw ANSI escape sequences without external color library.

**Rationale**:
- Only need 10 fixed colors, no complex color manipulation
- ANSI codes are simple strings: `\x1b[31m` (red), `\x1b[32m` (green), etc.
- No new dependency required
- Works in all standard terminals

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| chalk library | Adds dependency for simple use case |
| colors/safe | Same as chalk |
| Custom color function | ANSI sequences are already simple |

**Color Palette** (10 distinct, high-contrast):
```typescript
const ANSI_COLORS = [
  31, // Red
  32, // Green
  33, // Yellow
  34, // Blue
  35, // Magenta
  36, // Cyan
  37, // White
  90, // Bright Black (Gray)
  91, // Bright Red
  92, // Bright Green
];
```

---

### R4: How to structure the JSON timing log output?

**Decision**: Single-line JSON with structured schema.

**Rationale**:
- JSON is machine-parseable (jq, Loki, Elasticsearch)
- Single line preserves log ordering
- Structured schema enables filtering and aggregation

**Schema Design**:
```json
{
  "requestId": "abc123",
  "colorIndex": 3,
  "totalDurationMs": 125.45,
  "phases": [
    {"name": "requestReceived", "durationMs": 0.01},
    {"name": "validation", "durationMs": 2.34},
    {"name": "routing", "durationMs": 1.23},
    {"name": "quotaCheck", "durationMs": 0.45},
    {"name": "apiKeyDecryption", "durationMs": 15.67},
    {"name": "upstreamRequest", "durationMs": 100.12},
    {"name": "responseSent", "durationMs": 0.03}
  ],
  "incomplete": false
}
```

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| Multi-line JSON | Breaks log line ordering |
| Free-text format | Not machine-parseable |
| CSV format | Nested arrays awkward |

---

### R5: How to handle streaming request timing?

**Decision**: Record stages up to upstream request, log total on stream completion.

**Rationale**:
- Streaming requests are long-lived; don't wait for completion to log stages
- Log stage timings when upstream request starts
- Log total duration when stream ends (via callback)

**Implementation**:
```typescript
// For streaming requests
request.timings.logStageSummary(); // Log stages before stream starts
// ... streaming happens ...
// onComplete callback logs final total
```

---

### R6: Architecture alignment with existing patterns

**Decision**: Follow existing middleware pattern and logging conventions.

**Alignment with ADRs**:
| ADR | Alignment |
|-----|-----------|
| ADR-001 (Monolithic) | Tracer runs in main process |
| ADR-003 (In-memory) | Per-request timing in memory |
| ADR-005 (Quota-based LB) | No impact on routing logic |

**Alignment with Existing Code**:
- Use existing `logger.ts` for output
- Follow naming conventions: `request-timer.ts`, `RequestTrace`
- Use TypeScript strict mode with explicit types
- Unit tests in `tests/unit/middleware/`