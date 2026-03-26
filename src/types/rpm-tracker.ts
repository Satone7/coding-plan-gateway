/**
 * RPM (Requests Per Minute) tracker types.
 * @see research.md R3 for sliding window implementation decision
 * @see data-model.md for entity definitions
 */

/**
 * Single time bucket for RPM tracking.
 * Uses 10-second granularity for sliding window calculation.
 */
export interface RpmBucket {
  /** Unix timestamp divided by 10 (10-second granularity) */
  timestamp: number;
  /** Request count in this bucket */
  count: number;
}

/**
 * RPM tracker state for a single plan.
 * Uses 6 buckets of 10 seconds each for a 60-second sliding window.
 */
export interface RpmTrackerState {
  /** Plan identifier */
  planId: string;
  /** Fixed array of 6 buckets for sliding window */
  buckets: [RpmBucket, RpmBucket, RpmBucket, RpmBucket, RpmBucket, RpmBucket];
  /** Current bucket index (0-5) */
  currentBucketIndex: number;
}

/**
 * Configuration for RPM tracker.
 */
export interface RpmTrackerConfig {
  /** Number of buckets in the sliding window (default: 6) */
  bucketCount: number;
  /** Duration of each bucket in seconds (default: 10) */
  bucketDurationSeconds: number;
}

/**
 * Default RPM tracker configuration.
 * 6 buckets × 10 seconds = 60-second sliding window.
 */
export const DEFAULT_RPM_TRACKER_CONFIG: RpmTrackerConfig = {
  bucketCount: 6,
  bucketDurationSeconds: 10,
};