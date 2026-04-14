/**
 * CLI-specific types for the CPG CLI executable.
 */

import type { ApiKey } from './api-key';
import type { UsageReport } from './usage';
import type { QuotaPeriod } from './coding-plan';
import type { CreateKeyResult, ValidationStatus } from '@/services/api-key-manager';

/**
 * CLI command context passed to command handlers.
 */
export interface CliContext {
  /** Parsed command arguments */
  args: ParsedArgs;
  /** Output formatter to use */
  formatter: OutputFormatter;
  /** Gateway URL for notifications */
  gatewayUrl: string;
  /** Configuration path */
  configPath: string;
  /** Whether JSON output is requested */
  jsonOutput: boolean;
}

/**
 * Parsed command-line arguments.
 */
export interface ParsedArgs {
  /** Command name (e.g., 'key') */
  command: string;
  /** Subcommand name (e.g., 'create') */
  subcommand?: string;
  /** Named options (e.g., { name: 'My Key' }) */
  options: Record<string, string | boolean | undefined>;
  /** Positional arguments (e.g., key string for 'key test') */
  positional: string[];
}

/**
 * Output formatter interface.
 */
export interface OutputFormatter {
  /** Format key creation result */
  formatKeyCreate(result: CreateKeyResult): string;
  /** Format key list */
  formatKeyList(keys: ApiKey[]): string;
  /** Format key test result */
  formatKeyTest(result: TestKeyResult): string;
  /** Format key status change */
  formatKeyStatusChange(key: ApiKey, action: 'enabled' | 'disabled'): string;
  /** Format key deletion */
  formatKeyDelete(key: ApiKey): string;
  /** Format usage report */
  formatUsageReport(reports: EnrichedUsageReport[], totals: UsageTotals): string;
  /** Format plan usage report */
  formatPlanUsageReport(report: PlanUsageReportDisplay): string;
  /** Format plan list with usage */
  formatPlanList(plans: PlanUsageSummaryDisplay[]): string;
  /** Format usage adjustment result */
  formatPlanUsageAdjustment(result: AdjustmentResultDisplay): string;
  /** Format error message */
  formatError(error: CliError): string;
  /** Format help message */
  formatHelp(command?: string): string;
  /** Format version info */
  formatVersion(version: string): string;
}

/**
 * Plan usage report display format.
 */
export interface PlanUsageReportDisplay {
  planId: number;
  planName: string;
  totalRequests: number;
  limit: number;
  remaining: number;
  percentage: number;
  dateRange: {
    start: string;
    end: string;
  };
  dailyBreakdown: Array<{
    date: string;
    requestCount: number;
  }>;
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  resetAt: Date | null;
}

/**
 * Plan usage summary for list display.
 */
export interface PlanUsageSummaryDisplay {
  planId: number;
  planName: string;
  limit: number;
  used: number;
  remaining: number;
  percentage: number;
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  resetAt: Date | null;
  /** True if this plan's provider has a usage API */
  isUsageApi?: boolean;
  /** Cached percentage from usage API (0-100) */
  usageApiPercentage?: number;
  /** Quota windows from usage API */
  usageApiWindows?: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
  /** Whether cached data is stale (past TTL) */
  isCacheStale?: boolean;
}

/**
 * Adjustment result display format.
 */
export interface AdjustmentResultDisplay {
  adjustmentId: string;
  planId: number;
  planName: string;
  oldValue: number;
  newValue: number;
  warning?: string;
  /** Sync status with running gateway */
  syncStatus?: 'synced' | 'not_running' | 'failed';
}

/**
 * Result of key test command.
 */
export interface TestKeyResult {
  /** The key prefix for identification */
  prefix: string;
  /** Validation status */
  status: ValidationStatus;
  /** Key metadata if found */
  key?: ApiKey;
  /** Error message if invalid */
  error?: string;
}

/**
 * CLI error with context.
 */
export interface CliError {
  /** Error type */
  type: 'validation' | 'not_found' | 'storage' | 'network' | 'config' | 'unknown';
  /** Error message */
  message: string;
  /** Suggested fix */
  suggestion?: string;
  /** Exit code */
  exitCode: number;
}

/**
 * Enriched usage report with key names.
 */
export interface EnrichedUsageReport extends UsageReport {
  /** Key name for display */
  keyName: string;
}

/**
 * Usage totals for summary.
 */
export interface UsageTotals {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

/**
 * CLI exit codes.
 */
export const CLI_EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  NETWORK_ERROR: 3,
  STORAGE_ERROR: 4,
} as const;

/**
 * CLI environment variable names.
 */
export const CLI_ENV_VARS = {
  GATEWAY_URL: 'GATEWAY_URL',
  CONFIG_PATH: 'CONFIG_PATH',
  ENCRYPTION_KEY: 'ENCRYPTION_KEY',
} as const;

/**
 * Default gateway URL for notifications.
 */
export const DEFAULT_GATEWAY_URL = 'http://localhost:8080';

/**
 * CLI version (should match package.json version).
 */
export const CLI_VERSION = '1.0.0';