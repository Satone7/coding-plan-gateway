/**
 * Integration tests for admin routes (plan CRUD endpoints).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createApp } from '@/app';
import { FilePlanRepository } from '@/services/plan-repository';
import { createMockPlanInput } from '../../fixtures/mock-plans';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Admin Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `admin-routes-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');

    // Create repository
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);

    // Create app with admin routes
    app = await createApp();

    // Register admin routes manually (they're not registered by default)
    const { registerAdminRoutes } = await import('@/routes/admin');
    await registerAdminRoutes(app, { repository });
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/plans', () => {
    it('should return empty array when no plans exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/plans',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: [],
        meta: {
          requestId: expect.any(String),
          timestamp: expect.any(String),
        },
      });
    });

    it('should return all plans', async () => {
      await repository.save(createMockPlanInput({ name: 'Plan 1' }));
      await repository.save(createMockPlanInput({ name: 'Plan 2' }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/plans',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data.map((p: { name: string }) => p.name).sort()).toEqual([
        'Plan 1',
        'Plan 2',
      ]);
    });

    it('should not include API keys in response', async () => {
      await repository.save(
        createMockPlanInput({ name: 'Test Plan', apiKey: 'sk-secret-key' })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/plans',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0]).not.toHaveProperty('apiKey');
      expect(body.data[0]).not.toHaveProperty('apiKeyEncrypted');
    });
  });

  describe('GET /api/plans/:planId', () => {
    it('should return 404 when plan does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/plans/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: 'PLAN_NOT_FOUND',
          type: 'not_found',
        },
      });
    });

    it('should return 400 for invalid plan ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/plans/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: 'INVALID_REQUEST',
        },
      });
    });

    it('should return plan when it exists', async () => {
      const plan = await repository.save(createMockPlanInput({ name: 'Test Plan' }));

      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          id: plan.id,
          name: 'Test Plan',
        },
      });
    });
  });

  describe('POST /api/plans', () => {
    it('should create a new plan', async () => {
      const input = createMockPlanInput();

      const response = await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toMatchObject({
        id: expect.any(String),
        name: input.name,
        baseUrl: input.baseUrl,
        models: input.models,
        status: 'active',
      });
    });

    it('should return 400 for invalid request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: {
          name: 'Missing required fields',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate baseUrl is a valid URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: {
          ...createMockPlanInput(),
          baseUrl: 'not-a-url',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate quota period is valid enum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: {
          ...createMockPlanInput(),
          quota: { limit: 100, period: 'invalid' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should persist plan to repository', async () => {
      const input = createMockPlanInput({ name: 'Persisted Plan' });

      await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: input,
      });

      const plans = await repository.findAll();
      expect(plans).toHaveLength(1);
      expect(plans[0].name).toBe('Persisted Plan');
    });
  });

  describe('PUT /api/plans/:planId', () => {
    it('should update an existing plan', async () => {
      const plan = await repository.save(createMockPlanInput());

      const response = await app.inject({
        method: 'PUT',
        url: `/api/plans/${plan.id}`,
        payload: {
          name: 'Updated Name',
          timeout: 60000,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.name).toBe('Updated Name');
      expect(response.json().data.timeout).toBe(60000);
    });

    it('should return 404 when plan does not exist', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/plans/00000000-0000-0000-0000-000000000000',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid plan ID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/plans/not-a-uuid',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should update API key and encrypt it', async () => {
      const plan = await repository.save(createMockPlanInput());

      const response = await app.inject({
        method: 'PUT',
        url: `/api/plans/${plan.id}`,
        payload: {
          apiKey: 'new-secret-key',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the key was encrypted
      const updated = await repository.findById(plan.id);
      expect(updated?.apiKeyEncrypted).toMatch(/^enc:/);
    });

    it('should update quota partially', async () => {
      const plan = await repository.save(
        createMockPlanInput({ quota: { limit: 100, period: 'daily' } })
      );

      const response = await app.inject({
        method: 'PUT',
        url: `/api/plans/${plan.id}`,
        payload: {
          quota: { limit: 200 },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.quota).toEqual({
        limit: 200,
        period: 'daily',
      });
    });

    it('should update status to paused', async () => {
      const plan = await repository.save(createMockPlanInput());

      const response = await app.inject({
        method: 'PUT',
        url: `/api/plans/${plan.id}`,
        payload: {
          status: 'paused',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('paused');
    });
  });

  describe('DELETE /api/plans/:planId', () => {
    it('should delete an existing plan', async () => {
      const plan = await repository.save(createMockPlanInput());

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/plans/${plan.id}`,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');

      // Verify deleted
      const found = await repository.findById(plan.id);
      expect(found).toBeNull();
    });

    it('should return 404 when plan does not exist', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/plans/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid plan ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/plans/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Response format', () => {
    it('should include requestId and timestamp in meta', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/plans',
      });

      const body = response.json();
      expect(body.meta).toHaveProperty('requestId');
      expect(body.meta).toHaveProperty('timestamp');
      // Request ID can be any string format (Fastify uses 'req-N' in tests)
      expect(typeof body.meta.requestId).toBe('string');
      expect(body.meta.requestId.length).toBeGreaterThan(0);
      expect(new Date(body.meta.timestamp).toISOString()).toBe(
        body.meta.timestamp
      );
    });

    it('should include all plan fields except sensitive data', async () => {
      const plan = await repository.save(
        createMockPlanInput({
          name: 'Full Plan',
          baseUrl: 'https://api.example.com',
          models: ['model-1', 'model-2'],
          quota: { limit: 500, period: 'monthly' },
          timeout: 45000,
        })
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}`,
      });

      const body = response.json();
      expect(body.data).toEqual({
        id: plan.id,
        name: 'Full Plan',
        baseUrl: 'https://api.example.com',
        models: ['model-1', 'model-2'],
        quota: { limit: 500, period: 'monthly' },
        timeout: 45000,
        status: 'active',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Should NOT include sensitive fields
      expect(body.data).not.toHaveProperty('apiKey');
      expect(body.data).not.toHaveProperty('apiKeyEncrypted');
    });
  });
});