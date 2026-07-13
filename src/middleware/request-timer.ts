/**
 * Request Timer Middleware - Tracks latency through request lifecycle.
 *
 * Implements per-request timing using Fastify hooks. Assigns ANSI colors
 * to concurrent requests for visual differentiation in terminal output.
 *
 * @module middleware/request-timer
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { performance } from 'perf_hooks';
import type {
  StageName,
  StageTiming,
  RequestTrace,
  TimingSummary,
} from '@/types/request-trace';
import {
  ANSI_COLOR_CODES,
  COLOR_PALETTE_SIZE,
} from '@/types/request-trace';
import { logger } from '@/utils/logger';

/**
 * Augment FastifyRequest with timing property.
 */
declare module 'fastify' {
  interface FastifyRequest {
    /** Request timing trace */
    timings?: RequestTrace;
  }
}

/**
 * Global request counter for color assignment.
 * Increments on each request, wraps at COLOR_PALETTE_SIZE.
 */
let requestCounter = 0;

/**
 * Assign a color index using modulo-based rotation.
 * Returns a value 0-9 that maps to ANSI_COLOR_CODES.
 *
 * @returns Color index (0-9)
 */
function assignColorIndex(): number {
  const index = requestCounter % COLOR_PALETTE_SIZE;
  requestCounter++;
  return index;
}

/**
 * Get the ANSI color escape sequence for a color index.
 *
 * @param colorIndex - Color index (0-9)
 * @returns ANSI escape sequence
 */
function getAnsiColor(colorIndex: number): string {
  const code = ANSI_COLOR_CODES[colorIndex % COLOR_PALETTE_SIZE];
  return `\x1b[${code}m`;
}

/**
 * Reset color to terminal default.
 */
const ANSI_RESET = '\x1b[0m';

/**
 * Create a new RequestTrace instance.
 *
 * @param requestId - Fastify's request ID
 * @returns New RequestTrace instance
 */
export function createRequestTrace(requestId: string): RequestTrace {
  return {
    requestId,
    colorIndex: assignColorIndex(),
    startTime: performance.now(),
    stages: [],
    totalDurationMs: null,
    incomplete: false,
  };
}

/**
 * RequestTimer class for tracking stage timings.
 * Attached to each request via Fastify hooks.
 */
export class RequestTimer {
  private trace: RequestTrace;
  private summaryLogged = false;

  /**
   * Create a new RequestTimer.
   *
   * @param requestId - Fastify's request ID
   */
  constructor(requestId: string) {
    this.trace = createRequestTrace(requestId);
  }

  /**
   * Start timing a processing stage.
   * If the stage already exists, updates its start time.
   *
   * @param stage - Stage name to start
   */
  startStage(stage: StageName): void {
    const existing = this.trace.stages.find((s) => s.name === stage);
    if (existing) {
      existing.startTime = performance.now();
      existing.endTime = null;
      existing.durationMs = null;
      return;
    }

    this.trace.stages.push({
      name: stage,
      startTime: performance.now(),
      endTime: null,
      durationMs: null,
    });
  }

  /**
   * End timing a processing stage.
   * Calculates and stores the duration.
   *
   * @param stage - Stage name to end
   */
  endStage(stage: StageName): void {
    const stageTiming = this.trace.stages.find((s) => s.name === stage);
    if (!stageTiming) {
      // Stage was not started - create it with minimal duration
      this.trace.stages.push({
        name: stage,
        startTime: performance.now(),
        endTime: performance.now(),
        durationMs: 0,
      });
      return;
    }

    stageTiming.endTime = performance.now();
    stageTiming.durationMs = stageTiming.endTime - stageTiming.startTime;
  }

  /**
   * Get the current trace state.
   *
   * @returns Current RequestTrace
   */
  getTrace(): RequestTrace {
    return this.trace;
  }

  /**
   * Mark the request as incomplete (failed).
   */
  markIncomplete(): void {
    this.trace.incomplete = true;
  }

  /**
   * Calculate and set total duration.
   */
  finalize(): void {
    this.trace.totalDurationMs = performance.now() - this.trace.startTime;
  }

