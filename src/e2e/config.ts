export interface E2EProviderSpec {
  providerId: 'zhipu' | 'volcengine' | 'ali' | 'deepseek';
  envVarName: 'ZHIPU_API_KEY' | 'VOLCENGINE_API_KEY' | 'ALI_API_KEY' | 'DEEPSEEK_API_KEY';
  planName: string;
  testModel: string;
}

export interface ConfiguredE2EProvider extends E2EProviderSpec {
  enabled: boolean;
  reason: string | null;
}

export const E2E_PROVIDER_SPECS: readonly E2EProviderSpec[] = [
  {
    providerId: 'zhipu',
    envVarName: 'ZHIPU_API_KEY',
    planName: 'Zhipu E2E',
    testModel: 'glm-5-turbo',
  },
  {
    providerId: 'volcengine',
    envVarName: 'VOLCENGINE_API_KEY',
    planName: 'Volcengine E2E',
    testModel: 'ark-code-latest',
  },
  {
    providerId: 'ali',
    envVarName: 'ALI_API_KEY',
    planName: 'Ali E2E',
    testModel: 'qwen3.6-plus',
  },
  {
    providerId: 'deepseek',
    envVarName: 'DEEPSEEK_API_KEY',
    planName: 'DeepSeek E2E',
    testModel: 'deepseek-v4-flash',
  },
];

export const CLAUDE_HOME_CONFIG = {
  hasCompletedOnboarding: true,
};

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getConfiguredE2EProviders(
  env: Partial<Record<E2EProviderSpec['envVarName'], string | undefined>>
): ConfiguredE2EProvider[] {
  return E2E_PROVIDER_SPECS.map((provider) => ({
    ...provider,
    enabled: hasNonEmptyValue(env[provider.envVarName]),
    reason: hasNonEmptyValue(env[provider.envVarName]) ? null : `Missing ${provider.envVarName}`,
  }));
}

export function renderE2EConfigYaml(providers: ConfiguredE2EProvider[]): string {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  if (enabledProviders.length === 0) {
    throw new Error('No E2E providers are configured');
  }

  const planBlocks = enabledProviders.map((provider) => [
    '  -',
    `    id: ${enabledProviders.findIndex((entry) => entry.providerId === provider.providerId) + 1}`,
    `    name: "${provider.planName}"`,
    `    provider: ${provider.providerId}`,
    `    apiKey: "\${${provider.envVarName}}"`,
  ].join('\n'));

  return [
    'version: 2',
    'plans:',
    ...planBlocks,
    '',
  ].join('\n');
}
