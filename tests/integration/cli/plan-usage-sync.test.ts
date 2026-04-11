/**
 * Integration tests for plan usage sync with running server.
 * Tests that set-usage CLI command syncs with QuotaManager when server is running.
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
import { createMockPlanInput } from '../../fixtures/mock-plans';
import { TableFormatter } from '@/cli/output/table';
import { handlePlanSetUsageCommand } from '@/cli/commands/plan';
import type { CliContext, ParsedArgs } from '@/types/cli';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Plan Usage Sync with Running Server', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let quotaManager: QuotaManager;
  let quotaPath: string;
  let planUsageTracker: PlanUsageTracker;
  let usageDataPath: string;
  let planIdCounter: PlanIdCounter;
  let counterPath: string;
  let originalConfigPath: string | undefined;
  let originalGatewayUrl: string | undefined;
  let originalUsageDataPath: string | undefined;
  let originalAdjustmentHistoryPath: string | undefined;

  beforeEach(async () => {
    // Save original environment variables
    originalConfigPath = process.env.CONFIG_PATH;
    originalGatewayUrl = process.env.GATEWAY_URL;
    originalUsageDataPath = process.env.PLAN_USAGE_DATA_PATH;
    originalAdjustmentHistoryPath = process.env.ADJUSTMENT_HISTORY_PATH;

    // Create temp directory
    tempDir = join(tmpdir(), `plan-usage-sync-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');
    quotaPath = join(tempDir, 'quota-state.json');
    usageDataPath = join(tempDir, 'plan-usage-data.json');
    counterPath = join(tempDir, 'plan-id-counter.json');

    // Set environment variables for CLI commands
    process.env.CONFIG_PATH = configPath;
    process.env.PLAN_USAGE_DATA_PATH = usageDataPath;
    process.env.ADJUSTMENT_HISTORY_PATH = join(tempDir, 'adjustment-history.json');

    // Create repository
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);

    // Create and initialize plan ID counter
    planIdCounter = createPlanIdCounter({ counterPath });
    await planIdCounter.initialize();
    repository.setPlanIdCounter(planIdCounter);

    // Create quota manager
    quotaManager = createQuotaManager({ quotaStatePath: quotaPath });

    // Create plan usage tracker
    planUsageTracker = createPlanUsageTracker({
      planUsageDataPath: usageDataPath,
      adjustmentHistoryPath: join(tempDir, 'adjustment-history.json'),
    });
    await planUsageTracker.initialize();

    // Create raw Fastify instance
    app = Fastify({
      logger: false,
    });

    // Register error handler
    registerErrorHandler(app);

    // Register admin routes
    await registerAdminRoutes(app, { repository, quotaManager, planUsageTracker });

    // Register health endpoint for gateway detection
    app.get('/health', async () => ({ status: 'ok' }));

    // Wait for app to be ready
    await app.ready();
  });

  afterEach(async () => {
    quotaManager.stopPeriodicSync();
    planUsageTracker.stopPeriodicSync();
    await app.close();
    await rm(tempDir, { recursive: true, force: true });

    // Restore original environment variables
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }
    if (originalGatewayUrl !== undefined) {
      process.env.GATEWAY_URL = originalGatewayUrl;
    } else {
      delete process.env.GATEWAY_URL;
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

  describe('Sync status in output', () => {
    it('should show "not_running" when gateway is not running', async () => {
      const formatter = new TableFormatter();

      // Create a plan
      const plan = await repository.save(createMockPlanInput({ name: 'Test Plan' }));
      await quotaManager.initialize([plan]);

      // Re-initialize tracker for the test
      const newTracker = createPlanUsageTracker({
        planUsageDataPath: usageDataPath,
        adjustmentHistoryPath: join(tempDir, 'adjustment-history.json'),
      });
      await newTracker.initialize();

      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: {
            id: String(plan.id),
            count: '100',
          },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl: 'http://localhost:9999', // Non-existent server
        configPath,
        jsonOutput: false,
      };

      // Capture console.log output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handlePlanSetUsageCommand(context);

      // Get the output
      const output = consoleSpy.mock.calls[0]?.[0] || '';
      consoleSpy.mockRestore();

      // Verify output shows not_running status
      expect(output).toContain('Gateway not running');
    });

    it('should show "synced" when gateway is running and sync succeeds', async () => {
      const formatter = new TableFormatter();

      // Start the server on a random port
      const address = await app.listen({ port: 0 });
      const port = new URL(address).port;
      const gatewayUrl = `http://localhost:${port}`;

      // Create a plan
      const plan = await repository.save(createMockPlanInput({ name: 'Test Plan' }));
      await quotaManager.initialize([plan]);

      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: {
            id: String(plan.id),
            count: '100',
          },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl,
        configPath,
        jsonOutput: false,
      };

      // Capture console.log output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handlePlanSetUsageCommand(context);

      // Get the output
      const output = consoleSpy.mock.calls[0]?.[0] || '';
      consoleSpy.mockRestore();

      // Verify output shows synced status
      expect(output).toContain('Gateway synced');

      // Verify QuotaManager was updated
      expect(quotaManager.getUsedQuota(plan.id)).toBe(100);
    });

    it('should update QuotaManager usage after sync', async () => {
      // Start the server on a random port
      const address = await app.listen({ port: 0 });
      const port = new URL(address).port;
      const gatewayUrl = `http://localhost:${port}`;

      // Create a plan
      const plan = await repository.save(createMockPlanInput({
        name: 'Test Plan',
        quota: { limit: 1000, period: { type: 'monthly' } }
      }));
      await quotaManager.initialize([plan]);

      // Initial usage should be 0
      expect(quotaManager.getUsedQuota(plan.id)).toBe(0);

      const formatter = new TableFormatter();
      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: {
            id: String(plan.id),
            count: '250',
          },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl,
        configPath,
        jsonOutput: false,
      };

      // Capture console.log output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handlePlanSetUsageCommand(context);
      consoleSpy.mockRestore();

      // Verify QuotaManager was updated
      expect(quotaManager.getUsedQuota(plan.id)).toBe(250);
    });
  });

  describe('JSON output with sync status', () => {
    it('should include sync status in JSON output', async () => {
      // Start the server on a random port
      const address = await app.listen({ port: 0 });
      const port = new URL(address).port;
      const gatewayUrl = `http://localhost:${port}`;

      // Create a plan
      const plan = await repository.save(createMockPlanInput({ name: 'Test Plan' }));
      await quotaManager.initialize([plan]);

      // Use JSON formatter
      const { JsonFormatter } = await import('@/cli/output/json');
      const formatter = new JsonFormatter();

      const context: CliContext = {
        args: {
          command: 'plan',
          subcommand: 'set-usage',
          options: {
            id: String(plan.id),
            count: '100',
          },
          positional: [],
        } as ParsedArgs,
        formatter,
        gatewayUrl,
        configPath,
        jsonOutput: true,
      };

      // Capture console.log output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handlePlanSetUsageCommand(context);

      // Get the output
      const output = consoleSpy.mock.calls[0]?.[0] || '';
      consoleSpy.mockRestore();

      // Parse and verify JSON output
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.sync).toBeDefined();
      expect(parsed.sync.status).toBe('synced');
      expect(parsed.sync.gatewaySynced).toBe(true);
    });
  });
});