  /**
   * Generate a TimingSummary for logging.
   *
   * @returns TimingSummary object
   */
  toSummary(): TimingSummary {
    const phases = this.trace.stages
      .filter((s) => s.durationMs !== null)
      .map((s) => ({
        name: s.name,
        durationMs: s.durationMs as number,
      }));

    return {
      requestId: this.trace.requestId,
      colorIndex: this.trace.colorIndex,
      totalDurationMs: this.trace.totalDurationMs ?? 0,
      phases,
      incomplete: this.trace.incomplete,
    };
  }

  /**
   * Log the timing summary as JSON.
   * Uses ANSI color prefix for terminal differentiation.
   *
   * Idempotent: hijacked streaming responders call this manually after the
   * stream ends, and the onResponse hook calls it again on normal completion.
   * Only the first call emits output.
   */
  logSummary(): void {
    if (this.summaryLogged) {
      return;
    }
    this.summaryLogged = true;
    this.finalize();
    const summary = this.toSummary();
    const colorPrefix = getAnsiColor(summary.colorIndex);

    // Output as single-line JSON with color prefix
    const jsonOutput = JSON.stringify(summary);
    const coloredOutput = `${colorPrefix}[${summary.requestId}]${ANSI_RESET} ${jsonOutput}`;

    // Log directly to stdout for single-line JSON output
    process.stdout.write(coloredOutput + '\n');
  }
}

/**
 * Request timer attached to each request.
 * Uses WeakMap to avoid polluting request object.
 */
const requestTimers = new WeakMap<FastifyRequest, RequestTimer>();

/**
 * Get or create a timer for a request.
 *
 * @param request - Fastify request
 * @returns RequestTimer instance
 */
export function getRequestTimer(request: FastifyRequest): RequestTimer {
  let timer = requestTimers.get(request);
  if (!timer) {
    timer = new RequestTimer(request.id);
    requestTimers.set(request, timer);
    // Also attach to request for direct access
    request.timings = timer.getTrace();
  }
  return timer;
}

/**
 * Start a stage timer for a request.
 * Convenience function for use in handlers.
 *
 * @param request - Fastify request
 * @param stage - Stage name to start
 */
export function startStage(request: FastifyRequest, stage: StageName): void {
  const timer = getRequestTimer(request);
  timer.startStage(stage);
  // Update the trace on the request object
  request.timings = timer.getTrace();
}

/**
 * End a stage timer for a request.
 * Convenience function for use in handlers.
 *
 * @param request - Fastify request
 * @param stage - Stage name to end
 */
export function endStage(request: FastifyRequest, stage: StageName): void {
  const timer = getRequestTimer(request);
  timer.endStage(stage);
  // Update the trace on the request object
  request.timings = timer.getTrace();
}

/**
 * Paths to exclude from timing.
 * Health checks and internal endpoints should not be timed.
 */
const EXCLUDED_PATHS = [
  '/health',
  '/ready',
  '/internal/',
];

/**
 * Check if a path should be excluded from timing.
 *
 * @param path - Request path
 * @returns True if path should be excluded
 */
function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATHS.some((excluded) => path.startsWith(excluded));
}

/**
 * Register the request timer middleware with Fastify.
 * Attaches onRequest and onResponse hooks for timing.
 *
 * @param app - Fastify instance
 */
export function registerRequestTimer(app: FastifyInstance): void {
  // Initialize timing on request start
  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Skip timing for excluded paths
    if (isExcludedPath(request.url)) {
      return;
    }

    const timer = getRequestTimer(request);
    // requestReceived is a point-in-time marker, so end it immediately
    timer.startStage('requestReceived');
    timer.endStage('requestReceived');
    request.timings = timer.getTrace();
  });

  // Finalize timing on response
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip timing for excluded paths
    if (isExcludedPath(request.url)) {
      return;
    }

    const timer = getRequestTimer(request);
    // responseSent is a point-in-time marker, so start and end it immediately
    timer.startStage('responseSent');
    timer.endStage('responseSent');

    // Mark as incomplete if response is an error
    if (reply.statusCode >= 400) {
      timer.markIncomplete();
    }

    timer.logSummary();
  });

  logger.info('Request timer middleware registered');
}