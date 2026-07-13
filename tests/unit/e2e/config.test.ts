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
      'nvidia-litellm',
      'nvidia',
    ]);
  });

  it('should expose a unique test model for every built-in provider', () => {
    expect(new Set(E2E_PROVIDER_SPECS.map(provider => provider.testModel)).size).toBe(
      E2E_PROVIDER_SPECS.length
    );
  });

  it('should render config YAML for only enabled preset providers', () => {
    const yaml = renderE2EConfigYaml([
      {
        providerId: 'zhipu',
        envVarName: 'ZHIPU_API_KEY',
        enabled: true,
        reason: null,
        planName: 'Zhipu E2E',
        testModel: 'glm-5-turbo',
        kind: 'anthropic-preset',
      },
      {
        providerId: 'ali',
        envVarName: 'ALI_API_KEY',
        enabled: false,
        reason: 'Missing ALI_API_KEY',
        planName: 'Ali E2E',
        testModel: 'qwen3.6-plus',
        kind: 'anthropic-preset',
      },
    ]);

    expect(yaml).toContain('provider: zhipu');
    expect(yaml).toContain('id: 1');
    expect(yaml).toContain('apiKey: "${ZHIPU_API_KEY}"');
    expect(yaml).not.toContain('provider: ali');
    expect(yaml).toContain('version: 2');
  });

  it('should render anthropic-custom plans with baseUrl + models (no provider field)', () => {
    const yaml = renderE2EConfigYaml([
      {
        providerId: 'nvidia-litellm',
        envVarName: 'LITELLM_MASTER_KEY',
        enabled: true,
        reason: null,
        planName: 'NVIDIA via LiteLLM',
        testModel: 'glm-5.2',
        kind: 'anthropic-custom',
        baseUrl: 'http://192.168.100.1:4000',
        models: ['glm-5.2', 'llama-3.1-8b'],
      },
    ]);

    expect(yaml).toContain('baseUrl: "http://192.168.100.1:4000"');
    expect(yaml).toContain('- glm-5.2');
    expect(yaml).toContain('- llama-3.1-8b');
    expect(yaml).toContain('apiKey: "${LITELLM_MASTER_KEY}"');
    // custom plans must not emit a `provider:` line (they are not a preset)
    expect(yaml).not.toContain('provider:');
  });

  it('should render openai-preset plans with the provider field', () => {
    const yaml = renderE2EConfigYaml([
      {
        providerId: 'nvidia',
        envVarName: 'NVIDIA_API_KEY',
        enabled: true,
        reason: null,
        planName: 'NVIDIA Direct',
        testModel: 'meta/llama-3.1-8b-instruct',
        kind: 'openai-preset',
      },
    ]);

    expect(yaml).toContain('provider: nvidia');
    expect(yaml).toContain('apiKey: "${NVIDIA_API_KEY}"');
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
