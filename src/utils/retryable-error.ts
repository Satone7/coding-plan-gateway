/**
 * Shared classification of upstream errors for failover decisions.
 *
 * Used by both the Anthropic and OpenAI streaming/non-streaming handlers to
 * decide whether a failed primary attempt should be retried on an alternative
 * plan. Failover only ever proceeds when nothing has been sent to the client
 * yet (the caller checks `!reply.raw.headersSent`), so classifying an error as
 * retryable is always safe.
 */

/**
 * HTTP status codes worth retrying on another plan.
 *
 * - 400 Bad Request: the upstream may reject for plan-specific reasons (e.g.
 *   a context-window limit) that another plan can satisfy.
 * - 408 Request Timeout, 500/502/503/504 server errors, 529 overloaded:
 *   transient upstream/gateway failures; another plan may be healthy.
 * - 429 Too Many Requests: rate/quota limit on this plan.
 */
const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  400, 408, 429, 500, 502, 503, 504, 529,
]);

/**
 * Whether an upstream error is worth retrying on an alternative plan.
 *
 * Transport-level failures — socket hang up, timeout, connection reset,
 * DNS/connect failures — surface as errors with NO `statusCode`. These are
 * always retryable: they are transient and typically plan/upstream-specific
 * (the prod incident: a Kimi plan socket-hang-up'd while an equally-capable
 * failover plan sat idle at used=0).
 *
 * Deterministic client errors (401, 403, 404, 405, 422, ...) carry a
 * `statusCode` and are NOT retryable — they indicate a misconfiguration that
 * affects all plans equally (bad API key, missing endpoint, malformed body).
 */
export function isRetryableUpstreamError(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number }).statusCode;
  if (statusCode === undefined) {
    // No status code => transport/network error (socket hang up, timeout, ...).
    return true;
  }
  return RETRYABLE_STATUS_CODES.has(statusCode);
}
