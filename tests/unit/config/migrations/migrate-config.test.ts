import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm, access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateConfigFile } from '@/config/migrations';
import { LATEST_CONFIG_VERSION } from '@/config/defaults';
import { stringify as stringifyYaml } from 'yaml';

describe('migrateConfigFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `config-migrate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should not modify file when config is already at latest version', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const content = `version: ${LATEST_CONFIG_VERSION}\nplans: []\n`;
    await writeFile(configPath, content);

    const result = await migrateConfigFile(configPath);

    expect(result.migrated).toBe(false);
    expect(result.fromVersion).toBe(LATEST_CONFIG_VERSION);
    expect(result.toVersion).toBe(LATEST_CONFIG_VERSION);
    expect(result.backupPath).toBeNull();

    const afterContent = await readFile(configPath, 'utf-8');
    expect(afterContent).toBe(content);
  });

  it('should migrate v0 config and write back', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const v0Config = {
      plans: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Test Plan',
          baseUrl: 'https://example.com',
          apiKey: 'test-key',
          models: ['model-a'],
          quota: { limit: 100, period: 'daily' },
        },
      ],
    };
    await writeFile(configPath, stringifyYaml(v0Config));

    const result = await migrateConfigFile(configPath);

    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(LATEST_CONFIG_VERSION);
    expect(result.backupPath).not.toBeNull();

    const backupExists = await access(result.backupPath!, constants.F_OK)
      .then(() => true)
      .catch(() => false);
    expect(backupExists).toBe(true);

    const updatedContent = await readFile(configPath, 'utf-8');
    const updated = (await import('yaml')).parse(updatedContent) as Record<string, unknown>;
    expect(updated.version).toBe(LATEST_CONFIG_VERSION);

    const plans = updated.plans as any[];
    expect(plans[0].id).toBe(1);
    expect(plans[0].quota.period.type).toBe('5h');
  });

  it('should migrate "1.0" string version config (treated as v1, needs v2 migration)', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const oldConfig = {
      version: '1.0',
      plans: [],
    };
    await writeFile(configPath, stringifyYaml(oldConfig));

    const result = await migrateConfigFile(configPath);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
  });

  it('should throw for config version newer than supported', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const futureConfig = {
      version: 999,
      plans: [],
    };
    await writeFile(configPath, stringifyYaml(futureConfig));

    await expect(migrateConfigFile(configPath)).rejects.toThrow(/newer than supported/);
  });

  it('should create backup before modifying file', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const originalContent = stringifyYaml({
      plans: [
        {
          name: 'Test',
          baseUrl: 'https://example.com',
          apiKey: 'key',
          models: ['m'],
          quota: { limit: 100, period: 'total' },
        },
      ],
    });
    await writeFile(configPath, originalContent);

    const result = await migrateConfigFile(configPath);

    const backupContent = await readFile(result.backupPath!, 'utf-8');
    expect(backupContent).toBe(originalContent);
  });

  it('should not create backup when no migration is needed', async () => {
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(configPath, `version: ${LATEST_CONFIG_VERSION}\nplans: []\n`);

    const result = await migrateConfigFile(configPath);
    expect(result.backupPath).toBeNull();
  });
});
