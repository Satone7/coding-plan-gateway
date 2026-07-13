import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGatewayApiKey,
  isContainerRunning,
  isDockerAvailable,
  loadE2EProviders,
} from './support';

/**
 * NVIDIA preset OpenAI-direct E2E.
 *
 * Covers the `nvidia` built-in preset (OpenAI-only, `baseUrl: ''` sentinel,
 * `dynamicModels`). The NVIDIA upstream speaks `/v1/chat/completions` only,
 * so this is driven by direct OpenAI-format requests from the host — NOT by
 * Claude Code (which is an Anthropic client). The Anthropic path to NVIDIA
 * is covered separately by claude-code-providers.test.ts via the
 * `nvidia-litellm` plan through the LiteLLM converter.
 *
 * Requires `gateway-e2e` running and `NVIDIA_API_KEY` set in `.env`.
 */
describe('NVIDIA OpenAI-direct E2E', () => {
  const dockerAvailable = isDockerAvailable();
  const gatewayRunning = isContainerRunning('gateway-e2e');
  const providers = loadE2EProviders();
  const nvidiaDirect = providers.find(
    (provider) => provider.providerId === 'nvidia' && provider.kind === 'openai-preset'
  );
  const enabled = nvidiaDirect?.enabled ?? false;

  const gatewayPort = process.env.E2E_GATEWAY_PORT ?? '8081';
  const baseUrl = `http://localhost:${gatewayPort}/api`;

  let apiKey: string | null = null;

  beforeAll(() => {
    if (!dockerAvailable || !gatewayRunning || !enabled) {
      return;
    }
    apiKey = createGatewayApiKey(`NVIDIA Direct E2E ${Date.now()}`);
  }, 30000);

  afterAll(() => {
    if (nvidiaDirect && !nvidiaDirect.enabled) {
      console.log(`[e2e] nvidia-direct skipped: ${nvidiaDirect.reason}`);
    }
  });

  it.skipIf(!dockerAvailable || !gatewayRunning || !enabled)(
    'should expose NVIDIA models on /v1/models (dynamicModels catalog)',
    async () => {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = body.data?.map((model) => model.id) ?? [];
      // NVIDIA's catalog is vendor-namespaced (z-ai/, meta/, ...). Its presence
      // proves the gateway reached integrate.api.nvidia.com and dynamicModels
      // succeeded — distinct from the un-namespaced models of other plans.
      const nvidiaModel = ids.find((id) => /^[a-z0-9.-]+\//i.test(id));
      expect(nvidiaModel, `expected a vendor-namespaced NVIDIA model, got: ${ids.join(', ')}`).toBeTruthy();
    },
    60000
  );

  it.skipIf(!dockerAvailable || !gatewayRunning || !enabled)(
    'should complete a non-streaming OpenAI chat request directly to NVIDIA',
    async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: nvidiaDirect!.testModel,
          messages: [{ role: 'user', content: 'Reply with exactly the word READY.' }],
          stream: false,
          max_tokens: 32,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content ?? '';
      expect(content.trim().length).toBeGreaterThan(0);
    },
    120000
  );
});
