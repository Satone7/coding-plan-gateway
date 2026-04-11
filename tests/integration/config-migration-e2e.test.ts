import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm, access, copyFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateConfigFile } from '@/config/migrations';
import { parse as parseYaml } from 'yaml';

describe('Config migration end-to-end', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `config-migration-e2e-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.yaml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should migrate a real v0 config (UUID IDs + string periods) to v1', async () => {
    // Write a realistic v0 config
    const v0Yaml = `plans:
  - id: 11111111-2222-3333-4444-555555555555
    name: "Ark Coding Plan"
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding"
    apiKey: "test-key"
    models:
      - "ark-code-latest"
    quota:
      limit: 90000
      period: "daily"
    timeout: 180
    status: "active"
  - name: "Ali Coding Plan"
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic"
    apiKey: "test-key-2"
    models:
      - "qwen3.5-plus"
    quota:
      limit: 50000
      period: "monthly"
      expiresOn: 15
    timeout: 180
`;
    await writeFile(configPath, v0Yaml);

    // Run migration
    const result = await migrateConfigFile(configPath);

    // Verify result
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.backupPath).not.toBeNull();

    // Verify backup exists with original content
    const backupContent = await readFile(result.backupPath!, 'utf-8');
    expect(backupContent).toBe(v0Yaml);

    // Verify migrated file
    const migratedContent = await readFile(configPath, 'utf-8');
    const migrated = parseYaml(migratedContent) as any;

    expect(migrated.version).toBe(1);
    expect(migrated.plans).toHaveLength(2);

    // Plan 1: UUID→int, daily→5h
    expect(migrated.plans[0].id).toBe(1);
    expect(migrated.plans[0].quota.period).toEqual({
      type: '5h', windowHours: 5, sliding: true,
    });

    // Plan 2: no id→assigned, monthly→structured
    expect(migrated.plans[1].id).toBe(2);
    expect(migrated.plans[1].quota.period).toEqual({
      type: 'monthly', expiresOn: 15,
    });
  });

  it('should be idempotent — running migration again on already-migrated config is no-op', async () => {
    const v0Yaml = `plans:
  - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
    name: "Test"
    baseUrl: "https://example.com"
    apiKey: "key"
    models: ["m"]
    quota:
      limit: 100
      period: "total"
`;
    await writeFile(configPath, v0Yaml);

    // First migration
    const result1 = await migrateConfigFile(configPath);
    expect(result1.migrated).toBe(true);

    // Second migration — should be no-op
    const result2 = await migrateConfigFile(configPath);
    expect(result2.migrated).toBe(false);
    expect(result2.fromVersion).toBe(1);
    expect(result2.backupPath).toBeNull();
  });

  it('should preserve all plan fields through migration', async () => {
    const v0Yaml = `plans:
  - name: "Full Feature Plan"
    baseUrl: "https://example.com"
    apiKey: "secret-key"
    models:
      - "model-a"
      - "model-b"
    quota:
      limit: 500
      period: "daily"
    timeout: 300
    status: "paused"
    weight: 75
    enable: false
    modelAliases:
      alias1: "model-a"
`;
    await writeFile(configPath, v0Yaml);

    const result = await migrateConfigFile(configPath);
    expect(result.migrated).toBe(true);

    const migrated = parseYaml(await readFile(configPath, 'utf-8')) as any;
    const plan = migrated.plans[0];

    expect(plan.name).toBe('Full Feature Plan');
    expect(plan.baseUrl).toBe('https://example.com');
    expect(plan.apiKey).toBe('secret-key');
    expect(plan.models).toEqual(['model-a', 'model-b']);
    expect(plan.quota.limit).toBe(500);
    expect(plan.quota.period.type).toBe('5h');
    expect(plan.timeout).toBe(300);
    expect(plan.status).toBe('paused');
    expect(plan.weight).toBe(75);
    expect(plan.enable).toBe(false);
    expect(plan.modelAliases).toEqual({ alias1: 'model-a' });
  });
});
