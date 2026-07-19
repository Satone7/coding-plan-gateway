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
 *
 * @param period - The quota period (discriminated union)
 * @param currentResetAt - For sliding window periods (5h), the current resetAt value.
 *   When provided, the next reset is calculated from this timestamp instead of now.
 * @returns The next reset Date, or null for 'total' period (never resets)
 */
export function calculateResetAt(period: QuotaPeriod, currentResetAt?: Date | null): Date | null {
  if (period.type === 'total') {
    return null;
  }

  const now = new Date();

  if (period.type === '5h') {
    // Sliding window: on initial creation, resetAt = now + 5h.
    // On subsequent resets, resetAt = currentResetAt + 5h (slides predictably).
    const base = currentResetAt ?? now;
    const next = new Date(base.getTime() + period.windowHours * 60 * 60 * 1000);
    return next;
  }

  if (period.type === 'weekly') {
    // ISO weekday: 1=Monday, 7=Sunday. JS getUTCDay(): 0=Sunday, 6=Saturday.
    // Convert ISO weekday to JS day: jsDay = isoWeekday % 7
    const targetJsDay = period.weekday % 7; // 1->1(Mon), ..., 6->6(Sat), 7->0(Sun)
    const currentJsDay = now.getUTCDay();
    let daysUntilTarget = targetJsDay - currentJsDay;
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7;
    }
    const nextReset = new Date(now);
    nextReset.setUTCDate(nextReset.getUTCDate() + daysUntilTarget);
    nextReset.setUTCHours(0, 0, 0, 0);
    return nextReset;
  }

  if (period.type === 'monthly') {
    // If expiresOn is configured, reset on that day of month.
    // Otherwise, reset on the 1st of next month.
    const targetDay = period.expiresOn ?? 1;

    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const currentDay = now.getUTCDate();

    // Get days in current month
    const daysInCurrentMonth = getDaysInMonth(currentYear, currentMonth);
    const clampedDay = Math.min(targetDay, daysInCurrentMonth);

    if (currentDay < clampedDay) {
      // Target day is still ahead this month
      return new Date(Date.UTC(currentYear, currentMonth, clampedDay, 0, 0, 0, 0));
    }

    // Target day has passed, use next month
    let nextMonth = currentMonth + 1;
    let nextYear = currentYear;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear++;
    }
    const daysInNextMonth = getDaysInMonth(nextYear, nextMonth);
    const nextClampedDay = Math.min(targetDay, daysInNextMonth);

    return new Date(Date.UTC(nextYear, nextMonth, nextClampedDay, 0, 0, 0, 0));
  }

  return null;
}

/**
 * Advance a reset time into the future after the current period has elapsed.
 *
 * For sliding windows ('5h') this steps forward in WHOLE windows from the
 * previous resetAt until it is strictly past `now`, so a downtime longer than
 * one window catches up in a single reset instead of advancing one window per
 * tick (which left resetAt permanently in the past and wiped usage repeatedly).
 *
 * For weekly/monthly periods the next occurrence is recomputed from `now`.
 */
export function advanceResetAtForElapsed(
  period: QuotaPeriod,
  currentResetAt: Date,
  now: Date
): Date | null {
  if (period.type === 'total') {
    return null;
  }
  if (period.type === '5h') {
    const windowMs = period.windowHours * 60 * 60 * 1000;
    const elapsed = Math.max(0, now.getTime() - currentResetAt.getTime());
    // At least one step, and enough whole steps to land strictly after now.
    const steps = Math.max(1, Math.floor(elapsed / windowMs) + 1);
    return new Date(currentResetAt.getTime() + steps * windowMs);
  }
  return calculateResetAt(period);
}

/**
 * Get the number of days in a given month (UTC-safe).
 *
 * @param year - Full year
 * @param month - Month (0-11, where 0 = January)
 * @returns Number of days in the month
 */
function getDaysInMonth(year: number, month: number): number {
  // Day 0 of next month gives last day of current month
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
