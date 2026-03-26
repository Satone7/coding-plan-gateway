/**
 * Unit tests for PlanIdCounter service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PlanIdCounter, createPlanIdCounter } from '@/services/plan-id-counter';
import { MAX_SAFE_PLAN_ID } from '@/types/plan-id-counter';

// Mock the logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PlanIdCounter', () => {
  let tempDir: string;
  let counterPath: string;
  let migrationLogPath: string;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = join(tmpdir(), `plan-id-counter-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    counterPath = join(tempDir, 'plan-id-counter.json');
    migrationLogPath = join(tempDir, 'migration-log.json');
  });

  afterEach(async () => {
    // Cleanup temp files
    try {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should initialize with default state when no file exists', async () => {
      const counter = new PlanIdCounter({ counterPath });

      await counter.initialize();

      expect(counter.getLastAssignedId()).toBe(0);
      expect(counter.isMigrationComplete()).toBe(false);
    });

    it('should load existing state from file', async () => {
      // Create existing state file
      const existingState = {
        lastAssignedId: 42,
        migrationComplete: true,
        migratedAt: '2026-03-26T10:00:00Z',
      };
      await writeFile(counterPath, JSON.stringify(existingState), 'utf-8');

      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      expect(counter.getLastAssignedId()).toBe(42);
      expect(counter.isMigrationComplete()).toBe(true);
    });

    it('should use default state for invalid file content', async () => {
      await writeFile(counterPath, 'invalid json', 'utf-8');

      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      expect(counter.getLastAssignedId()).toBe(0);
      expect(counter.isMigrationComplete()).toBe(false);
    });
  });

  describe('getNextId', () => {
    it('should return sequential IDs starting from 1', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      const id1 = await counter.getNextId();
      const id2 = await counter.getNextId();
      const id3 = await counter.getNextId();

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });

    it('should persist state after each ID assignment', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      await counter.getNextId();
      await counter.getNextId();

      // Create a new counter instance to verify persistence
      const counter2 = new PlanIdCounter({ counterPath });
      await counter2.initialize();

      expect(counter2.getLastAssignedId()).toBe(2);
    });

    it('should throw error when max safe integer is exceeded', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      // Set counter to near max
      await counter.setCounter(MAX_SAFE_PLAN_ID - 1);

      // Should work
      const id = await counter.getNextId();
      expect(id).toBe(MAX_SAFE_PLAN_ID);

      // Should throw
      await expect(counter.getNextId()).rejects.toThrow(
        'Maximum plan ID' // Match part of error message
      );
    });

    it('should throw error if not initialized', async () => {
      const counter = new PlanIdCounter({ counterPath });

      await expect(counter.getNextId()).rejects.toThrow('not been initialized');
    });
  });

  describe('setCounter', () => {
    it('should set the counter to a specific value', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      await counter.setCounter(100);

      expect(counter.getLastAssignedId()).toBe(100);

      const nextId = await counter.getNextId();
      expect(nextId).toBe(101);
    });

    it('should reject negative values', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      await expect(counter.setCounter(-1)).rejects.toThrow('non-negative');
    });

    it('should reject values exceeding MAX_SAFE_INTEGER', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      await expect(counter.setCounter(MAX_SAFE_PLAN_ID + 1)).rejects.toThrow(
        'cannot exceed'
      );
    });
  });

  describe('setMigrationComplete', () => {
    it('should mark migration as complete with timestamp', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      expect(counter.isMigrationComplete()).toBe(false);

      await counter.setMigrationComplete();

      expect(counter.isMigrationComplete()).toBe(true);
    });

    it('should persist migration state', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();
      await counter.setMigrationComplete('2026-03-26T12:00:00Z');

      // Create new instance
      const counter2 = new PlanIdCounter({ counterPath });
      await counter2.initialize();

      expect(counter2.isMigrationComplete()).toBe(true);
    });
  });

  describe('writeMigrationLog', () => {
    it('should write migration log to file', async () => {
      const counter = new PlanIdCounter({ counterPath, migrationLogPath });
      await counter.initialize();

      const mappings = [
        { oldUuid: 'uuid-1', newId: 1, planName: 'Plan A' },
        { oldUuid: 'uuid-2', newId: 2, planName: 'Plan B' },
      ];

      const logPath = await counter.writeMigrationLog(mappings);

      expect(logPath).toBe(migrationLogPath);

      // Verify log content
      const content = await readFile(migrationLogPath, 'utf-8');
      const log = JSON.parse(content);

      expect(log.version).toBe('1.0');
      expect(log.mappings).toHaveLength(2);
      expect(log.mappings[0]).toEqual(mappings[0]);
    });
  });

  describe('createPlanIdCounter factory', () => {
    it('should create a PlanIdCounter instance', () => {
      const counter = createPlanIdCounter({ counterPath });

      expect(counter).toBeInstanceOf(PlanIdCounter);
    });

    it('should create instance with default config', () => {
      const counter = createPlanIdCounter();

      expect(counter).toBeInstanceOf(PlanIdCounter);
    });
  });

  describe('persistence', () => {
    it('should persist state to file atomically', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      await counter.getNextId();
      await counter.getNextId();
      await counter.getNextId();

      // Read the file directly
      const content = await readFile(counterPath, 'utf-8');
      const state = JSON.parse(content);

      expect(state.lastAssignedId).toBe(3);
    });

    it('should handle concurrent ID requests', async () => {
      const counter = new PlanIdCounter({ counterPath });
      await counter.initialize();

      // Simulate concurrent requests
      const promises = [
        counter.getNextId(),
        counter.getNextId(),
        counter.getNextId(),
      ];

      const ids = await Promise.all(promises);

      // All IDs should be unique
      expect(new Set(ids).size).toBe(3);

      // Counter should be at 3
      expect(counter.getLastAssignedId()).toBe(3);
    });
  });
});