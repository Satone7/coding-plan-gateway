/**
 * Contract tests for API Key CLI commands.
 * Tests the CLI interface contract defined in contracts/api-key-api.yaml.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, readFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseArgs,
  handleCreate,
  handleList,
  handleDisable,
  handleEnable,
  handleDelete,
  handleReport,
} from '@/cli/api-key-cli';
import { createApiKeyManager } from '@/services/api-key-manager';
import { createUsageTracker } from '@/services/usage-tracker';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { UsageTracker } from '@/services/usage-tracker';
import type { ApiKeyStorage } from '@/types';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('CLI Argument Parsing', () => {
  it('should parse --key value format', () => {
    const args = ['--name', 'Test Key', '--id', 'some-uuid'];
    const result = parseArgs(args);

    expect(result.name).toBe('Test Key');
    expect(result.id).toBe('some-uuid');
  });

  it('should parse --key=value format', () => {
    const args = ['--name=Test Key', '--id=some-uuid'];
    const result = parseArgs(args);

    expect(result.name).toBe('Test Key');
    expect(result.id).toBe('some-uuid');
  });

  it('should handle mixed formats', () => {
    const args = ['--name', 'Test Key', '--id=some-uuid'];
    const result = parseArgs(args);

    expect(result.name).toBe('Test Key');
    expect(result.id).toBe('some-uuid');
  });

  it('should handle missing value for flag', () => {
    const args = ['--name'];
    const result = parseArgs(args);

    expect(result.name).toBeUndefined();
  });

  it('should handle empty args', () => {
    const args: string[] = [];
    const result = parseArgs(args);

    expect(result).toEqual({});
  });
});

describe('CLI Commands', () => {
  let manager: ApiKeyManager;
  let testDir: string;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(async () => {
    // Create temp directory for test
    testDir = join(tmpdir(), `cli-contract-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create manager with test path
    manager = createApiKeyManager({
      apiKeysPath: join(testDir, 'api-keys.json'),
    });
    await manager.initialize();

    // Mock process.exit to capture exit codes
    exitCode = undefined;
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(async () => {
    // Restore process.exit
    process.exit = originalExit;

    // Cleanup test directory
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('handleCreate', () => {
    it('should create a key with valid name', async () => {
      // Capture console output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleCreate(manager, { name: 'Test Key' });
      } finally {
        console.log = originalLog;
      }

      const keys = manager.getAllKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]!.name).toBe('Test Key');
      expect(keys[0]!.status).toBe('active');

      // Check output contains the key
      const output = logs.join('\n');
      expect(output).toContain('API Key created successfully');
      expect(output).toContain('cpg_');
    });

    it('should fail without name', async () => {
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await expect(handleCreate(manager, {})).rejects.toThrow('process.exit');
        expect(exitCode).toBe(1);
      } finally {
        console.error = originalError;
      }

      expect(logs.join('\n')).toContain('--name is required');
    });

    it('should create key with expiration date', async () => {
      await handleCreate(manager, { name: 'Expiring Key', expires: '2099-12-31' });

      const keys = manager.getAllKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]!.expiresAt).toBeDefined();
    });
  });

  describe('handleList', () => {
    it('should list all keys', async () => {
      // Create some keys
      await manager.createKey({ name: 'Key 1' });
      await manager.createKey({ name: 'Key 2' });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleList(manager, {});
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('Key 1');
      expect(output).toContain('Key 2');
      expect(output).toContain('Total: 2 key(s)');
    });

    it('should show message when no keys exist', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleList(manager, {});
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('No API keys found');
    });
  });

  describe('handleDisable', () => {
    it('should disable an active key', async () => {
      const { key } = await manager.createKey({ name: 'Test Key' });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleDisable(manager, { id: key.id });
      } finally {
        console.log = originalLog;
      }

      const updatedKey = manager.getKeyById(key.id);
      expect(updatedKey!.status).toBe('disabled');

      const output = logs.join('\n');
      expect(output).toContain('disabled successfully');
    });

    it('should fail without id', async () => {
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await expect(handleDisable(manager, {})).rejects.toThrow('process.exit');
        expect(exitCode).toBe(1);
      } finally {
        console.error = originalError;
      }

      expect(logs.join('\n')).toContain('--id is required');
    });

    it('should fail with non-existent id', async () => {
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await expect(handleDisable(manager, { id: 'non-existent-uuid' })).rejects.toThrow(
          'process.exit'
        );
        expect(exitCode).toBe(1);
      } finally {
        console.error = originalError;
      }

      expect(logs.join('\n')).toContain('not found');
    });
  });

  describe('handleEnable', () => {
    it('should enable a disabled key', async () => {
      const { key } = await manager.createKey({ name: 'Test Key' });
      await manager.updateKeyStatus(key.id, 'disabled');

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleEnable(manager, { id: key.id });
      } finally {
        console.log = originalLog;
      }

      const updatedKey = manager.getKeyById(key.id);
      expect(updatedKey!.status).toBe('active');

      const output = logs.join('\n');
      expect(output).toContain('enabled successfully');
    });

    it('should fail without id', async () => {
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await expect(handleEnable(manager, {})).rejects.toThrow('process.exit');
        expect(exitCode).toBe(1);
      } finally {
        console.error = originalError;
      }

      expect(logs.join('\n')).toContain('--id is required');
    });
  });

  describe('handleDelete', () => {
    it('should delete an existing key', async () => {
      const { key } = await manager.createKey({ name: 'Test Key' });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleDelete(manager, { id: key.id });
      } finally {
        console.log = originalLog;
      }

      expect(manager.getKeyById(key.id)).toBeUndefined();

      const output = logs.join('\n');
      expect(output).toContain('deleted successfully');
    });

    it('should fail without id', async () => {
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await expect(handleDelete(manager, {})).rejects.toThrow('process.exit');
        expect(exitCode).toBe(1);
      } finally {
        console.error = originalError;
      }

      expect(logs.join('\n')).toContain('--id is required');
    });
  });

  describe('handleReport', () => {
    let usageTracker: UsageTracker;

    beforeEach(async () => {
      const usageDataPath = join(testDir, 'usage-data.json');
      usageTracker = createUsageTracker({ usageDataPath });
      await usageTracker.initialize();
    });

    it('should show empty report when no usage data', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleReport(manager, {}, usageTracker);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('No usage data found');
    });

    it('should show usage report with data', async () => {
      // Create a key and add usage
      const { key } = await manager.createKey({ name: 'Test Key' });
      usageTracker.incrementRequestCount(key.id);
      usageTracker.recordTokenUsage(key.id, 100, 50);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleReport(manager, {}, usageTracker);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('Usage Report');
      expect(output).toContain('Test Key');
      expect(output).toContain('Summary by Key');
    });

    it('should filter by key ID', async () => {
      // Create two keys with usage
      const { key: key1 } = await manager.createKey({ name: 'Key 1' });
      const { key: key2 } = await manager.createKey({ name: 'Key 2' });
      usageTracker.incrementRequestCount(key1.id);
      usageTracker.incrementRequestCount(key2.id);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleReport(manager, { 'key-id': key1.id }, usageTracker);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('Key 1');
      expect(output).not.toContain('Key 2');
    });

    it('should filter by date range', async () => {
      const { key } = await manager.createKey({ name: 'Test Key' });
      usageTracker.incrementRequestCount(key.id);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        // Use a past date range that should return no data
        await handleReport(manager, { from: '2020-01-01', to: '2020-12-31' }, usageTracker);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('No usage data found');
    });

    it('should show daily breakdown', async () => {
      const { key } = await manager.createKey({ name: 'Test Key' });
      usageTracker.incrementRequestCount(key.id);
      usageTracker.recordTokenUsage(key.id, 100, 50);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await handleReport(manager, {}, usageTracker);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join('\n');
      expect(output).toContain('Daily Breakdown');
      expect(output).toContain('Input Tokens');
      expect(output).toContain('Output Tokens');
    });
  });
});