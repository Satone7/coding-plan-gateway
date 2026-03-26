/**
 * Unit tests for UUID to Integer migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isUuid,
  isMigrationNeeded,
  performMigration,
  type MigrationOptions,
} from '@/migration/uuid-to-int';
import { createPlanIdCounter } from '@/services/plan-id-counter';

// Mock the logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UUID to Integer Migration', () => {
  let tempDir: string;
  let configPath: string;
  let quotaStatePath: string;
  let counterPath: string;
  let migrationLogPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `migration-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'config.yaml');
    quotaStatePath = join(tempDir, 'quota-state.json');
    counterPath = join(tempDir, 'plan-id-counter.json');
    migrationLogPath = join(tempDir, 'migration-log.json');
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isUuid', () => {
    it('should return true for valid UUIDs', () => {
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUuid('660e8400-e29b-41d4-a716-446655440001')).toBe(true);
      expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
      expect(isUuid('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isUuid('')).toBe(false);
      expect(isUuid('123')).toBe(false);
    });

    it('should return false for integers', () => {
      expect(isUuid('1')).toBe(false);
      expect(isUuid('12345')).toBe(false);
    });
  });

  describe('isMigrationNeeded', () => {
    it('should return false when config file does not exist', async () => {
      const result = await isMigrationNeeded(join(tempDir, 'non-existent.yaml'));
      expect(result).toBe(false);
    });

    it('should return false when no UUID IDs exist', async () => {
      const config = {
        plans: [
          { id: 1, name: 'Plan 1', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
          { id: 2, name: 'Plan 2', baseUrl: 'https://api.example.com', apiKey: 'key2', models: ['model2'], quota: { limit: 200, period: 'monthly' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const result = await isMigrationNeeded(configPath);
      expect(result).toBe(false);
    });

    it('should return true when UUID IDs exist', async () => {
      const config = {
        plans: [
          { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Plan 1', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const result = await isMigrationNeeded(configPath);
      expect(result).toBe(true);
    });

    it('should return false for mixed IDs without UUIDs', async () => {
      const config = {
        plans: [
          { id: 1, name: 'Plan 1', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
          { id: 'not-a-uuid', name: 'Plan 2', baseUrl: 'https://api.example.com', apiKey: 'key2', models: ['model2'], quota: { limit: 200, period: 'monthly' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const result = await isMigrationNeeded(configPath);
      expect(result).toBe(false);
    });
  });

  describe('performMigration', () => {
    it('should return not migrated when no UUIDs exist', async () => {
      const config = {
        plans: [
          { id: 1, name: 'Plan 1', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const planIdCounter = createPlanIdCounter({ counterPath });
      await planIdCounter.initialize();

      const options: MigrationOptions = {
        configPath,
        quotaStatePath,
        planIdCounter,
        migrationLogPath,
      };

      const result = await performMigration(options);

      expect(result.migrated).toBe(false);
      expect(result.planCount).toBe(0);
      expect(result.mappings).toHaveLength(0);
    });

    it('should migrate UUID IDs to sequential integers', async () => {
      // Use JSON extension for JSON format test
      const jsonConfigPath = join(tempDir, 'config.json');
      const config = {
        plans: [
          { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Plan A', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
          { id: '660e8400-e29b-41d4-a716-446655440001', name: 'Plan B', baseUrl: 'https://api.example.com', apiKey: 'key2', models: ['model2'], quota: { limit: 200, period: 'monthly' } },
        ],
      };
      await writeFile(jsonConfigPath, JSON.stringify(config), 'utf-8');

      const planIdCounter = createPlanIdCounter({ counterPath });
      await planIdCounter.initialize();

      const options: MigrationOptions = {
        configPath: jsonConfigPath,
        quotaStatePath,
        planIdCounter,
        migrationLogPath,
      };

      const result = await performMigration(options);

      expect(result.migrated).toBe(true);
      expect(result.planCount).toBe(2);
      expect(result.mappings).toHaveLength(2);

      // Verify mappings
      expect(result.mappings[0].oldUuid).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.mappings[0].newId).toBe(1);
      expect(result.mappings[0].planName).toBe('Plan A');

      expect(result.mappings[1].oldUuid).toBe('660e8400-e29b-41d4-a716-446655440001');
      expect(result.mappings[1].newId).toBe(2);
      expect(result.mappings[1].planName).toBe('Plan B');

      // Verify config file was updated
      const updatedContent = await readFile(jsonConfigPath, 'utf-8');
      const updatedConfig = JSON.parse(updatedContent);
      expect(updatedConfig.plans[0].id).toBe(1);
      expect(updatedConfig.plans[1].id).toBe(2);

      // Verify migration log was created
      const logContent = await readFile(migrationLogPath, 'utf-8');
      const log = JSON.parse(logContent);
      expect(log.version).toBe('1.0');
      expect(log.mappings).toHaveLength(2);

      // Verify migration was marked complete
      expect(planIdCounter.isMigrationComplete()).toBe(true);
    });

    it('should create backup files', async () => {
      const config = {
        plans: [
          { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Plan A', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const quotaState = [
        { planId: '550e8400-e29b-41d4-a716-446655440000', used: 50, limit: 100, period: 'daily', lastUpdated: new Date().toISOString(), resetAt: null },
      ];
      await writeFile(quotaStatePath, JSON.stringify(quotaState), 'utf-8');

      const planIdCounter = createPlanIdCounter({ counterPath });
      await planIdCounter.initialize();

      const options: MigrationOptions = {
        configPath,
        quotaStatePath,
        planIdCounter,
        migrationLogPath,
      };

      const result = await performMigration(options);

      expect(result.migrated).toBe(true);
      expect(result.backups.config).not.toBeNull();
      expect(result.backups.quotaState).not.toBeNull();
      expect(result.backups.config).toContain('backup');
      expect(result.backups.quotaState).toContain('backup');
    });

    it('should update quota state with new integer IDs', async () => {
      const config = {
        plans: [
          { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Plan A', baseUrl: 'https://api.example.com', apiKey: 'key1', models: ['model1'], quota: { limit: 100, period: 'daily' } },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const quotaState = [
        { planId: '550e8400-e29b-41d4-a716-446655440000', used: 50, limit: 100, period: 'daily', lastUpdated: new Date().toISOString(), resetAt: null },
      ];
      await writeFile(quotaStatePath, JSON.stringify(quotaState), 'utf-8');

      const planIdCounter = createPlanIdCounter({ counterPath });
      await planIdCounter.initialize();

      const options: MigrationOptions = {
        configPath,
        quotaStatePath,
        planIdCounter,
        migrationLogPath,
      };

      await performMigration(options);

      // Verify quota state was updated
      const updatedQuotaState = JSON.parse(await readFile(quotaStatePath, 'utf-8'));
      expect(updatedQuotaState[0].planId).toBe(1);
    });

    it('should handle YAML config files', async () => {
      const yamlContent = `
plans:
  - id: "550e8400-e29b-41d4-a716-446655440000"
    name: Plan A
    baseUrl: https://api.example.com
    apiKey: key1
    models:
      - model1
    quota:
      limit: 100
      period: daily
`;
      await writeFile(configPath, yamlContent, 'utf-8');

      const planIdCounter = createPlanIdCounter({ counterPath });
      await planIdCounter.initialize();

      const options: MigrationOptions = {
        configPath,
        quotaStatePath,
        planIdCounter,
        migrationLogPath,
      };

      const result = await performMigration(options);

      expect(result.migrated).toBe(true);
      expect(result.planCount).toBe(1);

      // Verify config file remains YAML format with updated ID
      const updatedContent = await readFile(configPath, 'utf-8');
      expect(updatedContent).toContain('id: 1');
      expect(updatedContent).toContain('name: Plan A');
    });
  });
});