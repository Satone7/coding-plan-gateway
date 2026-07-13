import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfiguredE2EProvider } from '@/e2e/config';
import {
  createGatewayApiKey,
  execInClaudeCode,
  execInGateway,
  isContainerRunning,
  isDockerAvailable,
  loadE2EProviders,
} from './support';

describe('Claude Code real-provider E2E', () => {
  const dockerAvailable = isDockerAvailable();
  const gatewayRunning = isContainerRunning('gateway-e2e');
  const claudeRunning = isContainerRunning('claude-code-e2e');
  const providers = loadE2EProviders();
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const skippedProviders = providers.filter((provider) => !provider.enabled);
  // Claude Code is an Anthropic client; OpenAI-only providers (NVIDIA preset,
  // kind 'openai-preset') cannot be reached via /v1/messages and are covered
  // by nvidia-openai-direct.test.ts instead.
  const anthropicProviders = providers.filter((provider) => provider.kind !== 'openai-preset');
  const anthropicEnabled = anthropicProviders.filter((provider) => provider.enabled);

  let gatewayApiKey: string | null = null;

  beforeAll(() => {
    if (!dockerAvailable) {
      console.warn('Docker not available - skipping Claude Code provider E2E tests');
      return;
    }
    if (!gatewayRunning || !claudeRunning) {
      console.warn('E2E containers not running - start them with npm run e2e:start');
      return;
    }
    gatewayApiKey = createGatewayApiKey(`Claude Code E2E ${Date.now()}`);
  }, 30000);

  afterAll(() => {
    const covered = enabledProviders.map((provider) => provider.providerId).join(', ') || 'none';
    const skipped = skippedProviders
      .map((provider) => `${provider.providerId} (${provider.reason})`)
      .join(', ') || 'none';

    console.log(`[e2e] covered providers: ${covered}`);
    console.log(`[e2e] skipped providers: ${skipped}`);
  });

  it('should record skipped providers in the runtime summary', () => {
    expect(Array.isArray(skippedProviders)).toBe(true);
    for (const provider of skippedProviders) {
      expect(provider.reason).toMatch(/^Missing /);
    }
  });

  it.skipIf(!dockerAvailable || !gatewayRunning || !claudeRunning || anthropicEnabled.length === 0)(
    'should run Claude Code through the gateway for at least one configured provider',
    () => {
      const provider = anthropicEnabled[0]!;
      const result = runClaudePrompt(provider, gatewayApiKey!);

      expect(result.exitCode).toBe(0);
      expect((result.stdout + result.stderr).trim().length).toBeGreaterThan(0);
      expect(result.stdout).not.toContain('Not logged in');
    },
    120000
  );

  for (const provider of anthropicProviders) {
    it.skipIf(!dockerAvailable || !gatewayRunning || !claudeRunning || !provider.enabled)(
      `should complete a real Claude Code request for provider ${provider.providerId}`,
      () => {
        const modelList = execInGateway([
          'wget',
          '--header',
          `Authorization: Bearer ${gatewayApiKey!}`,
          '-qO-',
          'http://127.0.0.1:8080/api/v1/models',
        ]);

        expect(modelList.exitCode).toBe(0);
        expect(modelList.stdout).toContain(provider.testModel);

        const result = runClaudePrompt(provider, gatewayApiKey!);

        expect(result.exitCode).toBe(0);
        expect((result.stdout + result.stderr).trim().length).toBeGreaterThan(0);
        expect(result.stdout + result.stderr).not.toContain('invalid_api_key');
      },
      120000
    );
  }
});

function runClaudePrompt(provider: ConfiguredE2EProvider, gatewayApiKey: string) {
  return execInClaudeCode(
    [
      'claude',
      '--bare',
      '--output-format',
      'json',
      '-p',
      `Reply with exactly the word READY for ${provider.providerId}.`,
    ],
    {
      ANTHROPIC_API_KEY: gatewayApiKey,
      ANTHROPIC_BASE_URL: 'http://gateway-e2e:8080/api',
      ANTHROPIC_MODEL: provider.testModel,
    }
  );
}
