/**
 * Anthropic-compatible routes registration.
 * Provides /v1/messages endpoint.
 */

import { FastifyInstance } from 'fastify';
import { createAnthropicHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';

/**
 * Options for Anthropic routes.
 */
export interface AnthropicRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Request proxy instance */
  proxy: RequestProxy;
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
  const { repository, proxy, prefix = '/v1' } = options;
  const handlers = createAnthropicHandlers(repository, proxy);

  await app.register(
    (fastify, _options, done) => {
      // POST /v1/messages - Create message
      fastify.post('/messages', (request, reply) => handlers.createMessage(request, reply));

      done();
    },
    { prefix }
  );
}