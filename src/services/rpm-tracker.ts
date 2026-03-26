/**
 * RpmTracker - Tracks requests per minute using a sliding window.
 * Uses time-bucketed approach for O(1) operations with fixed memory footprint.
 *
 * @see research.md R3 for sliding window implementation decision
 */

import type { RpmBucket, RpmTrackerConfig } from '@/types/rpm-tracker';
import { DEFAULT_RPM_TRACKER_CONFIG } from '@/types/rpm-tracker';
import { logger } from '@/utils/logger';

/**
 * RpmTracker - Tracks requests per minute per plan.
 *
 * Uses a sliding window of fixed buckets for efficient RPM calculation:
 * - 6 buckets of 10 seconds each = 60-second window
 * - O(1) update and query operations
 * - Fixed memory per plan (6 integers)
 *
 * @example
 * ```typescript
 * const tracker = new RpmTracker();
 * tracker.recordRequest('plan-1');
 * tracker.recordRequest('plan-1');
 * const rpm = tracker.getRpm('plan-1'); // Returns ~2 for current minute
 * ```
 */
export class RpmTracker {
  private readonly config: RpmTrackerConfig;
  private readonly buckets: Map<string, RpmBucket[]>;
  private readonly bucketTimestamps: Map<string, number[]>;

  constructor(config?: Partial<RpmTrackerConfig>) {
    this.config = { ...DEFAULT_RPM_TRACKER_CONFIG, ...config };
    this.buckets = new Map();
    this.bucketTimestamps = new Map();
  }

  /**
   * Get the current bucket timestamp (Unix timestamp / bucket duration).
   */
  private getCurrentBucketTimestamp(): number {
    return Math.floor(Date.now() / 1000 / this.config.bucketDurationSeconds);
  }

  /**
   * Initialize buckets for a plan if not exists.
   */
  private initializePlan(planId: string): void {
    if (!this.buckets.has(planId)) {
      // Initialize with empty buckets
      const emptyBuckets: RpmBucket[] = Array.from(
        { length: this.config.bucketCount },
        () => ({ timestamp: 0, count: 0 })
      );
      this.buckets.set(planId, emptyBuckets);

      // Initialize timestamp tracking
      const timestamps = Array.from({ length: this.config.bucketCount }, () => 0);
      this.bucketTimestamps.set(planId, timestamps);
    }
  }

  /**
   * Record a request for a plan.
   * Updates the current bucket count, advancing to a new bucket if needed.
   *
   * @param planId - The plan identifier
   */
  recordRequest(planId: string): void {
    this.initializePlan(planId);

    const currentTimestamp = this.getCurrentBucketTimestamp();
    const buckets = this.buckets.get(planId)!;
    const timestamps = this.bucketTimestamps.get(planId)!;

    // Find or create the current bucket
    let bucketIndex = timestamps.findIndex((ts) => ts === currentTimestamp);

    if (bucketIndex === -1) {
      // Need a new bucket - find the oldest one to replace
      const oldestIndex = this.findOldestBucketIndex(timestamps);
      bucketIndex = oldestIndex;

      // Reset the bucket
      buckets[bucketIndex] = { timestamp: currentTimestamp, count: 0 };
      timestamps[bucketIndex] = currentTimestamp;
    }

    // Increment the count
    buckets[bucketIndex].count++;

    logger.debug('RPM request recorded', {
      planId,
      bucketIndex,
      timestamp: currentTimestamp,
      count: buckets[bucketIndex].count,
    });
  }

  /**
   * Find the index of the oldest bucket.
   */
  private findOldestBucketIndex(timestamps: number[]): number {
    let oldestIndex = 0;
    let oldestTimestamp = timestamps[0];

    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < oldestTimestamp) {
        oldestTimestamp = timestamps[i];
        oldestIndex = i;
      }
    }

    return oldestIndex;
  }

  /**
   * Get the current RPM (requests per minute) for a plan.
   * Sums all non-expired buckets within the sliding window.
   *
   * @param planId - The plan identifier
   * @returns The current RPM (0 if no requests or plan not found)
   */
  getRpm(planId: string): number {
    const buckets = this.buckets.get(planId);
    if (!buckets) {
      return 0;
    }

    const currentTimestamp = this.getCurrentBucketTimestamp();
    const windowStart = currentTimestamp - this.config.bucketCount + 1;

    let totalCount = 0;

    for (const bucket of buckets) {
      // Only count buckets within the sliding window
      if (bucket.timestamp >= windowStart && bucket.timestamp <= currentTimestamp) {
        totalCount += bucket.count;
      }
    }

    return totalCount;
  }

  /**
   * Get the maximum observed RPM across all plans.
   * Useful for normalization in multi-factor scoring.
   *
   * @returns The maximum RPM, or 0 if no data
   */
  getMaxRpm(): number {
    let maxRpm = 0;

    for (const planId of this.buckets.keys()) {
      const rpm = this.getRpm(planId);
      maxRpm = Math.max(maxRpm, rpm);
    }

    return maxRpm;
  }

  /**
   * Reset tracking for a specific plan.
   *
   * @param planId - The plan identifier
   */
  resetPlan(planId: string): void {
    this.buckets.delete(planId);
    this.bucketTimestamps.delete(planId);
    logger.debug('RPM tracking reset for plan', { planId });
  }

  /**
   * Reset all tracking data.
   */
  resetAll(): void {
    this.buckets.clear();
    this.bucketTimestamps.clear();
    logger.info('RPM tracker reset');
  }

  /**
   * Get all plan IDs currently being tracked.
   */
  getTrackedPlans(): string[] {
    return Array.from(this.buckets.keys());
  }

  /**
   * Get debug information for a plan.
   */
  getDebugInfo(planId: string): { buckets: RpmBucket[]; rpm: number } | null {
    const buckets = this.buckets.get(planId);
    if (!buckets) {
      return null;
    }

    return {
      buckets: [...buckets],
      rpm: this.getRpm(planId),
    };
  }
}

/**
 * Create a new RpmTracker instance.
 *
 * @param config - Optional configuration
 * @returns A new RpmTracker instance
 */
export function createRpmTracker(config?: Partial<RpmTrackerConfig>): RpmTracker {
  return new RpmTracker(config);
}