/**
 * Unit tests for quota config schema validation.
 * Tests that expiresOn and expiresAt fields work correctly inside quota.
 */

import { describe, it, expect } from 'vitest';
import { quotaConfigSchema } from '@/config/schema';

describe('quotaConfigSchema', () => {
  it('should parse quota with expiresOn inside quota', () => {
    const input = {
      limit: 90000,
      period: 'monthly' as const,
      expiresOn: 27,
    };

    const result = quotaConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresOn).toBe(27);
    }
  });

  it('should parse quota with expiresAt inside quota', () => {
    const input = {
      limit: 90000,
      period: 'monthly' as const,
      expiresAt: '2026-04-27T23:59:59.999Z',
    };

    const result = quotaConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).toBe('2026-04-27T23:59:59.999Z');
    }
  });

  it('should parse quota with both expiresOn and expiresAt inside quota', () => {
    const input = {
      limit: 90000,
      period: 'monthly' as const,
      expiresOn: 27,
      expiresAt: '2026-04-27T23:59:59.999Z',
    };

    const result = quotaConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresOn).toBe(27);
      expect(result.data.expiresAt).toBe('2026-04-27T23:59:59.999Z');
    }
  });

  it('should validate expiresOn is between 1 and 31', () => {
    const invalidInput = {
      limit: 90000,
      period: 'monthly' as const,
      expiresOn: 32,
    };

    const result = quotaConfigSchema.safeParse(invalidInput);

    expect(result.success).toBe(false);
  });

  it('should validate expiresOn is at least 1', () => {
    const invalidInput = {
      limit: 90000,
      period: 'monthly' as const,
      expiresOn: 0,
    };

    const result = quotaConfigSchema.safeParse(invalidInput);

    expect(result.success).toBe(false);
  });
});