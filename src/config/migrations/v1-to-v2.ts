import type { ConfigMigration } from './types';

export function migrateV1ToV2(config: Record<string, unknown>): Record<string, unknown> {
  const plans = (config.plans as Record<string, unknown>[]) ?? [];

  for (const plan of plans) {
    if (!plan || typeof plan !== 'object') continue;
    delete plan.apiFormat;
  }

  return { ...config, version: 2 };
}

export const v1ToV2Migration: ConfigMigration = {
  version: 2,
  description: 'Remove apiFormat field from plans (cross-format conversion removed)',
  migrate: migrateV1ToV2,
};
