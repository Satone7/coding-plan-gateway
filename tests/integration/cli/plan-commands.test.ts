/**
 * Integration tests for plan CLI commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TableFormatter } from '@/cli/output/table';
import { JsonFormatter } from '@/cli/output/json';

describe('Plan CLI Commands', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plan-cli-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Output formatters', () => {
    it('should format plan usage report in table format', () => {
      const formatter = new TableFormatter();

      const output = formatter.formatPlanUsageReport({
        planId: 'test-plan-id',
        planName: 'Test Plan',
        totalRequests: 42,
        limit: 100,
        remaining: 58,
        percentage: 42,
        dateRange: { start: '2026-03-01', end: '2026-03-25' },
        dailyBreakdown: [
          { date: '2026-03-25', requestCount: 10 },
          { date: '2026-03-24', requestCount: 15 },
        ],
        quotaPeriod: 'monthly',
        resetAt: new Date('2026-04-01T00:00:00Z'),
      });

      expect(output).toContain('Test Plan');
      expect(output).toContain('42');
      expect(output).toContain('100');
      expect(output).toContain('58');
      expect(output).toContain('42%');
    });

    it('should format plan list in table format', () => {
      const formatter = new TableFormatter();

      const output = formatter.formatPlanList([
        {
          planId: 'plan-1',
          planName: 'Plan One',
          limit: 100,
          used: 50,
          remaining: 50,
          percentage: 50,
          quotaPeriod: 'monthly',
          resetAt: null,
        },
        {
          planId: 'plan-2',
          planName: 'Plan Two',
          limit: 500,
          used: 150,
          remaining: 350,
          percentage: 30,
          quotaPeriod: 'daily',
          resetAt: new Date('2026-03-26T00:00:00Z'),
        },
      ]);

      expect(output).toContain('Plan One');
      expect(output).toContain('Plan Two');
      expect(output).toContain('monthly');
      expect(output).toContain('daily');
    });

    it('should format plan usage adjustment in table format', () => {
      const formatter = new TableFormatter();

      const output = formatter.formatPlanUsageAdjustment({
        adjustmentId: 'adj-123',
        planId: 'plan-1',
        planName: 'Test Plan',
        oldValue: 50,
        newValue: 75,
        warning: 'Usage exceeds quota limit',
      });

      expect(output).toContain('Test Plan');
      expect(output).toContain('50');
      expect(output).toContain('75');
      expect(output).toContain('Warning');
    });

    it('should format plan usage report in JSON format', () => {
      const formatter = new JsonFormatter();

      const output = formatter.formatPlanUsageReport({
        planId: 'test-plan-id',
        planName: 'Test Plan',
        totalRequests: 42,
        limit: 100,
        remaining: 58,
        percentage: 42,
        dateRange: { start: '2026-03-01', end: '2026-03-25' },
        dailyBreakdown: [],
        quotaPeriod: 'monthly',
        resetAt: null,
      });

      const parsed = JSON.parse(output);
      expect(parsed.planId).toBe('test-plan-id');
      expect(parsed.planName).toBe('Test Plan');
      expect(parsed.totalRequests).toBe(42);
    });

    it('should format plan list in JSON format', () => {
      const formatter = new JsonFormatter();

      const output = formatter.formatPlanList([
        {
          planId: 'plan-1',
          planName: 'Plan One',
          limit: 100,
          used: 50,
          remaining: 50,
          percentage: 50,
          quotaPeriod: 'monthly',
          resetAt: null,
        },
      ]);

      const parsed = JSON.parse(output);
      expect(parsed.plans).toHaveLength(1);
      expect(parsed.plans[0].planName).toBe('Plan One');
    });

    it('should format plan usage adjustment in JSON format', () => {
      const formatter = new JsonFormatter();

      const output = formatter.formatPlanUsageAdjustment({
        adjustmentId: 'adj-123',
        planId: 'plan-1',
        planName: 'Test Plan',
        oldValue: 50,
        newValue: 75,
      });

      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.adjustment.oldValue).toBe(50);
      expect(parsed.adjustment.newValue).toBe(75);
    });

    it('should include warning in JSON adjustment output', () => {
      const formatter = new JsonFormatter();

      const output = formatter.formatPlanUsageAdjustment({
        adjustmentId: 'adj-123',
        planId: 'plan-1',
        planName: 'Test Plan',
        oldValue: 50,
        newValue: 150,
        warning: 'Usage exceeds quota limit of 100',
      });

      const parsed = JSON.parse(output);
      expect(parsed.warning).toBe('Usage exceeds quota limit of 100');
    });
  });

  describe('Help text', () => {
    it('should include plan command in main help', () => {
      const formatter = new TableFormatter();
      const help = formatter.formatHelp();

      expect(help).toContain('plan');
      expect(help).toContain('Manage plans');
    });

    it('should show plan subcommand help', () => {
      const formatter = new TableFormatter();
      const help = formatter.formatHelp('plan');

      expect(help).toContain('list');
      expect(help).toContain('set-usage');
    });

    it('should show usage-report help with --plan option', () => {
      const formatter = new TableFormatter();
      const help = formatter.formatHelp('usage-report');

      expect(help).toContain('--plan');
    });
  });
});