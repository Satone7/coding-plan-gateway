/**
 * Expiration calculation utilities for plan selection.
 * @see research.md R4 for tiered scoring decision
 */

import type { CodingPlan } from '@/types/coding-plan';

/**
 * Calculate effective expiration date from a coding plan.
 * Handles both expiresAt (ISO 8601) and expiresOn (day of month) fields.
 *
 * @param plan - The coding plan to calculate expiration for
 * @returns The expiration Date, or null if no expiration configured
 *
 * @example
 * ```typescript
 * // From ISO 8601 string
 * const plan1 = { expiresAt: '2024-12-31T23:59:59Z', ... };
 * const exp1 = calculateEffectiveExpiration(plan1); // Date object
 *
 * // From day of month
 * const plan2 = { expiresOn: 28, ... };
 * const exp2 = calculateEffectiveExpiration(plan2); // Next 28th of month
 *
 * // No expiration
 * const plan3 = { ... };
 * const exp3 = calculateEffectiveExpiration(plan3); // null
 * ```
 */
export function calculateEffectiveExpiration(plan: CodingPlan): Date | null {
  // expiresAt takes precedence (per spec clarification)
  if (plan.expiresAt) {
    const date = new Date(plan.expiresAt);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // expiresOn is day of month (1-31)
  if (plan.expiresOn !== undefined && plan.expiresOn >= 1 && plan.expiresOn <= 31) {
    return calculateNextExpirationDate(plan.expiresOn);
  }

  return null;
}

/**
 * Calculate the next occurrence of a specific day of month.
 * Handles month boundaries (e.g., if day is 31 and current month has 30 days,
 * uses last day of month).
 *
 * @param dayOfMonth - Day of month (1-31)
 * @returns The next occurrence of that day
 */
function calculateNextExpirationDate(dayOfMonth: number): Date {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  // Get days in current month
  const daysInCurrentMonth = getDaysInMonth(currentYear, currentMonth);
  const targetDay = Math.min(dayOfMonth, daysInCurrentMonth);

  // If we haven't passed this month's target day, use this month
  if (currentDay < targetDay) {
    return new Date(currentYear, currentMonth, targetDay, 23, 59, 59, 999);
  }

  // Otherwise, use next month
  let nextMonth = currentMonth + 1;
  let nextYear = currentYear;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear++;
  }

  const daysInNextMonth = getDaysInMonth(nextYear, nextMonth);
  const nextTargetDay = Math.min(dayOfMonth, daysInNextMonth);

  return new Date(nextYear, nextMonth, nextTargetDay, 23, 59, 59, 999);
}

/**
 * Get the number of days in a given month.
 *
 * @param year - Full year
 * @param month - Month (0-11, where 0 = January)
 * @returns Number of days in the month
 */
function getDaysInMonth(year: number, month: number): number {
  // Day 0 of next month gives last day of current month
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calculate expiration score based on time remaining.
 * Uses tiered scoring per research.md R4.
 *
 * Score table:
 * - Expired: 0
 * - < 1 hour: 100 (highest priority)
 * - 1-24 hours: 90
 * - 1-7 days: 60
 * - 7-30 days: 30
 * - > 30 days: 20
 * - No expiration: 10 (lowest priority)
 *
 * @param expiresAt - The expiration date, or null if no expiration
 * @returns Score from 0-100
 */
export function calculateExpirationScore(expiresAt: Date | null): number {
  if (!expiresAt) {
    return 10; // No expiration = lowest priority
  }

  const now = Date.now();
  const expirationTime = expiresAt.getTime();

  // Already expired
  if (expirationTime <= now) {
    return 0;
  }

  const hoursRemaining = (expirationTime - now) / (1000 * 60 * 60);

  if (hoursRemaining < 1) {
    return 100; // < 1 hour - highest priority
  }
  if (hoursRemaining < 24) {
    return 90; // 1-24 hours
  }
  if (hoursRemaining < 168) { // 7 days
    return 60;
  }
  if (hoursRemaining < 720) { // 30 days
    return 30;
  }

  return 20; // > 30 days
}

/**
 * Calculate RPM score (inverse: lower RPM = higher score).
 * Uses a simple linear scale based on observed max RPM.
 *
 * @param currentRpm - Current requests per minute for the plan
 * @param maxObservedRpm - Maximum observed RPM across all plans (for normalization)
 * @returns Score from 0-100
 */
export function calculateRpmScore(currentRpm: number, maxObservedRpm: number): number {
  if (maxObservedRpm <= 0) {
    return 100; // No traffic = highest score
  }

  // Inverse linear scoring: lower RPM = higher score
  // 0 RPM = 100 score, maxRpm = 0 score
  const normalizedRpm = Math.min(currentRpm, maxObservedRpm) / maxObservedRpm;
  return Math.round((1 - normalizedRpm) * 100);
}

/**
 * Calculate quota score based on remaining capacity.
 *
 * @param used - Current usage
 * @param limit - Maximum allowed usage
 * @returns Score from 0-100
 */
export function calculateQuotaScore(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  const remaining = Math.max(0, limit - used);
  return Math.round((remaining / limit) * 100);
}