/**
 * Cached Usage Adapter.
 * Wraps a UsageAdapter with in-memory TTL caching.
 * On inner adapter failure, returns stale cache if available.
 */

import type { UsageAdapter, UsageResult } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Cache entry with expiration.
 */
interface CacheEntry {
  result: UsageResult;
  expiresAt: number; // Date.now() timestamp
}

/**
 * Wraps a UsageAdapter with in-memory TTL caching.
 * Keyed by provider ID (all plans for the same provider share a cache entry).
 * On inner adapter failure, returns stale cache if available.
 */
export class CachedUsageAdapter implements UsageAdapter {
  private cache = new Map<string, CacheEntry>();
  private readonly inner: UsageAdapter;
  private readonly ttlMs: number;

  constructor(inner: UsageAdapter, ttlSeconds: number) {
    this.inner = inner;
    this.ttlMs = ttlSeconds * 1000;
  }

  get providerId(): string {
    return this.inner.providerId;
  }

  get cacheTTL(): number {
    return this.ttlMs / 1000;
  }

  async queryUsage(apiKey: string): Promise<UsageResult> {
    const cacheKey = this.inner.providerId;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // Return fresh cache if available
    if (cached && now < cached.expiresAt) {
      logger.debug('Usage adapter cache hit', {
        providerId: this.inner.providerId,
        percentage: cached.result.percentage,
      });
      return cached.result;
    }

    // Cache miss or expired — query inner adapter
    try {
      const result = await this.inner.queryUsage(apiKey);
      this.cache.set(cacheKey, {
        result,
        expiresAt: now + this.ttlMs,
      });
      return result;
    } catch (error) {
      // On failure, return stale cache if available (prefer over-blocking)
      if (cached) {
        logger.warn('Usage adapter query failed, returning stale cache', {
          providerId: this.inner.providerId,
          error: error instanceof Error ? error.message : String(error),
          stalePercentage: cached.result.percentage,
        });
        return cached.result;
      }

      // No cache at all — re-throw
      throw error;
    }
  }
}
