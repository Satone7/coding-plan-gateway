/**
 * OpenAI-compatible routes registration.
 * Provides /v1/chat/completions and /v1/models endpoints.
 */

import { FastifyInstance } from 'fastify';
import { createOpenAIHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { QuotaManager } from '@/services/quota-manager';
import type { ProviderRegistry } from '@/services/provider-registry';
import type { LoadBalanceConfig } from '@/types/load-balancing';

/**
 * Options for OpenAI routes.
 */
export interface OpenAIRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Request proxy instance */
  proxy: RequestProxy;
  /** Quota manager instance */
  quotaManager?: QuotaManager;
  /** Provider registry for usage API integration */
  providerRegistry?: ProviderRegistry;
  /** Load balancing configuration */
  loadBalanceConfig?: LoadBalanceConfig;
  /** API prefix (default: '/v1') */
  prefix?: string;
}

/**
 * Register OpenAI-compatible routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options including repository and proxy
 */
export async function registerOpenAIRoutes(
  app: FastifyInstance,
  options: OpenAIRoutesOptions
): Promise<void> {
  const { repository, proxy, quotaManager, providerRegistry, loadBalanceConfig, prefix = '/v1' } = options;
  const handlers = createOpenAIHandlers(repository, proxy, quotaManager, providerRegistry, loadBalanceConfig);

  await app.register(
    (fastify, _options, done) => {
      // POST /v1/chat/completions - Create chat completion
      fastify.post('/chat/completions', handlers.createChatCompletion);

      // GET /v1/models - List available models
      fastify.get('/models', handlers.listModels);

      // GET /v1/models/:model - Get specific model info
      fastify.get('/models/:model', handlers.getModel);

      done();
    },
    { prefix }
  );
}