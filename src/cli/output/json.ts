/**
 * JSON output formatter for CLI.
 * Provides machine-readable JSON output for automation and scripting.
 */

import type { ApiKey } from '@/types/api-key';
import type { UsageReport } from '@/types/usage';
import type {
  OutputFormatter,
  TestKeyResult,
  CliError,
  EnrichedUsageReport,
  UsageTotals,
  PlanUsageReportDisplay,
  PlanUsageSummaryDisplay,
  AdjustmentResultDisplay,
} from '@/types/cli';
import type { CreateKeyResult } from '@/services/api-key-manager';

/**
 * JSON output formatter implementation.
 */
export class JsonFormatter implements OutputFormatter {
  formatKeyCreate(result: CreateKeyResult): string {
    const { plaintextKey, key } = result;
    return JSON.stringify(
      {
        success: true,
        key: {
          id: key.id,
          name: key.name,
          plaintextKey,
          prefix: key.prefix,
          status: key.status,
          createdAt: key.createdAt.toISOString(),
          expiresAt: key.expiresAt?.toISOString() ?? null,
        },
      },
      null,
      2
    );
  }

  formatKeyList(keys: ApiKey[]): string {
    return JSON.stringify(
      {
        keys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          status: key.status,
          createdAt: key.createdAt.toISOString(),
          expiresAt: key.expiresAt?.toISOString() ?? null,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        })),
        total: keys.length,
      },
      null,
      2
    );
  }

  formatKeyTest(result: TestKeyResult): string {
    const output: Record<string, unknown> = {
      prefix: result.prefix,
      status: result.status,
    };

    if (result.key) {
      output.key = {
        id: result.key.id,
        name: result.key.name,
        status: result.key.status,
        createdAt: result.key.createdAt.toISOString(),
        expiresAt: result.key.expiresAt?.toISOString() ?? null,
      };
    }

    if (result.error) {
      output.error = result.error;
    }

    return JSON.stringify(output, null, 2);
  }

  formatKeyStatusChange(key: ApiKey, action: 'enabled' | 'disabled'): string {
    return JSON.stringify(
      {
        success: true,
        action,
        key: {
          id: key.id,
          name: key.name,
          status: key.status,
        },
      },
      null,
      2
    );
  }

  formatKeyDelete(key: ApiKey): string {
    return JSON.stringify(
      {
        success: true,
        deleted: {
          id: key.id,
          name: key.name,
        },
      },
      null,
      2
    );
  }

  formatUsageReport(reports: EnrichedUsageReport[], totals: UsageTotals): string {
    return JSON.stringify(
      {
        reports: reports.map((report) => ({
          keyId: report.keyId,
          keyName: report.keyName,
          totalRequests: report.totalRequests,
          totalInputTokens: report.totalInputTokens,
          totalOutputTokens: report.totalOutputTokens,
          totalTokens: report.totalTokens,
          dateRange: report.dateRange,
          dailyBreakdown: report.dailyBreakdown,
        })),
        totals: {
          totalRequests: totals.totalRequests,
          totalInputTokens: totals.totalInputTokens,
          totalOutputTokens: totals.totalOutputTokens,
          totalTokens: totals.totalTokens,
        },
      },
      null,
      2
    );
  }

  formatError(error: CliError): string {
    return JSON.stringify(
      {
        success: false,
        error: {
          type: error.type,
          message: error.message,
          suggestion: error.suggestion,
          exitCode: error.exitCode,
        },
      },
      null,
      2
    );
  }

  formatHelp(command?: string): string {
    // For JSON output, return a structured help object
    const helpData: Record<string, unknown> = {
      name: 'cpg',
      version: '1.0.0',
      description: 'Coding Plan Gateway Command Line Interface',
    };

    if (command === 'key') {
      helpData.commands = [
        { name: 'create', description: 'Create a new API key', options: ['--name', '--expires', '--json'] },
        { name: 'list', description: 'List all API keys', options: ['--json'] },
        { name: 'test', description: 'Test if an API key is valid', options: ['--json'] },
        { name: 'disable', description: 'Disable an API key', options: ['--id', '--json'] },
        { name: 'enable', description: 'Enable a disabled API key', options: ['--id', '--json'] },
        { name: 'delete', description: 'Delete an API key', options: ['--id', '--json'] },
      ];
    } else if (command === 'usage-report') {
      helpData.commands = [
        { name: 'usage-report', description: 'View usage reports', options: ['--key-id', '--plan', '--from', '--to', '--json'] },
      ];
    } else if (command === 'plan') {
      helpData.commands = [
        { name: 'list', description: 'List all plans with usage summary', options: ['--json'] },
        { name: 'set-usage', description: 'Manually set usage for a plan', options: ['--id', '--count', '--percent', '--json'] },
      ];
    } else {
      helpData.commands = [
        { name: 'dashboard', description: 'Launch the real-time TUI dashboard' },
        { name: 'key', description: 'Manage API keys' },
        { name: 'usage-report', description: 'View usage reports' },
        { name: 'plan', description: 'Manage plans and view plan usage' },
      ];
      helpData.globalOptions = ['--help', '--version', '--json', '--gateway-url'];
    }

    return JSON.stringify(helpData, null, 2);
  }

  formatVersion(version: string): string {
    return JSON.stringify({ version }, null, 2);
  }

  formatPlanUsageReport(report: PlanUsageReportDisplay): string {
    return JSON.stringify(
      {
        planId: report.planId,
        planName: report.planName,
        totalRequests: report.totalRequests,
        limit: report.limit,
        remaining: report.remaining,
        percentage: report.percentage,
        dateRange: report.dateRange,
        dailyBreakdown: report.dailyBreakdown,
        quotaPeriod: report.quotaPeriod,
        resetAt: report.resetAt?.toISOString() ?? null,
      },
      null,
      2
    );
  }

  formatPlanList(plans: PlanUsageSummaryDisplay[]): string {
    return JSON.stringify(
      {
        plans: plans.map((plan) => ({
          planId: plan.planId,
          planName: plan.planName,
          limit: plan.limit,
          used: plan.used,
          remaining: plan.remaining,
          percentage: plan.percentage,
          quotaPeriod: plan.quotaPeriod,
          resetAt: plan.resetAt?.toISOString() ?? null,
        })),
        total: plans.length,
      },
      null,
      2
    );
  }

  formatPlanUsageAdjustment(result: AdjustmentResultDisplay): string {
    const output: Record<string, unknown> = {
      success: true,
      adjustment: {
        id: result.adjustmentId,
        planId: result.planId,
        planName: result.planName,
        oldValue: result.oldValue,
        newValue: result.newValue,
      },
    };

    if (result.warning) {
      output.warning = result.warning;
    }

    if (result.syncStatus) {
      output.sync = {
        status: result.syncStatus,
        gatewaySynced: result.syncStatus === 'synced',
      };
    }

    return JSON.stringify(output, null, 2);
  }
}

/**
 * Create a new JSON formatter instance.
 */
export function createJsonFormatter(): JsonFormatter {
  return new JsonFormatter();
}