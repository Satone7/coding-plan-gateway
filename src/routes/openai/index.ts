/**
 * OpenAI-compatible routes registration.
 * Provides /v1/chat/completions and /v1/models endpoints.
 */

import { FastifyInstance } from 'fastify';
import { createOpenAIHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';

/**
 * Options for OpenAI routes.
 */
export interface OpenAIRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Request proxy instance */
  proxy: RequestProxy;
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
  const { repository, proxy, prefix = '/v1' } = options;
  const handlers = createOpenAIHandlers(repository, proxy);

  await app.register(
    async (fastify) => {
      // POST /v1/chat/completions - Create chat completion
      fastify.post('/chat/completions', handlers.createChatCompletion);

      // GET /v1/models - List available models
      fastify.get('/models', handlers.listModels);
    },
    { prefix }
  );
}