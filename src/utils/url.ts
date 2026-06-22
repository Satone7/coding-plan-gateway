/**
 * URL utilities shared across services.
 */

const VERSIONED_SUFFIX_PATTERN = /(?:\/v\d+(?:\.\d+)?)$|(?:\/paas\/v\d+(?:\.\d+)?)$/;

/**
 * Returns true if the URL path ends with a versioned suffix like `/v1`, `/v3.1`, or `/paas/v4`.
 *
 * Used to decide whether to append a bare path (`/models`) or a versioned path (`/v1/models`)
 * when constructing OpenAI-compatible endpoints from a base URL.
 */
export function hasVersionedSuffix(url: string): boolean {
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
  return VERSIONED_SUFFIX_PATTERN.test(trimmed);
}

/**
 * Build the OpenAI-compatible `/models` endpoint from a base URL.
 *
 * - `http://host:1234`    → `http://host:1234/v1/models`
 * - `http://host:1234/v1` → `http://host:1234/v1/models`
 *
 * Mirrors the suffix logic in `RequestProxy.buildOpenAIEndpoint` so both the request
 * forwarder and the model-list fetcher agree on endpoint construction.
 */
export function buildModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return hasVersionedSuffix(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
}
