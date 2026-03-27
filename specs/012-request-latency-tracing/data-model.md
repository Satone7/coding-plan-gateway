# Data Model: Request Latency Tracing

**Feature**: 012-request-latency-tracing
**Date**: 2026-03-27

## Entities

### RequestTrace

Represents timing data for a single HTTP request through all processing stages.

| Field | Type | Description |
|-------|------|-------------|
| requestId | string | Fastify's unique request identifier |
| colorIndex | number | ANSI color code index (0-9) |
| startTime | number | High-precision start timestamp (performance.now()) |
| stages | StageTiming[] | Ordered array of stage timing records |
| totalDurationMs | number \| null | Total request duration (null until complete) |
| incomplete | boolean | True if request failed before completion |

**Relationships**:
- Has many StageTiming (1:N)
- Belongs to one FastifyRequest (transient, per-request lifecycle)

**State Transitions**:
```
initialized → in_progress → completed
                  ↓
               failed (incomplete=true)
```

---

### StageTiming

Represents timing for a single processing stage.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Stage identifier (e.g., "validation", "routing") |
| startTime | number | Stage start timestamp (performance.now()) |
| endTime | number \| null | Stage end timestamp (null if not ended) |
| durationMs | number \| null | Calculated duration in milliseconds |

**Valid Stage Names** (from FR-001):
| Stage Name | Description |
|------------|-------------|
| requestReceived | Request entered Gateway |
| validation | Zod schema validation |
| routing | Plan selection via RequestRouter |
| quotaCheck | Quota availability check |
| apiKeyDecryption | AES-256-GCM decryption |
| upstreamRequest | HTTP request to provider |
| responseSent | Response returned to client |

**Validation Rules**:
- `name` must be one of the valid stage names
- `endTime` must be >= `startTime` when set
- `durationMs` = `(endTime - startTime)` when both set

---

### TimingSummary (JSON Output)

The structured JSON log output format.

| Field | Type | Description |
|-------|------|-------------|
| requestId | string | Request identifier |
| colorIndex | number | ANSI color code index (0-9) |
| totalDurationMs | number | Total request duration in milliseconds |
| phases | PhaseRecord[] | Array of stage timings |
| incomplete | boolean | True if request failed before completion |

**PhaseRecord**:
| Field | Type | Description |
|-------|------|-------------|
| name | string | Stage name |
| durationMs | number | Duration in milliseconds |

---

## Type Definitions (TypeScript)

```typescript
/**
 * Valid processing stage names.
 */
export type StageName =
  | 'requestReceived'
  | 'validation'
  | 'routing'
  | 'quotaCheck'
  | 'apiKeyDecryption'
  | 'upstreamRequest'
  | 'responseSent';

/**
 * Timing record for a single stage.
 */
export interface StageTiming {
  name: StageName;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
}

/**
 * Request trace state attached to FastifyRequest.
 */
export interface RequestTrace {
  requestId: string;
  colorIndex: number;
  startTime: number;
  stages: StageTiming[];
  totalDurationMs: number | null;
  incomplete: boolean;
}

/**
 * JSON output format for timing summary log.
 */
export interface TimingSummary {
  requestId: string;
  colorIndex: number;
  totalDurationMs: number;
  phases: Array<{ name: string; durationMs: number }>;
  incomplete: boolean;
}
```

---

## ANSI Color Palette

```typescript
/**
 * ANSI color codes for request differentiation.
 * Index 0-9 maps to these codes.
 */
export const ANSI_COLOR_CODES: readonly number[] = [
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
] as const;

/**
 * Total number of colors in the palette.
 */
export const COLOR_PALETTE_SIZE = 10;
```

---

## Storage Notes

- **In-memory only**: RequestTrace lives only for the duration of a request
- **No persistence**: Timing data is not stored beyond the log output
- **Per-request isolation**: Each request has its own RequestTrace instance
- **Thread safety**: Single-threaded Node.js event loop ensures no race conditions