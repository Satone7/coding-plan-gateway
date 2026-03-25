/**
 * Unit tests for JSON formatter.
 */

import { describe, it, expect } from 'vitest';
import { JsonFormatter } from '@/cli/output/json';
import type { ApiKey } from '@/types/api-key';
import type { CreateKeyResult } from '@/services/api-key-manager';
import type { TestKeyResult, EnrichedUsageReport, UsageTotals } from '@/types/cli';

describe('JsonFormatter', () => {
  const formatter = new JsonFormatter();

  describe('formatKeyCreate', () => {
    it('should output valid JSON for key creation', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.key.name).toBe('Test Key');
      expect(parsed.key.plaintextKey).toBe('cpg_1234567890abcdef');
      expect(parsed.key.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('formatKeyList', () => {
    it('should output valid JSON for empty key list', () => {
      const output = formatter.formatKeyList([]);
      const parsed = JSON.parse(output);

      expect(parsed.keys).toEqual([]);
      expect(parsed.total).toBe(0);
    });

    it('should output valid JSON for key list', () => {
      const keys: ApiKey[] = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Production Key',
          keyHash: 'hashed',
          prefix: 'cpg_1234',
          status: 'active',
          createdAt: new Date('2026-03-25T10:30:00.000Z'),
        },
      ];

      const output = formatter.formatKeyList(keys);
      const parsed = JSON.parse(output);

      expect(parsed.keys).toHaveLength(1);
      expect(parsed.keys[0].name).toBe('Production Key');
      expect(parsed.total).toBe(1);
    });
  });

  describe('formatKeyTest', () => {
    it('should output valid JSON for valid key test', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.status).toBe('valid');
      expect(parsed.prefix).toBe('cpg_1234');
      expect(parsed.key.name).toBe('Test Key');
    });

    it('should output valid JSON for invalid key test', () => {
      const result: TestKeyResult = {
        prefix: 'cpg_1234',
        status: 'invalid',
        error: 'Key not found',
      };

      const output = formatter.formatKeyTest(result);
      const parsed = JSON.parse(output);

      expect(parsed.status).toBe('invalid');
      expect(parsed.error).toBe('Key not found');
      expect(parsed.key).toBeUndefined();
    });
  });

  describe('formatKeyStatusChange', () => {
    it('should output valid JSON for enabled action', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyStatusChange(key, 'enabled');
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('enabled');
      expect(parsed.key.status).toBe('active');
    });

    it('should output valid JSON for disabled action', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'disabled',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyStatusChange(key, 'disabled');
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('disabled');
    });
  });

  describe('formatKeyDelete', () => {
    it('should output valid JSON for key deletion', () => {
      const key: ApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Deleted Key',
        keyHash: 'hashed',
        prefix: 'cpg_1234',
        status: 'active',
        createdAt: new Date('2026-03-25T10:30:00.000Z'),
      };

      const output = formatter.formatKeyDelete(key);
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.deleted.name).toBe('Deleted Key');
    });
  });

  describe('formatUsageReport', () => {
    it('should output valid JSON for usage report', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.reports).toHaveLength(1);
      expect(parsed.reports[0].keyName).toBe('Production Key');
      expect(parsed.totals.totalRequests).toBe(100);
    });
  });

  describe('formatError', () => {
    it('should output valid JSON for error', () => {
      const output = formatter.formatError({
        type: 'validation',
        message: 'Invalid argument',
        suggestion: 'Try --help',
        exitCode: 1,
      });
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toBe('Invalid argument');
      expect(parsed.error.type).toBe('validation');
    });
  });

  describe('formatHelp', () => {
    it('should output valid JSON for main help', () => {
      const output = formatter.formatHelp();
      const parsed = JSON.parse(output);

      expect(parsed.name).toBe('cpg');
      expect(parsed.commands).toBeDefined();
    });

    it('should output valid JSON for key help', () => {
      const output = formatter.formatHelp('key');
      const parsed = JSON.parse(output);

      expect(parsed.commands).toBeDefined();
      expect(parsed.commands.length).toBeGreaterThan(0);
    });
  });

  describe('formatVersion', () => {
    it('should output valid JSON for version', () => {
      const output = formatter.formatVersion('1.0.0');
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0.0');
    });
  });
});