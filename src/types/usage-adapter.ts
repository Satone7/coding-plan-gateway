/**
 * Usage adapter types.
 * Defines the interface for querying provider-specific usage APIs.
 */

/**
 * A single usage window from a provider's quota API.
 * Providers may track usage across multiple time windows (e.g., 5h, weekly).
 */
export interface UsageWindow {
  /** Limit type, e.g., 'TOKENS_LIMIT', 'TIME_LIMIT' */
  type: string;
  /** Usage percentage (0-100) */
  percentage: number;
  /** Human-readable window label, e.g., '5h', '1w', '1mo' */
  windowLabel: string;
  /** Next reset time as milliseconds timestamp, if available */
  nextResetTime?: number;
}

/**
 * Result from a usage API query.
 */
export interface UsageResult {
  /** Used quota amount */
  used: number;
  /** Total quota limit */
  limit: number;
  /** Usage percentage (0-100) */
  percentage: number;
  /** Period end time (ISO datetime string), if applicable */
  expiresAt?: string;
  /** Per-window usage details, if provider tracks multiple windows */
  windows?: UsageWindow[];
  /** Raw API response for debugging */
  raw?: unknown;
}

/**
 * Adapter interface for querying provider usage APIs.
 * Each provider with a usage API implements this interface.
 */
export interface UsageAdapter {
  /** Provider ID this adapter handles */
  readonly providerId: string;
  /** Cache TTL in seconds */
  readonly cacheTTL: number;

  /**
   * Query current usage from the provider's API.
   *
   * @param apiKey - Decrypted API key for authentication
   * @returns Current usage information
   */
  queryUsage(apiKey: string): Promise<UsageResult>;
}
