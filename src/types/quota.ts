/**
 * Quota-related types for tracking usage across coding plans.
 * @see data-model.md for entity definitions
 */

import type { QuotaPeriod } from './coding-plan';

/**
 * QuotaState - Tracks real-time quota usage for a coding plan.
 *
 * This interface represents the runtime state of quota tracking,
 * separate from the configuration to allow for dynamic updates.
 *
 * @example
 * ```typescript
 * const quotaState: QuotaState = {
 *   planId: 1,
 *   used: 450,
 *   limit: 1000,
 *   period: 'monthly',
 *   lastUpdated: new Date(),
 *   resetAt: new Date('2026-04-01T00:00:00Z'),
 * };
 * ```
 */
export interface QuotaState {
  /** Reference to the coding plan (integer ID) */
  planId: number;

  /** Current usage count */
  used: number;

  /** Maximum allowed (copied from config) */
  limit: number;

  /** Quota period type */
  period: QuotaPeriod;

  /** Last usage update timestamp */
  lastUpdated: Date;

  /** When quota will reset (for daily/monthly) */
  resetAt: Date | null;
}

/**
 * QuotaUpdate - Represents a delta change to quota usage.
 */
export interface QuotaUpdate {
  /** Reference to the coding plan (integer ID) */
  planId: number;

  /** Usage delta (positive = consume, negative = refund) */
  delta: number;

  /** Timestamp of the update */
  timestamp: Date;
}

/**
 * QuotaStatusResponse - API response for quota status.
 */
export interface QuotaStatusResponse {
  /** Plan identifier (integer ID) */
  planId: number;

  /** Current usage count */
  used: number;

  /** Maximum allowed */
  limit: number;

  /** Remaining quota */
  remaining: number;

  /** Quota period */
  period: QuotaPeriod;

  /** When quota will reset */
  resetAt: Date | null;

  /** Last update timestamp */
  lastUpdated: Date;
}

/**
 * Calculate remaining quota.
 */
export function calculateRemaining(state: QuotaState): number {
  return Math.max(0, state.limit - state.used);
}

/**
 * Check if quota is exhausted.
 */
export function isQuotaExhausted(state: QuotaState): boolean {
  return state.used >= state.limit;
}

/**
 * Create initial quota state for a plan.
 */
export function createInitialQuotaState(
  planId: number,
  limit: number,
  period: QuotaPeriod
): QuotaState {
  const now = new Date();
  return {
    planId,
    used: 0,
    limit,
    period,
    lastUpdated: now,
    resetAt: calculateResetAt(period),
  };
}

/**
 * Calculate the next reset date based on quota period.
 */
export function calculateResetAt(period: QuotaPeriod): Date | null {
  if (period === 'total') {
    return null;
  }

  const now = new Date();

  if (period === 'daily') {
    // Reset at next UTC midnight
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  }

  if (period === 'monthly') {
    // Reset on the 1st of next month at UTC midnight
    const nextMonth = new Date(now);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    nextMonth.setUTCDate(1);
    nextMonth.setUTCHours(0, 0, 0, 0);
    return nextMonth;
  }

  return null;
}