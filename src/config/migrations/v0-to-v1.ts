import type { ConfigMigration } from './types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_PERIODS = ['daily', 'monthly', 'total'] as const;
type LegacyPeriod = (typeof LEGACY_PERIODS)[number];

export function migrateV0ToV1(config: Record<string, unknown>): Record<string, unknown> {
  const plans = (config.plans as Record<string, unknown>[]) ?? [];
  let nextId = 1;

  for (const plan of plans) {
    if (!plan || typeof plan !== 'object') continue;

    // 1. Migrate quota period: string → structured
    if (plan.quota && typeof plan.quota === 'object') {
      const quota = plan.quota as Record<string, unknown>;
      if (isLegacyPeriod(quota.period)) {
        const expiresOn =
          (quota.expiresOn as number | undefined) ?? (plan.expiresOn as number | undefined);
        quota.period = migratePeriod(quota.period as LegacyPeriod, expiresOn);
        if (plan.expiresOn !== undefined && quota.expiresOn === undefined) {
          delete plan.expiresOn;
        }
      }
    }

    // 2. Migrate plan ID: UUID → integer
    if (typeof plan.id === 'string' && UUID_PATTERN.test(plan.id)) {
      plan.id = nextId++;
    } else if (plan.id === undefined) {
      plan.id = nextId++;
    }
  }

  return { ...config, version: 1 };
}

function isLegacyPeriod(period: unknown): period is LegacyPeriod {
  return typeof period === 'string' && (LEGACY_PERIODS as readonly string[]).includes(period);
}

function migratePeriod(period: LegacyPeriod, expiresOn?: number): Record<string, unknown> {
  switch (period) {
    case 'daily':
      return { type: '5h', windowHours: 5, sliding: true };
    case 'monthly':
      return { type: 'monthly', expiresOn: expiresOn ?? 1 };
    case 'total':
      return { type: 'total' };
  }
}

export const v0ToV1Migration: ConfigMigration = {
  version: 1,
  description: 'Migrate string quota periods to structured objects and UUID IDs to integers',
  migrate: migrateV0ToV1,
};
