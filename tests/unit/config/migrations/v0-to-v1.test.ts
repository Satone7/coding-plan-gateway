import { describe, it, expect } from 'vitest';
import { migrateV0ToV1 } from '@/config/migrations/v0-to-v1';

describe('migrateV0ToV1', () => {
  it('should set version to 1', () => {
    const config: Record<string, unknown> = { plans: [] };
    const result = migrateV0ToV1(config);
    expect(result.version).toBe(1);
  });

  it('should migrate string period "daily" to structured 5h', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'daily' },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: '5h', windowHours: 5, sliding: true });
  });

  it('should migrate string period "monthly" with expiresOn from quota level', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'monthly', expiresOn: 15 },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: 'monthly', expiresOn: 15 });
  });

  it('should migrate string period "monthly" with expiresOn from plan level', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'monthly' },
          expiresOn: 20,
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: 'monthly', expiresOn: 20 });
  });

  it('should migrate string period "total"', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'total' },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: 'total' });
  });

  it('should convert UUID plan IDs to sequential integers', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Plan A',
          baseUrl: 'https://a.example.com',
          apiKey: 'key-a',
          models: ['model-a'],
          quota: { limit: 100, period: 'daily' },
        },
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          name: 'Plan B',
          baseUrl: 'https://b.example.com',
          apiKey: 'key-b',
          models: ['model-b'],
          quota: { limit: 200, period: 'total' },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plans = result.plans as any[];
    expect(plans[0].id).toBe(1);
    expect(plans[1].id).toBe(2);
  });

  it('should preserve existing integer IDs', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          id: 42,
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    expect((result.plans as any[])[0].id).toBe(42);
  });

  it('should be idempotent — running on already-migrated config is safe', () => {
    const config: Record<string, unknown> = {
      version: 1,
      plans: [
        {
          id: 1,
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    expect(result.version).toBe(1);
    expect((result.plans as any[])[0].id).toBe(1);
    expect((result.plans as any[])[0].quota.period).toEqual({
      type: '5h', windowHours: 5, sliding: true,
    });
  });

  it('should handle plans without id field', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'daily' },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    expect(typeof (result.plans as any[])[0].id).toBe('number');
  });

  it('should remove top-level expiresOn after migrating period', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'monthly' },
          expiresOn: 27,
        },
      ],
    };

    const result = migrateV0ToV1(config);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: 'monthly', expiresOn: 27 });
    expect(plan.expiresOn).toBeUndefined();
  });

  it('should pass through already-structured periods unchanged', () => {
    const structuredPeriod = { type: 'weekly', weekday: 3 };
    const config: Record<string, unknown> = {
      plans: [
        {
          id: 1,
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: structuredPeriod },
        },
      ],
    };

    const result = migrateV0ToV1(config);
    expect((result.plans as any[])[0].quota.period).toBe(structuredPeriod);
  });
});
