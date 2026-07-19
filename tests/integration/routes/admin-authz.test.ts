/**
 * Integration tests for the admin-plane authorization gate (H3).
 *
 * Verifies bootstrap mode: until an admin-scoped key exists the admin plane is
 * open to any valid key (no lockout), and once an admin key exists regular
 * data-plane keys are blocked (403) while admin keys are admitted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { PlanIdCounter, createPlanIdCounter } from '@/services/plan-id-counter';
import { ApiKeyManager, createApiKeyManager } from '@/services/api-key-manager';
import { registerAdminRoutes } from '@/routes/admin';
import { registerAuthMiddleware } from '@/middleware/auth';
import { registerErrorHandler } from '@/middleware/error-handler';
import { createMockPlanInput } from '../../fixtures/mock-plans';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Admin plane authorization gate (H3)', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let apiKeyManager: ApiKeyManager;
  let regularKey: string;
  let adminKey: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `admin-authz-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    const configPath = join(tempDir, 'plans.yaml');
    const counterPath = join(tempDir, 'plan-id-counter.json');
    const keysPath = join(tempDir, 'api-keys.json');

    apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
    await apiKeyManager.initialize();
    regularKey = (await apiKeyManager.createKey({ name: 'regular' })).plaintextKey;

    const planIdCounter = createPlanIdCounter(counterPath);
    await planIdCounter.initialize();
    const repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY, undefined, planIdCounter);
    await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['m1'] }));

    app = Fastify();
    registerAuthMiddleware(app, { apiKeyManager });
    await registerAdminRoutes(app, { repository, apiKeyManager, prefix: '/api/admin' });
    registerErrorHandler(app);
  });

  afterEach(async () => {
    await app.close();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('admits a regular key in bootstrap mode (no admin keys yet)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/plans',
      headers: { Authorization: `Bearer ${regularKey}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('blocks a regular key and admits an admin key once an admin key exists', async () => {
    adminKey = (await apiKeyManager.createKey({ name: 'admin', isAdmin: true })).plaintextKey;

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/admin/plans',
      headers: { Authorization: `Bearer ${regularKey}` },
    });
    expect(blocked.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/plans',
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('hasAdminKeys reports false before and true after an admin key is created', () => {
    expect(apiKeyManager.hasAdminKeys()).toBe(false);
    // createKey with isAdmin is exercised in the test above; verify the flag here
    return apiKeyManager.createKey({ name: 'admin2', isAdmin: true }).then(() => {
      expect(apiKeyManager.hasAdminKeys()).toBe(true);
    });
  });
});
