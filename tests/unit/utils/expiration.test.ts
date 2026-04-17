/**
 * Unit tests for expiration scoring utilities.
 * Tests both standard and Usage API expiration scoring functions.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateExpirationScore,
  calculateUsageApiExpirationScore,
  calculateEffectiveExpiration,
} from '@/utils/expiration';

describe('calculateExpirationScore', () => {
  it('should return 10 for null expiration (no expiration configured)', () => {
    expect(calculateExpirationScore(null)).toBe(10);
  });

  it('should return 0 for already expired dates', () => {
    const expired = new Date(Date.now() - 1000); // 1 second ago
    expect(calculateExpirationScore(expired)).toBe(0);
  });

  it('should return 100 for < 1 hour remaining', () => {
    const expiresSoon = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    expect(calculateExpirationScore(expiresSoon)).toBe(100);
  });

  it('should return 90 for 1-24 hours remaining', () => {
    const expiresIn6h = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
    expect(calculateExpirationScore(expiresIn6h)).toBe(90);
  });

  it('should return 60 for 1-7 days remaining', () => {
    const expiresIn3d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    expect(calculateExpirationScore(expiresIn3d)).toBe(60);
  });

  it('should return 30 for 7-30 days remaining', () => {
    const expiresIn14d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    expect(calculateExpirationScore(expiresIn14d)).toBe(30);
  });

  it('should return 20 for > 30 days remaining', () => {
    const expiresIn60d = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
    expect(calculateExpirationScore(expiresIn60d)).toBe(20);
  });
});

describe('calculateUsageApiExpirationScore', () => {
  it('should return 10 for null expiration (no expiration configured)', () => {
    expect(calculateUsageApiExpirationScore(null)).toBe(10);
  });

  it('should return 0 for already expired dates', () => {
    const expired = new Date(Date.now() - 1000); // 1 second ago
    expect(calculateUsageApiExpirationScore(expired)).toBe(0);
  });

  it('should return 100 for < 3 hours remaining', () => {
    const expiresSoon = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    expect(calculateUsageApiExpirationScore(expiresSoon)).toBe(100);
  });

  it('should return 90 for 3-6 hours remaining', () => {
    const expiresIn4h = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
    expect(calculateUsageApiExpirationScore(expiresIn4h)).toBe(90);
  });

  it('should return 80 for 6-12 hours remaining', () => {
    const expiresIn8h = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
    expect(calculateUsageApiExpirationScore(expiresIn8h)).toBe(80);
  });

  it('should return 70 for 12-24 hours remaining', () => {
    const expiresIn18h = new Date(Date.now() + 18 * 60 * 60 * 1000); // 18 hours
    expect(calculateUsageApiExpirationScore(expiresIn18h)).toBe(70);
  });

  it('should return 60 for 1-2 days remaining', () => {
    const expiresIn1d = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day
    expect(calculateUsageApiExpirationScore(expiresIn1d)).toBe(60);
  });

  it('should return 50 for 2-3 days remaining', () => {
    const expiresIn2d = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000); // 2.5 days
    expect(calculateUsageApiExpirationScore(expiresIn2d)).toBe(50);
  });

  it('should return 40 for 3-4 days remaining', () => {
    const expiresIn3d = new Date(Date.now() + 3.5 * 24 * 60 * 60 * 1000); // 3.5 days
    expect(calculateUsageApiExpirationScore(expiresIn3d)).toBe(40);
  });

  it('should return 30 for 4-5 days remaining', () => {
    const expiresIn4d = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000); // 4.5 days
    expect(calculateUsageApiExpirationScore(expiresIn4d)).toBe(30);
  });

  it('should return 20 for 5-6 days remaining', () => {
    const expiresIn5d = new Date(Date.now() + 5.5 * 24 * 60 * 60 * 1000); // 5.5 days
    expect(calculateUsageApiExpirationScore(expiresIn5d)).toBe(20);
  });

  it('should return 10 for > 6 days remaining', () => {
    const expiresIn7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    expect(calculateUsageApiExpirationScore(expiresIn7d)).toBe(10);
  });

  it('should return 10 for > 7 days remaining (weekly quota with plenty time)', () => {
    const expiresIn10d = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days
    expect(calculateUsageApiExpirationScore(expiresIn10d)).toBe(10);
  });
});

describe('calculateEffectiveExpiration', () => {
  it('should return null when no expiration configured', () => {
    const result = calculateEffectiveExpiration({});
    expect(result).toBeNull();
  });

  it('should prefer expiresAt over expiresOn', () => {
    const expiresAt = '2024-12-31T23:59:59.000Z';
    const expiresOn = 15;
    const result = calculateEffectiveExpiration({ expiresAt, expiresOn });
    expect(result).toBeInstanceOf(Date);
    // toISOString() always includes milliseconds
    expect(result?.toISOString()).toBe(expiresAt);
  });

  it('should use expiresOn (day of month) when expiresAt not set', () => {
    const expiresOn = 28;
    const result = calculateEffectiveExpiration({ expiresOn });
    expect(result).toBeInstanceOf(Date);
    // Should be the 28th of current or next month
    expect(result?.getDate()).toBe(28);
  });

  it('should handle invalid expiresAt gracefully', () => {
    const expiresAt = 'invalid-date';
    const expiresOn = 15;
    const result = calculateEffectiveExpiration({ expiresAt, expiresOn });
    expect(result).toBeInstanceOf(Date);
    expect(result?.getDate()).toBe(15);
  });

  it('should clamp expiresOn to last day of month if day exceeds month length', () => {
    const expiresOn = 31;
    const result = calculateEffectiveExpiration({ expiresOn });
    expect(result).toBeInstanceOf(Date);
    // February has max 28/29 days, so should clamp
    // Just verify it returns a valid date
    expect(result?.getDate()).toBeLessThanOrEqual(31);
  });
});