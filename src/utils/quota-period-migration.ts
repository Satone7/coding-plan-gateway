/**
 * Quota period migration utilities.
 * Handles conversion from legacy string-based periods to structured discriminated union.
 *
 * @module utils/quota-period-migration
 */

import type { QuotaPeriod, LegacyQuotaPeriod } from '@/types/coding-plan';
import { logger } from '@/utils/logger';

/**
 * Migrate a legacy string-based quota period to the new structured format.
 *
 * @param period - Legacy period string ('daily', 'monthly', 'total')
 * @param expiresOn - Optional day of month from legacy config
 * @returns Structured QuotaPeriod object
 * @throws Error if period is not a recognized legacy value
 */
export function migrateQuotaPeriod(
  period: LegacyQuotaPeriod,
  expiresOn?: number
): QuotaPeriod {
  switch (period) {
    case 'daily':
      return { type: '5h', windowHours: 5, sliding: true };

    case 'monthly':
      return { type: 'monthly', expiresOn: expiresOn ?? 1 };

    case 'total':
      return { type: 'total' };

    default:
      throw new Error(`Unknown legacy quota period: ${String(period)}`);
  }
}

/**
 * Check if a period value is in legacy string format.
 */
export function isLegacyPeriod(period: unknown): period is LegacyQuotaPeriod {
  return typeof period === 'string' && ['daily', 'monthly', 'total'].includes(period);
}

/**
 * Migrate a quota config's period from legacy to structured format if needed.
 * Returns the period unchanged if already structured.
 *
 * @param period - Period value (may be legacy string or structured object)
 * @param expiresOn - Optional day of month from legacy config
 * @returns Structured QuotaPeriod object
 */
export function ensureStructuredPeriod(
  period: unknown,
  expiresOn?: number
): QuotaPeriod {
  if (isLegacyPeriod(period)) {
    const migrated = migrateQuotaPeriod(period, expiresOn);
    logger.warn('Auto-migrated legacy quota period to structured format', {
      from: period,
      to: migrated,
    });
    return migrated;
  }

  // Already structured — return as-is
  return period as QuotaPeriod;
}
