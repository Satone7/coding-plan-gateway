/**
 * Unit tests for quota period migration utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  migrateQuotaPeriod,
  isLegacyPeriod,
  ensureStructuredPeriod,
} from '@/utils/quota-period-migration';

describe('migrateQuotaPeriod', () => {
  it('should migrate daily to 5h sliding window', () => {
    const result = migrateQuotaPeriod('daily');
    expect(result).toEqual({ type: '5h', windowHours: 5, sliding: true });
  });

  it('should migrate monthly with expiresOn', () => {
    const result = migrateQuotaPeriod('monthly', 15);
    expect(result).toEqual({ type: 'monthly', expiresOn: 15 });
  });

  it('should migrate monthly without expiresOn (defaults to 1)', () => {
    const result = migrateQuotaPeriod('monthly');
    expect(result).toEqual({ type: 'monthly', expiresOn: 1 });
  });

  it('should migrate total', () => {
    const result = migrateQuotaPeriod('total');
    expect(result).toEqual({ type: 'total' });
  });

  it('should throw for unknown period', () => {
    expect(() => migrateQuotaPeriod('weekly' as never)).toThrow(
      'Unknown legacy quota period'
    );
  });
});

describe('isLegacyPeriod', () => {
  it('should return true for daily', () => {
    expect(isLegacyPeriod('daily')).toBe(true);
  });

  it('should return true for monthly', () => {
    expect(isLegacyPeriod('monthly')).toBe(true);
  });

  it('should return true for total', () => {
    expect(isLegacyPeriod('total')).toBe(true);
  });

  it('should return false for structured period object', () => {
    expect(isLegacyPeriod({ type: '5h', windowHours: 5, sliding: true })).toBe(false);
  });

  it('should return false for unknown string', () => {
    expect(isLegacyPeriod('weekly')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isLegacyPeriod(null)).toBe(false);
  });

  it('should return false for number', () => {
    expect(isLegacyPeriod(42)).toBe(false);
  });
});

describe('ensureStructuredPeriod', () => {
  it('should migrate legacy daily string', () => {
    const result = ensureStructuredPeriod('daily');
    expect(result).toEqual({ type: '5h', windowHours: 5, sliding: true });
  });

  it('should migrate legacy monthly string with expiresOn', () => {
    const result = ensureStructuredPeriod('monthly', 27);
    expect(result).toEqual({ type: 'monthly', expiresOn: 27 });
  });

  it('should pass through structured period unchanged', () => {
    const structured = { type: 'weekly' as const, weekday: 1 as const };
    const result = ensureStructuredPeriod(structured);
    expect(result).toBe(structured);
  });

  it('should pass through structured 5h period unchanged', () => {
    const structured = { type: '5h' as const, windowHours: 5 as const, sliding: true as const };
    const result = ensureStructuredPeriod(structured);
    expect(result).toBe(structured);
  });
});
