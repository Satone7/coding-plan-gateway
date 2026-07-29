/**
 * Request latency tracing types.
 * Defines types for tracking timing through the request lifecycle.
 *
 * @module types/request-trace
 */

/**
 * Valid processing stage names.
 * Each stage represents a distinct phase in request processing.
 */
export type StageName =
  | 'requestReceived'
  | 'validation'
  | 'modelRouting'
  | 'routing'
  | 'quotaCheck'
  | 'apiKeyDecryption'
  | 'upstreamRequest'
  | 'responseSent';

/**
 * Timing record for a single processing stage.
 * Records start and end times with calculated duration.
 */
export interface StageTiming {
  /** Stage identifier */
  name: StageName;
  /** High-precision start timestamp (performance.now()) */
  startTime: number;
  /** High-precision end timestamp (performance.now()), null if not ended */
  endTime: number | null;
  /** Calculated duration in milliseconds, null if stage not completed */
  durationMs: number | null;
}

/**
 * Request trace state attached to FastifyRequest.
 * Tracks timing through all processing stages for a single request.
 */
export interface RequestTrace {
  /** Fastify's unique request identifier */
  requestId: string;
  /** ANSI color code index (0-9) for visual differentiation */
  colorIndex: number;
  /** High-precision start timestamp (performance.now()) */
  startTime: number;
  /** Ordered array of stage timing records */
  stages: StageTiming[];
  /** Total request duration in milliseconds, null until complete */
  totalDurationMs: number | null;
  /** True if request failed before completion */
  incomplete: boolean;
}

/**
 * Phase record for JSON output.
 * Simplified stage timing for log output.
 */
export interface PhaseRecord {
  /** Stage name */
  name: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * JSON output format for timing summary log.
 * Structured for machine parsing (jq, Loki, Elasticsearch).
 */
export interface TimingSummary {
  /** Request identifier for filtering logs */
  requestId: string;
  /** ANSI color code index (0-9) */
  colorIndex: number;
  /** Total request duration in milliseconds */
  totalDurationMs: number;
  /** Ordered array of stage timings */
  phases: PhaseRecord[];
  /** True if request failed before completion */
  incomplete: boolean;
}

/**
 * ANSI color codes for request differentiation.
 * Index 0-9 maps to these codes for terminal coloring.
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
 * Used for modulo-based color assignment.
 */
export const COLOR_PALETTE_SIZE = 10;