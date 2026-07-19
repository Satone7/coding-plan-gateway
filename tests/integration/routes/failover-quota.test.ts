/**
 * Integration tests for failover quota accounting (H5).
 *
 * Verifies that a request served by a failover (alternative) plan is charged
 * to that plan, while the failed primary is refunded; and that an alternative
 * which fails is NOT charged (consume + refund = net zero), so concurrent
 * legitimate usage on that plan is not corrupted by a spurious refund.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { QuotaManager, createQuotaManager } from '@/services/quota-manager';
import { registerAnthropicRoutes } from '@/routes/anthropic';
import { registerErrorHandler } from '@/middleware/error-handler';
import { createMockPlanInput } from '../../fixtures/mock-plans';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Failover quota accounting (H5)', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let quotaManager: QuotaManager;
  let proxy: RequestProxy;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `failover-quota-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    const configPath = join(tempDir, 'plans.yaml');
    const quotaPath = join(tempDir, 'quota-state.json');

    const repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
    await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['glm-5.2'] }));
    await repository.save(createMockPlanInput({ name: 'Plan-B', models: ['glm-5.2'] }));

    quotaManager = createQuotaManager({ quotaStatePath: quotaPath });
    const plans = await repository.findAll();
    await quotaManager.initialize(plans);

    proxy = new RequestProxy();
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await registerAnthropicRoutes(app, { repository, proxy, quotaManager });
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const STREAM_BODY = {
    model: 'glm-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: true,
  };

  it('charges the failover plan that serves the request and refunds the failed primary', async () => {
    const primaryId = 1;
    const altId = 2;
    const err429 = Object.assign(new Error('Upstream error: 429'), { statusCode: 429 });
    vi.spyOn(proxy, 'forwardAnthropicStream')
      .mockRejectedValueOnce(err429) // primary fails
      .mockImplementationOnce(async (_b, _o, _onChunk, reply, _onTok) => {
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
        reply.raw.write('event: message_start\ndata: {}\n\n');
        reply.raw.end();
      }); // alt succeeds

    const beforeAlt = quotaManager.getQuotaState(altId)!.used;
    const beforePrimary = quotaManager.getQuotaState(primaryId)!.used;

    const response = await app.inject({ method: 'POST', url: '/v1/messages', payload: STREAM_BODY });

    expect(response.statusCode).toBe(200);
    // Alt served the request → charged exactly one unit.
    expect(quotaManager.getQuotaState(altId)!.used).toBe(beforeAlt + 1);
    // Primary was charged optimistically then refunded on failure → net zero.
    expect(quotaManager.getQuotaState(primaryId)!.used).toBe(beforePrimary);
  });

  it('does not corrupt an alternative plan with a spurious refund when failover also fails', async () => {
    const altId = 2;
    const err429 = Object.assign(new Error('Upstream error: 429'), { statusCode: 429 });
    // Primary + alt both fail (no headers sent) → failover exhausted, primary error surfaced.
    vi.spyOn(proxy, 'forwardAnthropicStream').mockRejectedValue(err429);

    // Simulate prior legitimate usage on the alt plan.
    quotaManager.consumeQuota(altId);
    const beforeAlt = quotaManager.getQuotaState(altId)!.used; // 1

    await app.inject({ method: 'POST', url: '/v1/messages', payload: STREAM_BODY });

    // Alt was charged for the attempt then refunded on failure → net zero on
    // top of its prior usage. Previously the code refunded WITHOUT consuming,
    // which would have decremented this to 0.
    expect(quotaManager.getQuotaState(altId)!.used).toBe(beforeAlt);
  });
});
