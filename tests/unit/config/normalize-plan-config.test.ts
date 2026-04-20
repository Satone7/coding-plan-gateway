import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { normalizePlanConfig, loadConfig } from '@/config';

describe('normalizePlanConfig', () => {
  describe('auto-detect provider from baseUrl', () => {
    it('auto-detects zhipu provider from matching baseUrl', () => {
      const plan = {
        name: 'My Zhipu',
        apiKey: 'test-key',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: ['glm-5.1'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBe('zhipu');
    });

    it('auto-detects volcengine provider from matching baseUrl', () => {
      const plan = {
        name: 'My Ark',
        apiKey: 'test-key',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        models: ['ark-code-latest'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBe('volcengine');
    });

    it('auto-detects ali provider from matching baseUrl', () => {
      const plan = {
        name: 'My Ali',
        apiKey: 'test-key',
        baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        models: ['qwen3.5-plus'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBe('ali');
    });

    it('does not set provider for unknown baseUrl', () => {
      const plan = {
        name: 'Custom',
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        models: ['gpt-4'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBeUndefined();
    });

    it('does not override explicit provider field', () => {
      const plan = {
        name: 'Zhipu',
        provider: 'zhipu',
        apiKey: 'test-key',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: ['glm-5.1'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBe('zhipu');
    });

    it('matches baseUrl with trailing slash', () => {
      const plan = {
        name: 'Zhipu',
        apiKey: 'test-key',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic/',
        models: ['glm-5.1'],
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.provider).toBe('zhipu');
    });

    it('does not set provider when baseUrl is missing', () => {
      const plan = {
        name: 'Preset Plan',
        provider: 'zhipu',
        apiKey: 'test-key',
        quota: { limit: 1000, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      // baseUrl filled from preset, provider stays as set
      expect(result.provider).toBe('zhipu');
      expect(result.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    });
  });

  describe('default values', () => {
    it('fills defaults for missing optional fields', () => {
      const plan = {
        name: 'Test',
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        models: ['model-1'],
        quota: { limit: 5000, period: { type: 'monthly' as const, expiresOn: 1 } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.timeout).toBe(300); // DEFAULT_REQUEST_TIMEOUT_SEC
      expect(result.status).toBe('active');
      expect(result.enable).toBe(true);
      expect(result.id).toBeDefined();
    });

    it('fills unlimited quota for provider plans without explicit quota', () => {
      const plan = {
        name: 'Zhipu',
        provider: 'zhipu',
        apiKey: 'test-key',
      };

      const result = normalizePlanConfig(plan);
      expect(result.quota.limit).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.quota.period.type).toBe('total');
      expect(result.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
      expect(result.models).toContain('glm-5');
      expect(result.models).toContain('glm-5.1');
      expect(result.models).toContain('glm-5-turbo');
    });

    it('applies preset modelAliases when not explicitly set', () => {
      const plan = {
        name: 'Zhipu',
        provider: 'zhipu',
        apiKey: 'test-key',
      };

      const result = normalizePlanConfig(plan);
      // cc-switch presets don't define defaultModelAliases
      expect(result.modelAliases).toBeUndefined();
    });

    it('does not override explicit fields with preset values', () => {
      const plan = {
        name: 'Zhipu',
        provider: 'zhipu',
        apiKey: 'test-key',
        baseUrl: 'https://custom.example.com/anthropic',
        models: ['custom-model'],
        quota: { limit: 100, period: { type: 'total' as const } },
      };

      const result = normalizePlanConfig(plan);
      expect(result.baseUrl).toBe('https://custom.example.com/anthropic');
      expect(result.models).toEqual(['custom-model']);
      expect(result.quota.limit).toBe(100);
    });
  });
});

describe('loadConfig autoUpgrade', () => {
  let tempDir: string;

  afterEach(async () => {
    try {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('auto-detects provider, strips redundant preset fields, and normalizes version', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cpg-test-'));
    const configPath = join(tempDir, 'config.yaml');

    const yaml = [
      'version: "1.0"',
      'plans:',
      '  - id: 1',
      '    name: Zhipu',
      '    baseUrl: https://open.bigmodel.cn/api/anthropic',
      '    apiKey: test-key',
      '    models: [glm-5.1, glm-5-turbo]',
      '    quota:',
      '      limit: 8000',
      '      period: { type: total }',
      '    modelAliases:',
      '      glm-5: glm-5-turbo',
    ].join('\n');

    await writeFile(configPath, yaml, 'utf-8');

    const config = await loadConfig(configPath, undefined, { autoUpgrade: true });

    // In-memory: provider auto-detected, all fields present
    expect(config.plans[0].provider).toBe('zhipu');
    expect(config.plans[0].baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(config.plans[0].models).toEqual(['glm-5.1', 'glm-5-turbo']);

    // Backup created
    const files = await readdir(tempDir);
    const bakFiles = files.filter(f => f.endsWith('.bak'));
    expect(bakFiles.length).toBe(1);

    // Persisted config: version normalized, preset fields stripped
    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('provider: zhipu');
    expect(updated).not.toContain('baseUrl:');
    expect(updated).not.toContain('models:');
    expect(updated).not.toContain('quota:');
    // modelAliases is kept (user configuration should persist)
    expect(updated).toContain('modelAliases:');
    expect(updated).toContain('version:');
    expect(updated).not.toContain('"1.0"');
  });

  it('strips baseUrl/models for non-usage-API provider but keeps quota', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cpg-test-'));
    const configPath = join(tempDir, 'config.yaml');

    const yaml = [
      'version: 1',
      'plans:',
      '  - id: 1',
      '    name: Ark',
      '    provider: volcengine',
      '    baseUrl: https://ark.cn-beijing.volces.com/api/coding',
      '    apiKey: test-key',
      '    models: [ark-code-latest, doubao-seed-2.0-code, kimi-k2.5, minimax-m2.5, glm-4.7]',
      '    quota:',
      '      limit: 90000',
      '      period: { type: monthly, expiresOn: 1 }',
    ].join('\n');

    await writeFile(configPath, yaml, 'utf-8');

    await loadConfig(configPath, undefined, { autoUpgrade: true });

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).not.toContain('baseUrl:');
    expect(updated).not.toContain('models:');
    expect(updated).toContain('quota:');    // non-usage-API provider keeps quota
    expect(updated).toContain('provider: volcengine');
  });

  it('keeps customized baseUrl but removes models (user accepts preset models)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cpg-test-'));
    const configPath = join(tempDir, 'config.yaml');

    const yaml = [
      'version: 1',
      'plans:',
      '  - id: 1',
      '    name: Custom Zhipu',
      '    provider: zhipu',
      '    baseUrl: https://proxy.example.com/anthropic',
      '    apiKey: test-key',
      '    models: [glm-5.1]',
      '    quota:',
      '      limit: 8000',
      '      period: { type: total }',
    ].join('\n');

    await writeFile(configPath, yaml, 'utf-8');

    await loadConfig(configPath, undefined, { autoUpgrade: true });

    const updated = await readFile(configPath, 'utf-8');
    expect(updated).toContain('baseUrl: https://proxy.example.com/anthropic');
    // models removed (user accepts preset models)
    expect(updated).not.toContain('models:');
    expect(updated).not.toContain('glm-5.1');
    expect(updated).not.toContain('quota:');  // usage-API provider strips quota
  });

  it('does not persist when no enrichment is needed', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cpg-test-'));
    const configPath = join(tempDir, 'config.yaml');

    const yaml = [
      'version: 1',
      'plans:',
      '  - id: 1',
      '    name: Custom',
      '    baseUrl: https://api.example.com/v1',
      '    apiKey: test-key',
      '    models: [model-1]',
      '    quota:',
      '      limit: 1000',
      '      period: { type: total }',
    ].join('\n');

    await writeFile(configPath, yaml, 'utf-8');

    await loadConfig(configPath, undefined, { autoUpgrade: true });

    const files = await readdir(tempDir);
    const bakFiles = files.filter(f => f.endsWith('.bak'));
    expect(bakFiles.length).toBe(0);
  });

  it('does not persist when config is already clean', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cpg-test-'));
    const configPath = join(tempDir, 'config.yaml');

    const yaml = [
      'version: 1',
      'plans:',
      '  - id: 1',
      '    name: Zhipu',
      '    provider: zhipu',
      '    apiKey: test-key',
    ].join('\n');

    await writeFile(configPath, yaml, 'utf-8');

    await loadConfig(configPath, undefined, { autoUpgrade: true });

    const files = await readdir(tempDir);
    const bakFiles = files.filter(f => f.endsWith('.bak'));
    expect(bakFiles.length).toBe(0);
  });
});
