/**
 * Unit tests for PlanRepository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FilePlanRepository,
  createPlanRepository,
} from '@/services/plan-repository';
import { createMockPlanInput, MOCK_PLAN_IDS } from '../../fixtures/mock-plans';

// Mock encryption key for testing
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('PlanRepository', () => {
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = join(tmpdir(), `plan-repo-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('findById', () => {
    it('should return null when plan does not exist', async () => {
      const result = await repository.findById(MOCK_PLAN_IDS.notFound);
      expect(result).toBeNull();
    });

    it('should return plan when it exists', async () => {
      const created = await repository.save(createMockPlanInput());
      const result = await repository.findById(created.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.name).toBe(created.name);
    });
  });

  describe('findAll', () => {
    it('should return empty array when no plans exist', async () => {
      const result = await repository.findAll();
      expect(result).toEqual([]);
    });

    it('should return all plans', async () => {
      await repository.save(createMockPlanInput({ name: 'Plan 1' }));
      await repository.save(createMockPlanInput({ name: 'Plan 2' }));
      await repository.save(createMockPlanInput({ name: 'Plan 3' }));

      const result = await repository.findAll();
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.name).sort()).toEqual([
        'Plan 1',
        'Plan 2',
        'Plan 3',
      ]);
    });
  });

  describe('findByModel', () => {
    it('should return empty array when no plans support the model', async () => {
      await repository.save(
        createMockPlanInput({ models: ['model-a', 'model-b'] })
      );

      const result = await repository.findByModel('unknown-model');
      expect(result).toEqual([]);
    });

    it('should return plans that support the model (case-insensitive)', async () => {
      await repository.save(
        createMockPlanInput({ name: 'Plan A', models: ['Claude-Sonnet-4-6'] })
      );
      await repository.save(
        createMockPlanInput({ name: 'Plan B', models: ['gpt-4'] })
      );
      await repository.save(
        createMockPlanInput({
          name: 'Plan C',
          models: ['claude-sonnet-4-6', 'gpt-4'],
        })
      );

      const result = await repository.findByModel('claude-sonnet-4-6');
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.name).sort()).toEqual(['Plan A', 'Plan C']);
    });
  });

  describe('findActive', () => {
    it('should return only active plans', async () => {
      const plan1 = await repository.save(createMockPlanInput({ name: 'Active 1' }));
      const plan2 = await repository.save(createMockPlanInput({ name: 'Active 2' }));
      await repository.update(plan1.id, { status: 'paused' });

      const result = await repository.findActive();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(plan2.id);
    });
  });

  describe('save', () => {
    it('should create a new plan with generated ID', async () => {
      const input = createMockPlanInput();
      const result = await repository.save(input);

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('number');
      expect(result.id).toBeGreaterThan(0);
      expect(result.name).toBe(input.name);
      expect(result.baseUrl).toBe(input.baseUrl);
      expect(result.models).toEqual(input.models);
      expect(result.quota).toEqual(input.quota);
      expect(result.status).toBe('active');
      expect(result.timeout).toBe(300);
    });

    it('should use custom timeout when provided', async () => {
      const input = createMockPlanInput({ timeout: 60 });
      const result = await repository.save(input);
      expect(result.timeout).toBe(60);
    });

    it('should encrypt API key when encryption key is provided', async () => {
      const input = createMockPlanInput({ apiKey: 'sk-test-api-key' });
      const result = await repository.save(input);

      expect(result.apiKeyEncrypted).not.toBe('sk-test-api-key');
      expect(result.apiKeyEncrypted).toMatch(/^enc:/);
    });

    it('should persist plan with optional fields to file', async () => {
      await repository.save(createMockPlanInput({ 
        name: 'Full Plan',
        expiresOn: 15,
        expiresAt: '2026-12-31T23:59:59Z',
        weight: 50
      }));

      // Create a new repository instance to verify persistence
      const newRepo = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
      const result = await newRepo.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Full Plan');
      expect(result[0].expiresOn).toBe(15);
      expect(result[0].expiresAt).toBe('2026-12-31T23:59:59Z');
      expect(result[0].weight).toBe(50);
    });

    it('should persist plan to file', async () => {
      await repository.save(createMockPlanInput({ name: 'Persisted Plan' }));

      // Create a new repository instance to verify persistence
      const newRepo = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
      const result = await newRepo.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Persisted Plan');
    });
  });

  describe('update', () => {
    it('should throw error when plan does not exist', async () => {
      await expect(
        repository.update(MOCK_PLAN_IDS.notFound, { name: 'Updated' })
      ).rejects.toThrow('Plan not found');
    });

    it('should update plan fields', async () => {
      const created = await repository.save(createMockPlanInput());
      const updated = await repository.update(created.id, {
        name: 'Updated Name',
        timeout: 60,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.timeout).toBe(60);
      expect(updated.baseUrl).toBe(created.baseUrl);
    });

    it('should update API key and encrypt it', async () => {
      const created = await repository.save(createMockPlanInput());
      const updated = await repository.update(created.id, {
        apiKey: 'new-api-key',
      });

      expect(updated.apiKeyEncrypted).not.toBe('new-api-key');
      expect(updated.apiKeyEncrypted).toMatch(/^enc:/);
    });

    it('should update quota partially', async () => {
      const created = await repository.save(
        createMockPlanInput({ quota: { limit: 100, period: 'daily' } })
      );
      const updated = await repository.update(created.id, {
        quota: { limit: 200 },
      });

      expect(updated.quota.limit).toBe(200);
      expect(updated.quota.period).toBe('daily');
    });

    it('should update status', async () => {
      const created = await repository.save(createMockPlanInput());
      const updated = await repository.update(created.id, { status: 'paused' });

      expect(updated.status).toBe('paused');
    });

    it('should update updatedAt timestamp', async () => {
      const created = await repository.save(createMockPlanInput());
      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await repository.update(created.id, { name: 'Updated' });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });
  });

  describe('delete', () => {
    it('should return false when plan does not exist', async () => {
      const result = await repository.delete(MOCK_PLAN_IDS.notFound);
      expect(result).toBe(false);
    });

    it('should delete existing plan and return true', async () => {
      const created = await repository.save(createMockPlanInput());
      const result = await repository.delete(created.id);

      expect(result).toBe(true);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return false when plan does not exist', async () => {
      const result = await repository.exists(MOCK_PLAN_IDS.notFound);
      expect(result).toBe(false);
    });

    it('should return true when plan exists', async () => {
      const created = await repository.save(createMockPlanInput());
      const result = await repository.exists(created.id);
      expect(result).toBe(true);
    });
  });

  describe('reload', () => {
    it('should reload plans from file', async () => {
      await repository.save(createMockPlanInput({ name: 'Original Plan' }));

      // Manually modify the file
      const yaml = require('yaml');
      const content = yaml.stringify({
        plans: [
          {
            id: 100,
            name: 'Manual Plan',
            baseUrl: 'https://manual.example.com',
            apiKey: 'manual-key',
            models: ['manual-model'],
            quota: { limit: 100, period: 'monthly' },
          },
        ],
      });
      await writeFile(configPath, content, 'utf-8');

      await repository.reload();
      const result = await repository.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Manual Plan');
    });
  });

  describe('getDecryptedApiKey', () => {
    it('should return null when plan does not exist', async () => {
      const result = await repository.getDecryptedApiKey(MOCK_PLAN_IDS.notFound);
      expect(result).toBeNull();
    });

    it('should decrypt API key when encryption key is provided', async () => {
      const input = createMockPlanInput({ apiKey: 'sk-secret-key' });
      const created = await repository.save(input);

      const decrypted = await repository.getDecryptedApiKey(created.id);
      expect(decrypted).toBe('sk-secret-key');
    });
  });

  describe('JSON format support', () => {
    it('should work with JSON files', async () => {
      const jsonPath = join(tempDir, 'plans.json');
      const jsonRepo = new FilePlanRepository(jsonPath, TEST_ENCRYPTION_KEY);

      const created = await jsonRepo.save(createMockPlanInput({ name: 'JSON Plan' }));
      const result = await jsonRepo.findById(created.id);

      expect(result?.name).toBe('JSON Plan');
    });
  });

  describe('createPlanRepository factory', () => {
    it('should create a FilePlanRepository instance', () => {
      const repo = createPlanRepository(configPath, TEST_ENCRYPTION_KEY);
      expect(repo).toBeInstanceOf(FilePlanRepository);
    });
  });

  describe('persistence edge cases', () => {
    it('should handle empty configuration file', async () => {
      await writeFile(configPath, '', 'utf-8');
      const newRepo = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
      const result = await newRepo.findAll();
      expect(result).toEqual([]);
    });

    it('should handle missing plans array', async () => {
      await writeFile(configPath, '{}', 'utf-8');
      const newRepo = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
      const result = await newRepo.findAll();
      expect(result).toEqual([]);
    });
  });
});