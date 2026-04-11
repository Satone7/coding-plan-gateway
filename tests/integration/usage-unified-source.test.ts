/**
 * Integration test for unified usage data source across CLI and API.
 * Verifies that usage is consistent when accessed via different interfaces.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { QuotaManager, createQuotaManager } from '@/services/quota-manager';
import { PlanUsageTracker, createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { PlanIdCounter, createPlanIdCounter } from '@/services/plan-id-counter';
import { registerAdminRoutes } from '@/routes/admin';
import { registerErrorHandler } from '@/middleware/error-handler';
import { createMockPlanInput } from '../fixtures/mock-plans';
import { TableFormatter } from '@/cli/output/table';
import { handlePlanSetUsageCommand, handlePlanListCommand } from '@/cli/commands/plan';
import type { CliContext, ParsedArgs } from '@/types/cli';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Unified Usage Data Source', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let quotaManager: QuotaManager;
  let planUsageTracker: PlanUsageTracker;
  let planIdCounter: PlanIdCounter;
  let originalConfigPath: string | undefined;
  let originalUsageDataPath: string | undefined;
  let originalAdjustmentHistoryPath: string | undefined;

  beforeEach(async () => {
    // Save original environment variables
    originalConfigPath = process.env.CONFIG_PATH;
    originalUsageDataPath = process.env.PLAN_USAGE_DATA_PATH;
    originalAdjustmentHistoryPath = process.env.ADJUSTMENT_HISTORY_PATH;

    // Create temp directory
    tempDir = join(tmpdir(), `unified-usage-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');

    // Set environment variables
    process.env.CONFIG_PATH = configPath;
    process.env.PLAN_USAGE_DATA_PATH = join(tempDir, 'plan-usage-data.json');
    process.env.ADJUSTMENT_HISTORY_PATH = join(tempDir, 'adjustment-history.json');

    // Create repository
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);

    // Create and initialize plan ID counter
    planIdCounter = createPlanIdCounter({ counterPath: join(tempDir, 'plan-id-counter.json') });
    await planIdCounter.initialize();
    repository.setPlanIdCounter(planIdCounter);

    // Create quota manager
    quotaManager = createQuotaManager({ quotaStatePath: join(tempDir, 'quota-state.json') });

    // Create plan usage tracker
    planUsageTracker = createPlanUsageTracker({
      planUsageDataPath: join(tempDir, 'plan-usage-data.json'),
      adjustmentHistoryPath: join(tempDir, 'adjustment-history.json'),
    });

    // Attach tracker to QuotaManager for unified source
    quotaManager.setPlanUsageTracker(planUsageTracker);

    // Create Fastify instance
    app = Fastify({ logger: false });

    // Register routes
    registerErrorHandler(app);
    await registerAdminRoutes(app, { repository, quotaManager, planUsageTracker });
    app.get('/health', async () => ({ status: 'ok' }));

    await app.ready();
  });

  afterEach(async () => {
    quotaManager.stopPeriodicSync();
    planUsageTracker.stopPeriodicSync();
    await app.close();
    await rm(tempDir, { recursive: true, force: true });

    // Restore environment variables
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }
    if (originalUsageDataPath !== undefined) {
      process.env.PLAN_USAGE_DATA_PATH = originalUsageDataPath;
    } else {
      delete process.env.PLAN_USAGE_DATA_PATH;
    }
    if (originalAdjustmentHistoryPath !== undefined) {
      process.env.ADJUSTMENT_HISTORY_PATH = originalAdjustmentHistoryPath;
    } else {
      delete process.env.ADJUSTMENT_HISTORY_PATH;
    }
  });

  describe('Consistency between CLI and API', () => {
    it('should show consistent usage after set-usage via CLI', async () => {
      // Start server
      const address = await app.listen({ port: 0 });
      const port = new URL(address).port;
      const gatewayUrl = `http://localhost:${port}`;

      // Create a plan
      const plan = await repository.save(createMockPlanInput({
        name: 'Test Plan',
        quota: { limit: 1000, period: { type: 'monthly' } }
      }));
      await quotaManager.initialize([plan]);
      await planUsageTracker.initialize();

      // Use CLI to set usage
      const formatter = new TableFormatter();
      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: { id: String(plan.id), count: '250' },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl,
        configPath,
        jsonOutput: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePlanSetUsageCommand(context);
      consoleSpy.mockRestore();

      // Check via API - QuotaManager should reflect the same value
      const quotaResponse = await app.inject({
        method: 'GET',
        url: `/api/quota/${plan.id}`,
      });

      expect(quotaResponse.statusCode).toBe(200);
      expect(quotaResponse.json().data.used).toBe(250);

      // Check via API - PlanUsageTracker should reflect the same value
      const usageResponse = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });

      expect(usageResponse.statusCode).toBe(200);
      expect(usageResponse.json().data.totalRequests).toBe(250);

      // Check hasRemainingQuota uses correct value
      expect(quotaManager.hasRemainingQuota(plan.id)).toBe(true);
      expect(quotaManager.getRemainingQuota(plan.id)).toBe(750);
    });

    it('should show consistent usage after quota consumption via API', async () => {
      // Create a plan
      const plan = await repository.save(createMockPlanInput({
        name: 'Test Plan',
        quota: { limit: 1000, period: { type: 'monthly' } }
      }));
      await quotaManager.initialize([plan]);
      await planUsageTracker.initialize();

      // Consume quota via QuotaManager (simulates request processing)
      quotaManager.consumeQuota(plan.id, 100);

      // Persist to ensure CLI can read it
      await planUsageTracker.persist();

      // Check via CLI - plan list should show correct usage
      const formatter = new TableFormatter();
      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'list',
          options: {},
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl: 'http://localhost:8080',
        configPath,
        jsonOutput: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePlanListCommand(context);
      const output = consoleSpy.mock.calls[0]?.[0] || '';
      consoleSpy.mockRestore();

      // Verify output shows 100 used
      expect(output).toContain('100');
    });

    it('should maintain consistency after multiple operations', async () => {
      // Start server
      const address = await app.listen({ port: 0 });
      const port = new URL(address).port;
      const gatewayUrl = `http://localhost:${port}`;

      // Create a plan
      const plan = await repository.save(createMockPlanInput({
        name: 'Test Plan',
        quota: { limit: 1000, period: { type: 'monthly' } }
      }));
      await quotaManager.initialize([plan]);
      await planUsageTracker.initialize();

      // Series of operations
      // 1. Consume 50 via API
      quotaManager.consumeQuota(plan.id, 50);

      // 2. Set to 200 via CLI
      const formatter = new TableFormatter();
      let context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: { id: String(plan.id), count: '200' },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl,
        configPath,
        jsonOutput: false,
      };

      let consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handlePlanSetUsageCommand(context);
      consoleSpy.mockRestore();

      // 3. Consume 30 more via API
      quotaManager.consumeQuota(plan.id, 30);

      // 4. Check all sources show 230
      // Via QuotaManager
      expect(quotaManager.getUsedQuota(plan.id)).toBe(230);

      // Via PlanUsageTracker
      expect(planUsageTracker.getTotalUsage(plan.id)).toBe(230);

      // Via API quota endpoint
      const quotaResponse = await app.inject({
        method: 'GET',
        url: `/api/quota/${plan.id}`,
      });
      expect(quotaResponse.json().data.used).toBe(230);

      // Via API usage endpoint
      const usageResponse = await app.inject({
        method: 'GET',
        url: `/api/plans/${plan.id}/usage`,
      });
      expect(usageResponse.json().data.totalRequests).toBe(230);
    });
  });
});