/**
 * Usage report command handler for CPG CLI.
 */

import { exit } from 'process';
import { createApiKeyManager } from '@/services/api-key-manager';
import { createUsageTracker } from '@/services/usage-tracker';
import { createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { createPlanRepository } from '@/services/plan-repository';
import { CLI_EXIT_CODES, type CliContext, type CliError, type EnrichedUsageReport, type UsageTotals, type PlanUsageReportDisplay } from '@/types/cli';
import { loadAuthConfig } from '@/config/auth-config';
import { loadPlanUsageConfig } from '@/config/defaults';

/**
 * Create a CLI error with context.
 */
function createCliError(
  type: CliError['type'],
  message: string,
  exitCode: number,
  suggestion?: string
): CliError {
  return { type, message, exitCode, suggestion };
}

/**
 * Handle usage-report command.
 */
export async function handleUsageReportCommand(context: CliContext): Promise<void> {
  const { args, formatter } = context;

  // Handle help flag
  if (context.args.options.help || context.args.options.h) {
    console.log(formatter.formatHelp('usage-report'));
    return;
  }

  // Check if plan usage report is requested
  const planId = args.options.plan as string | undefined;

  if (planId) {
    // Parse planId to number
    const planIdNum = Number(planId);
    if (isNaN(planIdNum) || planIdNum <= 0) {
      console.error(formatter.formatError(
        createCliError('validation', '--plan must be a valid positive number', CLI_EXIT_CODES.GENERAL_ERROR)
      ));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
    return handlePlanUsageReport(context, planIdNum);
  }

  // Original API key usage report
  return handleApiKeyUsageReport(context);
}

/**
 * Handle API key usage report (original functionality).
 */
async function handleApiKeyUsageReport(context: CliContext): Promise<void> {
  const { args, formatter } = context;

  // Parse filter arguments
  const keyId = args.options['key-id'] as string | undefined;
  const from = args.options.from as string | undefined;
  const to = args.options.to as string | undefined;

  // Validate date format if provided
  const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !dateFormatRegex.test(from)) {
    console.error(formatter.formatError(
      createCliError('validation', `Invalid --from date format: ${from}`, CLI_EXIT_CODES.GENERAL_ERROR, 'Expected format: YYYY-MM-DD')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
  if (to && !dateFormatRegex.test(to)) {
    console.error(formatter.formatError(
      createCliError('validation', `Invalid --to date format: ${to}`, CLI_EXIT_CODES.GENERAL_ERROR, 'Expected format: YYYY-MM-DD')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Create and initialize managers with config from environment
  const authConfig = loadAuthConfig();
  const manager = createApiKeyManager({ apiKeysPath: authConfig.apiKeysPath });
  const tracker = createUsageTracker({ usageDataPath: authConfig.usageDataPath });

  try {
    await manager.initialize();
    await tracker.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to initialize: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }

  // Get usage report
  const reports = tracker.getUsageReport({ keyId, from, to });

  // Enrich reports with key names
  const enrichedReports: EnrichedUsageReport[] = reports.map((report) => {
    const key = manager.getKeyById(report.keyId);
    return {
      ...report,
      keyName: key?.name ?? 'Unknown Key',
    };
  });

  // Calculate totals
  const totals: UsageTotals = {
    totalRequests: enrichedReports.reduce((sum, r) => sum + r.totalRequests, 0),
    totalInputTokens: enrichedReports.reduce((sum, r) => sum + r.totalInputTokens, 0),
    totalOutputTokens: enrichedReports.reduce((sum, r) => sum + r.totalOutputTokens, 0),
    totalTokens: enrichedReports.reduce((sum, r) => sum + r.totalTokens, 0),
  };

  // Output report
  console.log(formatter.formatUsageReport(enrichedReports, totals));
}

/**
 * Handle plan usage report (new functionality).
 */
async function handlePlanUsageReport(context: CliContext, planId: number): Promise<void> {
  const { args, formatter } = context;

  // Parse filter arguments
  const from = args.options.from as string | undefined;
  const to = args.options.to as string | undefined;

  // Validate date format if provided
  const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !dateFormatRegex.test(from)) {
    console.error(formatter.formatError(
      createCliError('validation', `Invalid --from date format: ${from}`, CLI_EXIT_CODES.GENERAL_ERROR, 'Expected format: YYYY-MM-DD')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
  if (to && !dateFormatRegex.test(to)) {
    console.error(formatter.formatError(
      createCliError('validation', `Invalid --to date format: ${to}`, CLI_EXIT_CODES.GENERAL_ERROR, 'Expected format: YYYY-MM-DD')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Load plans and tracker
  const configPath = process.env.CONFIG_PATH || './config.yaml';
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const planUsageConfig = loadPlanUsageConfig();

  const repository = createPlanRepository(configPath, encryptionKey);
  const tracker = createPlanUsageTracker({ planUsageDataPath: planUsageConfig.planUsageDataPath });

  try {
    await repository.reload();
    await tracker.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to initialize: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }

  // Find the plan
  const plan = await repository.findById(planId);
  if (!plan) {
    console.error(formatter.formatError(
      createCliError('not_found', `Plan not found: ${planId}`, CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Get usage report
  const report = tracker.getUsageReport(
    planId,
    {
      id: plan.id,
      name: plan.name,
      quota: plan.quota,
    },
    from,
    to
  );

  if (!report) {
    console.log(formatter.formatPlanUsageReport({
      planId,
      planName: plan.name,
      totalRequests: 0,
      limit: plan.quota.limit,
      remaining: plan.quota.limit,
      percentage: 0,
      dateRange: {
        start: from || new Date().toISOString().split('T')[0]!,
        end: to || new Date().toISOString().split('T')[0]!,
      },
      dailyBreakdown: [],
      quotaPeriod: plan.quota.period,
      resetAt: null,
    }));
    return;
  }

  // Format and output
  const displayReport: PlanUsageReportDisplay = {
    planId,
    planName: report.planName,
    totalRequests: report.totalRequests,
    limit: report.limit,
    remaining: report.remaining,
    percentage: report.percentage,
    dateRange: report.dateRange,
    dailyBreakdown: report.dailyBreakdown,
    quotaPeriod: report.quotaPeriod,
    resetAt: report.resetAt,
  };

  console.log(formatter.formatPlanUsageReport(displayReport));
}