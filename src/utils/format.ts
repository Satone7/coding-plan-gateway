/**
 * Shared formatting utilities.
 */

import type { QuotaPeriod } from '@/types/coding-plan';

/**
 * Get the English ordinal suffix for a number (1st, 2nd, 3rd, 4th, ...).
 */
function getOrdinalSuffix(n: number): string {
  const lastTwoDigits = n % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th';
  }
  const lastDigit = n % 10;
  switch (lastDigit) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Format a QuotaPeriod into a human-readable string for CLI display.
 *
 * @param period - The structured quota period or legacy string
 * @returns Human-readable period string (e.g., '5h (sliding)', 'weekly (Mon)', 'monthly (15th)', 'total')
 */
export function formatQuotaPeriod(period: QuotaPeriod | 'daily' | 'monthly' | 'total'): string {
  // Handle legacy string values for backward compat
  if (typeof period === 'string') {
    return period;
  }

  switch (period.type) {
    case '5h':
      return '5h (sliding)';
    case 'weekly': {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return `weekly (${days[period.weekday - 1]})`;
    }
    case 'monthly': {
      const day = period.expiresOn ?? 1;
      return `monthly (${day}${getOrdinalSuffix(day)})`;
    }
    case 'total':
      return 'total';
  }
}
