/**
 * Usage adapter types.
 * Defines the interface for querying provider-specific usage APIs.
 */

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
