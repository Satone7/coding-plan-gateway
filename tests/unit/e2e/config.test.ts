import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HOME_CONFIG,
  E2E_PROVIDER_SPECS,
  getConfiguredE2EProviders,
  renderE2EConfigYaml,
} from '@/e2e/config';

describe('E2E config helpers', () => {
  it('should mark only providers with configured API keys as enabled', () => {
    const providers = getConfiguredE2EProviders({
      ZHIPU_API_KEY: 'zhipu-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    expect(providers.filter(provider => provider.enabled).map(provider => provider.providerId)).toEqual([
      'zhipu',
      'deepseek',
    ]);
    expect(providers.filter(provider => !provider.enabled).map(provider => provider.providerId)).toEqual([
      'volcengine',
      'ali',
    ]);
  });

  it('should expose a unique test model for every built-in provider', () => {
    expect(new Set(E2E_PROVIDER_SPECS.map(provider => provider.testModel)).size).toBe(
      E2E_PROVIDER_SPECS.length
    );
  });

  it('should render config YAML for only enabled providers', () => {
    const yaml = renderE2EConfigYaml([
      {
        providerId: 'zhipu',
        envVarName: 'ZHIPU_API_KEY',
        enabled: true,
        reason: null,
        planName: 'Zhipu E2E',
        testModel: 'glm-5-turbo',
      },
      {
        providerId: 'ali',
        envVarName: 'ALI_API_KEY',
        enabled: false,
        reason: 'Missing ALI_API_KEY',
        planName: 'Ali E2E',
        testModel: 'qwen3.6-plus',
      },
    ]);

    expect(yaml).toContain('provider: zhipu');
    expect(yaml).toContain('id: 1');
    expect(yaml).toContain('apiKey: "${ZHIPU_API_KEY}"');
    expect(yaml).not.toContain('provider: ali');
    expect(yaml).toContain('version: 2');
  });

  it('should throw when no providers are configured', () => {
    expect(() => renderE2EConfigYaml(getConfiguredE2EProviders({}))).toThrow(
      'No E2E providers are configured'
    );
  });

  it('should provide the minimal Claude home bootstrap config', () => {
    expect(CLAUDE_HOME_CONFIG).toEqual({
      hasCompletedOnboarding: true,
    });
  });
});
