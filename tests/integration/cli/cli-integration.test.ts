/**
 * Integration tests for CPG CLI.
 * Tests the CLI command flow end-to-end with mocked services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCliArgs, createCliContext, isHelpRequested, isVersionRequested, getGatewayUrl } from '@/cli/context';
import { TableFormatter } from '@/cli/output/table';
import { JsonFormatter } from '@/cli/output/json';

// Mock the ApiKeyManager
vi.mock('@/services/api-key-manager', () => ({
  createApiKeyManager: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllKeys: vi.fn().mockReturnValue([]),
    getKeyById: vi.fn().mockReturnValue(undefined),
    createKey: vi.fn().mockResolvedValue({
      plaintextKey: 'cpg_test1234567890abcdef',
      key: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_test',
        status: 'active',
        createdAt: new Date(),
      },
    }),
    validateKeyWithStatus: vi.fn().mockResolvedValue({
      valid: false,
      status: 'invalid',
    }),
    updateKeyStatus: vi.fn().mockResolvedValue(true),
    deleteKey: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock the UsageTracker
vi.mock('@/services/usage-tracker', () => ({
  createUsageTracker: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getUsageReport: vi.fn().mockReturnValue([]),
  })),
}));

describe('CLI Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('parseCliArgs', () => {
    it('should parse simple command', () => {
      const result = parseCliArgs(['key', 'list']);

      expect(result.command).toBe('key');
      expect(result.subcommand).toBe('list');
    });

    it('should parse command with options', () => {
      const result = parseCliArgs(['key', 'create', '--name', 'My Key']);

      expect(result.command).toBe('key');
      expect(result.subcommand).toBe('create');
      expect(result.options.name).toBe('My Key');
    });

    it('should parse --key=value format', () => {
      const result = parseCliArgs(['key', 'create', '--name=MyKey']);

      expect(result.options.name).toBe('MyKey');
    });

    it('should parse boolean flags', () => {
      const result = parseCliArgs(['key', 'list', '--json']);

      expect(result.options.json).toBe(true);
    });

    it('should parse short flags', () => {
      const result = parseCliArgs(['-h']);

      expect(result.options.h).toBe(true);
    });

    it('should parse positional arguments', () => {
      const result = parseCliArgs(['key', 'test', 'cpg_xxxx']);

      expect(result.command).toBe('key');
      expect(result.subcommand).toBe('test');
      expect(result.positional).toContain('cpg_xxxx');
    });
  });

  describe('createCliContext', () => {
    it('should create context with table formatter by default', () => {
      const args = parseCliArgs(['key', 'list']);
      const context = createCliContext(args);

      expect(context.formatter).toBeInstanceOf(TableFormatter);
      expect(context.jsonOutput).toBe(false);
    });

    it('should create context with JSON formatter when --json flag', () => {
      const args = parseCliArgs(['key', 'list', '--json']);
      const context = createCliContext(args);

      expect(context.formatter).toBeInstanceOf(JsonFormatter);
      expect(context.jsonOutput).toBe(true);
    });

    it('should use default gateway URL', () => {
      const args = parseCliArgs(['key', 'list']);
      const context = createCliContext(args);

      expect(context.gatewayUrl).toBe('http://localhost:8080');
    });

    it('should use environment variable for gateway URL', () => {
      process.env.GATEWAY_URL = 'http://custom:9000';
      const args = parseCliArgs(['key', 'list']);
      const context = createCliContext(args);

      expect(context.gatewayUrl).toBe('http://custom:9000');
    });

    it('should use CLI argument for gateway URL', () => {
      const args = parseCliArgs(['key', 'list', '--gateway-url', 'http://cli:8000']);
      const context = createCliContext(args);

      expect(context.gatewayUrl).toBe('http://cli:8000');
    });
  });

  describe('isHelpRequested', () => {
    it('should return true for --help', () => {
      const args = parseCliArgs(['--help']);
      expect(isHelpRequested(args.options)).toBe(true);
    });

    it('should return true for -h', () => {
      const args = parseCliArgs(['-h']);
      expect(isHelpRequested(args.options)).toBe(true);
    });

    it('should return false when no help flag', () => {
      const args = parseCliArgs(['key', 'list']);
      expect(isHelpRequested(args.options)).toBe(false);
    });
  });

  describe('isVersionRequested', () => {
    it('should return true for --version', () => {
      const args = parseCliArgs(['--version']);
      expect(isVersionRequested(args.options)).toBe(true);
    });

    it('should return true for -v', () => {
      const args = parseCliArgs(['-v']);
      expect(isVersionRequested(args.options)).toBe(true);
    });

    it('should return false when no version flag', () => {
      const args = parseCliArgs(['key', 'list']);
      expect(isVersionRequested(args.options)).toBe(false);
    });
  });

  describe('getGatewayUrl', () => {
    it('should return default URL', () => {
      const url = getGatewayUrl({});
      expect(url).toBe('http://localhost:8080');
    });

    it('should return URL from options', () => {
      const url = getGatewayUrl({ 'gateway-url': 'http://option:7000' });
      expect(url).toBe('http://option:7000');
    });

    it('should return URL from environment', () => {
      process.env.GATEWAY_URL = 'http://env:6000';
      const url = getGatewayUrl({});
      expect(url).toBe('http://env:6000');
    });

    it('should prioritize option over environment', () => {
      process.env.GATEWAY_URL = 'http://env:6000';
      const url = getGatewayUrl({ 'gateway-url': 'http://option:7000' });
      expect(url).toBe('http://option:7000');
    });
  });
});