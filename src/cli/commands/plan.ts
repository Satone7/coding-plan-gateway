/**
 * Plan command handlers for CPG CLI.
 */

import { exit } from 'process';
import { createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { createPlanRepository } from '@/services/plan-repository';
import {
  CLI_EXIT_CODES,
  type CliContext,
  type CliError,
  type PlanUsageSummaryDisplay,
  type AdjustmentResultDisplay,
} from '@/types/cli';

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
 * Validate date format.
 */
function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

/**
 * Handle plan list subcommand.
 */
export async function handlePlanListCommand(context: CliContext): Promise<void> {
  const { formatter } = context;

  // Load plans from repository
  const configPath = process.env.CONFIG_PATH || './config.yaml';
  const encryptionKey = process.env.ENCRYPTION_KEY;

  const repository = createPlanRepository(configPath, encryptionKey);
  const tracker = createPlanUsageTracker();

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

  const plans = await repository.findAll();

  if (plans.length === 0) {
    console.log(formatter.formatPlanList([]));
    return;
  }

  // Build plan usage summaries
  const summaries: PlanUsageSummaryDisplay[] = plans.map((plan) => {
    const usage = tracker.getTotalUsage(plan.id);
    const remaining = plan.quota.limit - usage;
    const percentage = plan.quota.limit > 0 ? Math.round((usage / plan.quota.limit) * 100) : 0;

    // Calculate reset date
    let resetAt: Date | null = null;
    if (plan.quota.period === 'daily') {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      resetAt = tomorrow;
    } else if (plan.quota.period === 'monthly') {
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      nextMonth.setUTCDate(1);
      nextMonth.setUTCHours(0, 0, 0, 0);
      resetAt = nextMonth;
    }

    return {
      planId: plan.id,
      planName: plan.name,
      limit: plan.quota.limit,
      used: usage,
      remaining,
      percentage,
      quotaPeriod: plan.quota.period,
      resetAt,
    };
  });

  console.log(formatter.formatPlanList(summaries));
}

/**
 * Handle plan set-usage subcommand.
 */
export async function handlePlanSetUsageCommand(context: CliContext): Promise<void> {
  const { args, formatter } = context;

  const planId = args.options.id as string | undefined;
  const count = args.options.count !== undefined ? Number(args.options.count) : undefined;
  const percent = args.options.percent !== undefined ? Number(args.options.percent) : undefined;

  // Validate required arguments
  if (!planId) {
    console.error(formatter.formatError(
      createCliError('validation', '--id is required', CLI_EXIT_CODES.GENERAL_ERROR, 'Use: cpg plan set-usage --id <plan-id> --count <value>')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Validate mutually exclusive flags
  if (count !== undefined && percent !== undefined) {
    console.error(formatter.formatError(
      createCliError('validation', '--count and --percent are mutually exclusive', CLI_EXIT_CODES.GENERAL_ERROR, 'Use only one of --count or --percent')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  if (count === undefined && percent === undefined) {
    console.error(formatter.formatError(
      createCliError('validation', 'Either --count or --percent is required', CLI_EXIT_CODES.GENERAL_ERROR, 'Use: cpg plan set-usage --id <plan-id> --count <value>')
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Validate values
  if (count !== undefined && count < 0) {
    console.error(formatter.formatError(
      createCliError('validation', '--count must be non-negative', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  if (percent !== undefined && (percent < 0 || percent > 100)) {
    console.error(formatter.formatError(
      createCliError('validation', '--percent must be between 0 and 100', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Load plans and tracker
  const configPath = process.env.CONFIG_PATH || './config.yaml';
  const encryptionKey = process.env.ENCRYPTION_KEY;

  const repository = createPlanRepository(configPath, encryptionKey);
  const tracker = createPlanUsageTracker();

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

  // Calculate new value
  let newValue: number;
  let adjustmentType: 'count' | 'percent';
  let adjustmentValue: number;

  if (count !== undefined) {
    newValue = count;
    adjustmentType = 'count';
    adjustmentValue = count;
  } else {
    // percent case
    newValue = Math.round((percent! / 100) * plan.quota.limit);
    adjustmentType = 'percent';
    adjustmentValue = percent!;
  }

  // Perform adjustment
  const result = tracker.adjustUsage(planId, newValue, plan.quota.limit, adjustmentType, adjustmentValue);

  // Persist changes
  await tracker.persist();

  // Display result
  const displayResult: AdjustmentResultDisplay = {
    adjustmentId: result.adjustmentId,
    planId: result.planId,
    planName: plan.name,
    oldValue: result.oldValue,
    newValue: result.newValue,
    warning: result.warning,
  };

  console.log(formatter.formatPlanUsageAdjustment(displayResult));
}

/**
 * Handle plan command routing.
 */
export async function handlePlanCommand(context: CliContext, subcommand?: string): Promise<void> {
  // Handle help flag
  if (context.args.options.help || context.args.options.h) {
    console.log(context.formatter.formatHelp('plan'));
    return;
  }

  switch (subcommand) {
    case 'list':
      await handlePlanListCommand(context);
      break;

    case 'set-usage':
      await handlePlanSetUsageCommand(context);
      break;

    case undefined:
      console.error('Error: No subcommand specified for plan command');
      console.log(context.formatter.formatHelp('plan'));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);

    default:
      console.error(`Error: Unknown plan subcommand '${subcommand}'`);
      console.log(context.formatter.formatHelp('plan'));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
}