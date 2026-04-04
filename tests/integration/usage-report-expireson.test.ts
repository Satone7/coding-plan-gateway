/**
 * Integration tests for usage report with expiresOn and structured QuotaPeriod support.
 * Tests that usage reports correctly calculate reset dates based on structured period
 * configuration and legacy expiresOn/defaults.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { PlanUsageTracker, createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { registerAdminRoutes } from '@/routes/admin';
import { registerErrorHandler } from '@/middleware/error-handler';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Usage Report with expiresOn', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let planUsageTracker: PlanUsageTracker;
  let usageDataPath: string;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `usage-report-expireson-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');
    usageDataPath = join(tempDir, 'plan-usage-data.json');

    // Create repository
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);

    // Create plan usage tracker
    planUsageTracker = createPlanUsageTracker({
      planUsageDataPath: usageDataPath,
      adjustmentHistoryPath: join(tempDir, 'adjustment-history.json'),
    });
    await planUsageTracker.initialize();

    // Create Fastify app
    app = Fastify({
      logger: false,
    });

    // Register error handler
    registerErrorHandler(app);

    // Register admin routes with plan usage tracker
    await registerAdminRoutes(app, { repository, planUsageTracker });

    // Wait for app to be ready
    await app.ready();
  });

  afterEach(async () => {
    planUsageTracker.stopPeriodicSync();
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/plans/:planId/usage with structured periods', () => {
    it('should return reset date on the expiresOn day for structured monthly period', async () => {
      // Create a plan with structured monthly period and expiresOn = 27
      const plan = await repository.save({
        name: 'Test Plan with monthly expiresOn 27',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: {
          limit: 1000,
          period: { type: 'monthly', expiresOn: 27 },
        },
      });

      // Track some usage
      planUsageTracker.incrementDailyUsage(plan.id);
      planUsageTracker.incrementDailyUsage(plan.id);
      await planUsageTracker.persist();

      // Get usage report
      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.data.planId).toBe(plan.id);
      expect(body.data.totalRequests).toBe(2);
      expect(body.data.resetAt).toBeDefined();
      // Verify reset date is on day 27 of a month
      const resetDate = new Date(body.data.resetAt);
      expect(resetDate.getUTCDate()).toBe(27);
    });

    it('should return correct reset date for monthly period without expiresOn', async () => {
      // Create a plan without expiresOn in the period
      const plan = await repository.save({
        name: 'Test Plan without expiresOn',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: {
          limit: 1000,
          period: { type: 'monthly' },
        },
      });

      // Track some usage
      planUsageTracker.incrementDailyUsage(plan.id);
      await planUsageTracker.persist();

      // Get usage report
      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Without expiresOn, monthly defaults to 1st of next month
      const resetDate = new Date(body.data.resetAt);
      expect(resetDate.getUTCDate()).toBe(1);
    });

    it('should return null reset date for total period', async () => {
      // Create a plan with structured total period
      const plan = await repository.save({
        name: 'Test Plan with total period',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: {
          limit: 100000,
          period: { type: 'total' },
        },
      });

      // Track some usage
      planUsageTracker.incrementDailyUsage(plan.id);
      await planUsageTracker.persist();

      // Get usage report
      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Total period should have no reset date
      expect(body.data.resetAt).toBeNull();
    });

    it('should return reset date 5 hours in the future for 5h sliding period', async () => {
      // Create a plan with structured 5h sliding period
      const plan = await repository.save({
        name: 'Test Plan with 5h period',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: {
          limit: 100,
          period: { type: '5h', windowHours: 5, sliding: true },
        },
      });

      // Track some usage
      planUsageTracker.incrementDailyUsage(plan.id);
      await planUsageTracker.persist();

      // Get usage report
      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Should have a reset date approximately 5 hours from now
      expect(body.data.resetAt).toBeDefined();
      const resetDate = new Date(body.data.resetAt);
      const now = new Date();
      const diffMs = resetDate.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      // Allow some tolerance for test execution time
      expect(diffHours).toBeGreaterThan(4.9);
      expect(diffHours).toBeLessThanOrEqual(5.1);
    });

    it('should return reset date at next weekday midnight for weekly period', async () => {
      // Create a plan with structured weekly period (Monday = 1)
      const plan = await repository.save({
        name: 'Test Plan with weekly period',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: {
          limit: 200,
          period: { type: 'weekly', weekday: 1 },
        },
      });

      // Track some usage
      planUsageTracker.incrementDailyUsage(plan.id);
      await planUsageTracker.persist();

      // Get usage report
      const response = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Should have a reset date at midnight UTC on a Monday
      expect(body.data.resetAt).toBeDefined();
      const resetDate = new Date(body.data.resetAt);
      // ISO weekday 1 = Monday, JS getUTCDay() for Monday = 1
      expect(resetDate.getUTCDay()).toBe(1); // Monday
      expect(resetDate.getUTCHours()).toBe(0);
      expect(resetDate.getUTCMinutes()).toBe(0);
      expect(resetDate.getUTCSeconds()).toBe(0);
    });
  });

  describe('GET /api/plans/usage/summary with structured periods', () => {
    it('should return usage summary with correct reset dates for all period types', async () => {
      // Create multiple plans with different structured periods
      await repository.save({
        name: '5h Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } },
      });

      await repository.save({
        name: 'Monthly Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: { limit: 1000, period: { type: 'monthly', expiresOn: 15 } },
      });

      await repository.save({
        name: 'Total Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: { limit: 100000, period: { type: 'total' } },
      });

      await repository.save({
        name: 'Weekly Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        models: ['test-model'],
        quota: { limit: 500, period: { type: 'weekly', weekday: 5 } },
      });

      // Get usage summary
      const response = await app.inject({
        method: 'GET',
        url: '/api/plans/usage/summary',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.data).toHaveLength(4);
      expect(body.meta.totalPlans).toBe(4);

      // Check each plan has appropriate reset date
      const fiveHourPlan = body.data.find(
        (p: { quotaPeriod: { type: string } }) => p.quotaPeriod.type === '5h'
      );
      const monthlyPlan = body.data.find(
        (p: { quotaPeriod: { type: string } }) => p.quotaPeriod.type === 'monthly'
      );
      const totalPlan = body.data.find(
        (p: { quotaPeriod: { type: string } }) => p.quotaPeriod.type === 'total'
      );
      const weeklyPlan = body.data.find(
        (p: { quotaPeriod: { type: string } }) => p.quotaPeriod.type === 'weekly'
      );

      expect(fiveHourPlan.resetAt).toBeDefined();
      expect(fiveHourPlan.quotaPeriod.type).toBe('5h');

      expect(monthlyPlan.resetAt).toBeDefined();
      expect(monthlyPlan.quotaPeriod.type).toBe('monthly');
      expect(monthlyPlan.quotaPeriod.expiresOn).toBe(15);

      expect(totalPlan.resetAt).toBeNull();
      expect(totalPlan.quotaPeriod.type).toBe('total');

      expect(weeklyPlan.resetAt).toBeDefined();
      expect(weeklyPlan.quotaPeriod.type).toBe('weekly');
      expect(weeklyPlan.quotaPeriod.weekday).toBe(5);
    });
  });
});