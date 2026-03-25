/**
 * Unit tests for table formatter.
 */

import { describe, it, expect } from 'vitest';
import { TableFormatter } from '@/cli/output/table';
import type { ApiKey } from '@/types/api-key';
import type { CreateKeyResult } from '@/services/api-key-manager';
import type { TestKeyResult, EnrichedUsageReport, UsageTotals } from '@/types/cli';

describe('TableFormatter', () => {
  const formatter = new TableFormatter();

  describe('formatKeyCreate', () => {
    it('should format key creation with all fields', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
        expiresAt: new Date('2026-12-31T23:59:59.000Z'),
      };
      const result: CreateKeyResult = {
        plaintextKey: 'cpg_1234567890abcdef',
        key,
      };

      const output = formatter.formatKeyCreate(result);

      expect(output).toContain('API Key created successfully!');
      expect(output).toContain('Test Key');
      expect(output).toContain('cpg_1234567890abcdef');
      expect(output).toContain('2026-12-31');
      expect(output).toContain('IMPORTANT');
    });

    it('should format key creation without expiration', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };
      const result: CreateKeyResult = {
        plaintextKey: 'cpg_1234567890abcdef',
        key,
      };

      const output = formatter.formatKeyCreate(result);

      expect(output).toContain('API Key created successfully!');
      expect(output).not.toContain('Expires');
    });
  });

  describe('formatKeyList', () => {
    it('should format empty key list', () => {
      const output = formatter.formatKeyList([]);

      expect(output).toContain('No API keys found');
      expect(output).toContain('cpg key create');
    });

    it('should format key list with multiple keys', () => {
      const keys: ApiKey[] = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Production Key',
          keyHash: 'hashed',
          prefix: 'cpg_1234',
          status: 'active',
          createdAt: new Date('2026-03-25T10:30:00.000Z'),
        },
        {
          id: '660f9500-f39c-52e5-b827-557766551111',
          name: 'Test Key',
          keyHash: 'hashed',
          prefix: 'cpg_5678',
          status: 'disabled',
          createdAt: new Date('2026-03-20T10:30:00.000Z'),
        },
      ];

      const output = formatter.formatKeyList(keys);

      expect(output).toContain('API Keys:');
      expect(output).toContain('Production Key');
      expect(output).toContain('Test Key');
      expect(output).toContain('active');
      expect(output).toContain('disabled');
      expect(output).toContain('Total: 2 key(s)');
    });
  });

  describe('formatKeyTest', () => {
    it('should format valid key test result', () => {
      const result: TestKeyResult = {
        prefix: 'cpg_1234',
        status: 'valid',
        key: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Key',
          keyHash: 'hashed',
          prefix: 'cpg_1234',
          status: 'active',
          createdAt: new Date('2026-03-25T10:30:00.000Z'),
        },
      };

      const output = formatter.formatKeyTest(result);

      expect(output).toContain('Status: valid');
      expect(output).toContain('Test Key');
    });

    it('should format invalid key test result', () => {
      const result: TestKeyResult = {
        prefix: 'cpg_1234',
        status: 'invalid',
        error: 'Key not found or invalid',
      };

      const output = formatter.formatKeyTest(result);

      expect(output).toContain('Status: invalid');
      expect(output).toContain('Key not found or invalid');
    });

    it('should format disabled key test result', () => {
      const result: TestKeyResult = {
        prefix: 'cpg_1234',
        status: 'disabled',
        key: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Disabled Key',
          keyHash: 'hashed',
          prefix: 'cpg_1234',
          status: 'disabled',
          createdAt: new Date('2026-03-25T10:30:00.000Z'),
        },
      };

      const output = formatter.formatKeyTest(result);

      expect(output).toContain('Status: disabled');
    });

    it('should format expired key test result', () => {
      const result: TestKeyResult = {
        prefix: 'cpg_1234',
        status: 'expired',
        key: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Expired Key',
          keyHash: 'hashed',
          prefix: 'cpg_1234',
          status: 'active',
          createdAt: new Date('2025-01-01T10:30:00.000Z'),
          expiresAt: new Date('2025-12-31T23:59:59.000Z'),
        },
      };

      const output = formatter.formatKeyTest(result);

      expect(output).toContain('Status: expired');
    });
  });

  describe('formatKeyStatusChange', () => {
    it('should format key enabled', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyStatusChange(key, 'enabled');

      expect(output).toContain('enabled successfully');
      expect(output).toContain('Test Key');
      expect(output).toContain('active');
    });

    it('should format key disabled', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'disabled',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyStatusChange(key, 'disabled');

      expect(output).toContain('disabled successfully');
      expect(output).toContain('Test Key');
      expect(output).toContain('disabled');
    });
  });

  describe('formatKeyDelete', () => {
    it('should format key deletion', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Deleted Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyDelete(key);

      expect(output).toContain('deleted successfully');
      expect(output).toContain('Deleted Key');
    });
  });

  describe('formatError', () => {
    it('should format error with suggestion', () => {
      const output = formatter.formatError({
        type: 'validation',
        message: 'Invalid argument',
        suggestion: 'Try --help for usage',
        exitCode: 1,
      });

      expect(output).toContain('Error: Invalid argument');
      expect(output).toContain('Suggestion: Try --help for usage');
    });

    it('should format error without suggestion', () => {
      const output = formatter.formatError({
        type: 'storage',
        message: 'File not accessible',
        exitCode: 4,
      });

      expect(output).toContain('Error: File not accessible');
      expect(output).not.toContain('Suggestion');
    });
  });

  describe('formatHelp', () => {
    it('should format main help', () => {
      const output = formatter.formatHelp();

      expect(output).toContain('CPG CLI');
      expect(output).toContain('key');
      expect(output).toContain('usage-report');
    });

    it('should format key help', () => {
      const output = formatter.formatHelp('key');

      expect(output).toContain('Key Management');
      expect(output).toContain('create');
      expect(output).toContain('list');
      expect(output).toContain('test');
    });

    it('should format usage-report help', () => {
      const output = formatter.formatHelp('usage-report');

      expect(output).toContain('Usage Report');
      expect(output).toContain('--key-id');
      expect(output).toContain('--from');
      expect(output).toContain('--to');
    });
  });

  describe('formatVersion', () => {
    it('should format version', () => {
      const output = formatter.formatVersion('1.0.0');

      expect(output).toContain('cpg version 1.0.0');
    });
  });

  describe('formatUsageReport', () => {
    it('should format empty usage report', () => {
      const output = formatter.formatUsageReport([], { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0 });

      expect(output).toContain('No usage data found');
    });

    it('should format usage report with data', () => {
      const reports: EnrichedUsageReport[] = [
        {
          keyId: '550e8400-e29b-41d4-a716-446655440000',
          keyName: 'Production Key',
          totalRequests: 100,
          totalInputTokens: 5000,
          totalOutputTokens: 3000,
          totalTokens: 8000,
          dateRange: { start: '2026-03-01', end: '2026-03-25' },
          dailyBreakdown: [],
        },
      ];
      const totals: UsageTotals = {
        totalRequests: 100,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
        totalTokens: 8000,
      };

      const output = formatter.formatUsageReport(reports, totals);

      expect(output).toContain('Usage Report');
      expect(output).toContain('Production Key');
      expect(output).toContain('100');
      expect(output).toContain('8,000');
    });
  });
});