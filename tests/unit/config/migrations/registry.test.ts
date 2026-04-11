import { describe, it, expect } from 'vitest';
import { runMigrations, getRegisteredMigrations, needsMigration } from '@/config/migrations/registry';
import { LATEST_CONFIG_VERSION } from '@/config/defaults';

describe('runMigrations', () => {
  it('should return same config when version is already latest', () => {
    const config: Record<string, unknown> = {
      version: LATEST_CONFIG_VERSION,
      plans: [],
    };
    const result = runMigrations(config, LATEST_CONFIG_VERSION);
    expect(result.version).toBe(LATEST_CONFIG_VERSION);
  });

  it('should run all applicable migrations in order', () => {
    const config: Record<string, unknown> = {
      plans: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Test',
          baseUrl: 'https://example.com',
          apiKey: 'key',
          models: ['m'],
          quota: { limit: 100, period: 'daily' },
        },
      ],
    };

    const result = runMigrations(config, 0);
    expect(result.version).toBe(LATEST_CONFIG_VERSION);
    const plan = (result.plans as any[])[0];
    expect(plan.quota.period).toEqual({ type: '5h', windowHours: 5, sliding: true });
    expect(plan.id).toBe(1);
  });

  it('should have migrations sorted by version ascending', () => {
    const migrations = getRegisteredMigrations();
    for (let i = 1; i < migrations.length; i++) {
      expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
    }
  });

  it('should return same config when fromVersion equals latest', () => {
    const config: Record<string, unknown> = { version: LATEST_CONFIG_VERSION, plans: [] };
    const result = runMigrations(config, LATEST_CONFIG_VERSION);
    expect(result).toBe(config);
  });
});

describe('needsMigration', () => {
  it('should return true when fromVersion is less than LATEST', () => {
    expect(needsMigration(0)).toBe(true);
  });

  it('should return false when fromVersion equals LATEST', () => {
    expect(needsMigration(LATEST_CONFIG_VERSION)).toBe(false);
  });
});
