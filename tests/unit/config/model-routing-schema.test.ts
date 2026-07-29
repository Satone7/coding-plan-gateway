/**
 * Unit tests for the modelRouting Zod schema.
 */

import { describe, it, expect } from 'vitest';
import { modelRoutingConfigSchema, configSchema } from '@/config/schema';

describe('modelRoutingConfigSchema', () => {
  it('defaults to disabled with empty strategies when omitted', () => {
    const result = modelRoutingConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.strategies).toEqual([]);
  });

  it('parses a context-downgrade config and preserves strategy params', () => {
    const result = modelRoutingConfigSchema.parse({
      enabled: true,
      strategies: [
        {
          id: 'context-downgrade',
          enabled: true,
          rules: [{ from: 'k3', to: 'k3-256k', when: { inputTokensLte: 240000 } }],
        },
      ],
    });
    expect(result.enabled).toBe(true);
    expect(result.strategies).toHaveLength(1);
    expect(result.strategies[0].id).toBe('context-downgrade');
    expect(result.strategies[0].enabled).toBe(true);
    // passthrough preserves strategy-specific `rules`
    const rules = (result.strategies[0] as { rules?: unknown[] }).rules;
    expect(Array.isArray(rules)).toBe(true);
    expect((rules as Array<{ to: string }>)[0].to).toBe('k3-256k');
  });

  it('defaults strategy `enabled` to true when omitted', () => {
    const result = modelRoutingConfigSchema.parse({
      strategies: [{ id: 'context-downgrade' }],
    });
    expect(result.strategies[0].enabled).toBe(true);
  });

  it('rejects a strategy entry without an id', () => {
    expect(() =>
      modelRoutingConfigSchema.parse({ enabled: true, strategies: [{ enabled: true }] })
    ).toThrow();
  });
});

describe('configSchema.modelRouting', () => {
  it('is optional and absent by default', () => {
    const result = configSchema.parse({ plans: [] });
    expect(result.modelRouting).toBeUndefined();
  });

  it('is parsed when present', () => {
    const result = configSchema.parse({
      plans: [],
      modelRouting: {
        enabled: true,
        strategies: [{ id: 'context-downgrade', rules: [] }],
      },
    });
    expect(result.modelRouting?.enabled).toBe(true);
    expect(result.modelRouting?.strategies[0].id).toBe('context-downgrade');
  });
});
