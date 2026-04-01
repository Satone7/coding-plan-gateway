/**
 * Anthropic-compatible routes registration.
 * Provides /v1/messages endpoint.
 */

import { FastifyInstance } from 'fastify';
import { createAnthropicHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { QuotaManager } from '@/services/quota-manager';
import type { ModelAliases } from '@/services/model-resolver';

/**
 * Options for Anthropic routes.
 */
export interface AnthropicRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Request proxy instance */
  proxy: RequestProxy;
  /** Quota manager instance */
  quotaManager?: QuotaManager;
  /** Model aliases for resolution */
  modelAliases?: ModelAliases;
  /** API prefix (default: '/v1') */
  prefix?: string;
}

/**
 * Register Anthropic-compatible routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options including repository and proxy
 */
export async function registerAnthropicRoutes(
  app: FastifyInstance,
  options: AnthropicRoutesOptions
): Promise<void> {
  const { repository, proxy, quotaManager, modelAliases, prefix = '/v1' } = options;
  const handlers = createAnthropicHandlers(repository, proxy, quotaManager, modelAliases);

  await app.register(
    (fastify, _options, done) => {
      // POST /v1/messages - Create message
      fastify.post('/messages', handlers.createMessage);

      // POST /v1/messages/count_tokens - Count tokens
      fastify.post('/messages/count_tokens', handlers.countTokens);

      done();
    },
    { prefix }
  );
}