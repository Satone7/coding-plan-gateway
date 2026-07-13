/**
 * E2E plan kind — how a provider is wired into the gateway config and tested.
 *
 * - `anthropic-preset`: built-in provider with an Anthropic `baseUrl` (zhipu,
 *   volcengine, ali, deepseek). Tested via Claude Code against /v1/messages.
 * - `anthropic-custom`: a custom Anthropic-capable plan whose `baseUrl` points
 *   at an external Anthropic↔OpenAI converter (e.g. LiteLLM fronting NVIDIA).
 *   Tested via Claude Code — the gateway stays format-bound and just forwards.
 * - `openai-preset`: an OpenAI-only built-in provider (NVIDIA, `baseUrl: ''`
 *   sentinel). NOT testable via Claude Code; covered by a direct OpenAI
 *   `/v1/chat/completions` request instead.
 */
export type E2EPlanKind = 'anthropic-preset' | 'anthropic-custom' | 'openai-preset';

export interface E2EProviderSpec {
  providerId: string;
  envVarName: string;
  planName: string;
  testModel: string;
  kind: E2EPlanKind;
  /** anthropic-custom only: the converter/upstream Anthropic base URL. */
  baseUrl?: string;
  /** anthropic-custom only: explicit model list the converter exposes. */
  models?: string[];
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
    kind: 'anthropic-preset',
  },
  {
    providerId: 'volcengine',
    envVarName: 'VOLCENGINE_API_KEY',
    planName: 'Volcengine E2E',
    testModel: 'ark-code-latest',
    kind: 'anthropic-preset',
  },
  {
    providerId: 'ali',
    envVarName: 'ALI_API_KEY',
    planName: 'Ali E2E',
    testModel: 'qwen3.6-plus',
    kind: 'anthropic-preset',
  },
  {
    providerId: 'deepseek',
    envVarName: 'DEEPSEEK_API_KEY',
    planName: 'DeepSeek E2E',
    testModel: 'deepseek-v4-flash',
    kind: 'anthropic-preset',
  },
  {
    // Anthropic clients (Claude Code) reach NVIDIA through an external
    // Anthropic↔OpenAI converter. A self-contained LiteLLM service in the
    // e2e compose network exposes glm-5.2/llama-3.1-8b as an Anthropic
    // /v1/messages surface and forwards to NVIDIA. The gateway forwards
    // /v1/messages to this plan verbatim — no conversion.
    providerId: 'nvidia-litellm',
    envVarName: 'LITELLM_MASTER_KEY',
    planName: 'NVIDIA via LiteLLM',
    testModel: 'glm-5.2',
    kind: 'anthropic-custom',
    baseUrl: 'http://litellm:4000',
    models: ['glm-5.2', 'llama-3.1-8b'],
  },
  {
    // NVIDIA preset OpenAI-only direct path. Serves /v1/chat/completions
    // exclusively (baseUrl '' sentinel). Cannot be reached by Claude Code;
    // covered by a direct OpenAI request. Uses llama rather than glm-5.2 as
    // the smoke model — glm-5.2 has been observed to hang on NVIDIA's free
    // tier while llama responds promptly.
    providerId: 'nvidia',
    envVarName: 'NVIDIA_API_KEY',
    planName: 'NVIDIA Direct',
    testModel: 'meta/llama-3.1-8b-instruct',
    kind: 'openai-preset',
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

/**
 * Render the indented fields for a single plan (everything after `  -` and
 * the `id:` line).
 *
 * - anthropic-custom emits `baseUrl` + `models` + `apiKey` (no `provider`
 *   field — it is a custom plan, not a built-in preset).
 * - preset kinds emit `provider` + `apiKey` and inherit the preset's models.
 */
function renderPlanFields(provider: ConfiguredE2EProvider): string[] {
  if (provider.kind === 'anthropic-custom') {
    const lines = [
      `    name: "${provider.planName}"`,
      `    baseUrl: "${provider.baseUrl ?? ''}"`,
      // Custom plans have no preset to inherit a quota from, and the schema
      // requires one. Effectively unlimited — this is E2E only.
      '    quota:',
      '      limit: 9007199254740991',
      '      period:',
      '        type: total',
      `    models:`,
    ];
    for (const model of provider.models ?? []) {
      lines.push(`      - ${model}`);
    }
    lines.push(`    apiKey: "\${${provider.envVarName}}"`);
    return lines;
  }
  return [
    `    name: "${provider.planName}"`,
    `    provider: ${provider.providerId}`,
    `    apiKey: "\${${provider.envVarName}}"`,
  ];
}

export function renderE2EConfigYaml(providers: ConfiguredE2EProvider[]): string {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  if (enabledProviders.length === 0) {
    throw new Error('No E2E providers are configured');
  }

  const planBlocks = enabledProviders.map((provider, index) =>
    ['  -', `    id: ${index + 1}`, ...renderPlanFields(provider)].join('\n')
  );

  return [
    'version: 2',
    'plans:',
    ...planBlocks,
    '',
  ].join('\n');
}
