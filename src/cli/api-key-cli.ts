/**
 * API Key CLI Commands.
 * Provides command-line interface for managing API keys.
 */

import { createApiKeyManager, type ApiKeyManager } from '@/services/api-key-manager';
import { createUsageTracker, type UsageTracker } from '@/services/usage-tracker';

/**
 * CLI command handler interface.
 */
export interface CommandHandler {
  (manager: ApiKeyManager, args: Record<string, string | undefined>, usageTracker?: UsageTracker): Promise<void>;
}

/**
 * Parse command-line arguments into key-value pairs.
 * Handles formats: --key value, --key=value
 *
 * @param args - Command-line arguments (excluding node and script path)
 * @returns Parsed arguments as key-value pairs
 */
export function parseArgs(args: string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg?.startsWith('--')) {
      const equalIndex = arg.indexOf('=');
      if (equalIndex > 0) {
        // --key=value format
        const key = arg.slice(2, equalIndex);
        const value = arg.slice(equalIndex + 1);
        result[key] = value;
      } else {
        // --key value format
        const key = arg.slice(2);
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          result[key] = nextArg;
          i++; // Skip next arg as it's the value
        } else {
          result[key] = undefined;
        }
      }
    }
  }

  return result;
}

/**
 * Format a date for display.
 *
 * @param date - Date to format
 * @returns Formatted date string
 */
function formatDate(date: Date | undefined): string {
  if (!date) {
    return 'N/A';
  }
  return date.toISOString().split('T')[0] ?? 'N/A';
}

/**
 * Print help text for all commands.
 */
export function printHelp(): void {
  console.log(`
API Key Management CLI

Commands:
  create    Create a new API key
  list      List all API keys
  disable   Disable an API key
  enable    Enable an API key
  delete    Delete an API key
  report    View usage report for API keys

Usage:
  npm run key:create -- --name "My Key" [--expires 2026-12-31]
  npm run key:list
  npm run key:disable -- --id <uuid>
  npm run key:enable -- --id <uuid>
  npm run key:delete -- --id <uuid>
  npm run usage:report [--key-id <uuid>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]

Options:
  --name     Key name (required for create)
  --id       Key UUID (required for disable/enable/delete)
  --expires  Expiration date YYYY-MM-DD (optional for create)
  --key-id   Filter by key ID (optional for report)
  --from     Start date YYYY-MM-DD (optional for report)
  --to       End date YYYY-MM-DD (optional for report)
`);
}

/**
 * Handle 'create' command.
 * Creates a new API key with the specified name.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments
 */
export async function handleCreate(
  manager: ApiKeyManager,
  args: Record<string, string | undefined>
): Promise<void> {
  const name = args.name;

  if (!name) {
    console.error('Error: --name is required for create command');
    console.error('Usage: npm run key:create -- --name "My Key" [--expires 2026-12-31]');
    process.exit(1);
  }

  // Parse expiration date if provided
  let expiresAt: Date | undefined;
  if (args.expires) {
    const expiresDate = new Date(args.expires);
    if (isNaN(expiresDate.getTime())) {
      console.error(`Error: Invalid expiration date format: ${args.expires}`);
      console.error('Expected format: YYYY-MM-DD');
      process.exit(1);
    }
    if (expiresDate <= new Date()) {
      console.error('Error: Expiration date must be in the future');
      process.exit(1);
    }
    expiresAt = expiresDate;
  }

  try {
    const { plaintextKey, key } = await manager.createKey({ name, expiresAt });

    console.log('\nAPI Key created successfully!\n');
    console.log(`  ID: ${key.id}`);
    console.log(`  Name: ${key.name}`);
    console.log(`  Key: ${plaintextKey}`);
    if (key.expiresAt) {
      console.log(`  Expires: ${formatDate(key.expiresAt)}`);
    }
    console.log('\nIMPORTANT: Save this key now! It will not be shown again.\n');
  } catch (error) {
    console.error(
      'Error creating API key:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Handle 'list' command.
 * Lists all API keys with their metadata.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments (unused)
 */
export async function handleList(
  manager: ApiKeyManager,
  _args: Record<string, string | undefined>
): Promise<void> {
  const keys = manager.getAllKeys();

  if (keys.length === 0) {
    console.log('No API keys found.');
    console.log('Create one with: npm run key:create -- --name "My Key"');
    return;
  }

  console.log('\nAPI Keys:\n');
  console.log(
    '  ID                                      Name                 Status    Prefix    Created     Expires'
  );
  console.log(
    '  --------------------------------------- -------------------- --------- --------- ----------- -----------'
  );

  for (const key of keys) {
    const status = key.status.padEnd(8);
    const name = key.name.length > 20 ? key.name.slice(0, 17) + '...' : key.name.padEnd(20);
    console.log(
      `  ${key.id}  ${name} ${status}  ${key.prefix}   ${formatDate(key.createdAt).padEnd(10)} ${formatDate(key.expiresAt).padEnd(10)}`
    );
  }

  console.log(`\n  Total: ${keys.length} key(s)\n`);
}

/**
 * Handle 'disable' command.
 * Disables an API key by setting its status to 'disabled'.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments
 */
export async function handleDisable(
  manager: ApiKeyManager,
  args: Record<string, string | undefined>
): Promise<void> {
  const id = args.id;

  if (!id) {
    console.error('Error: --id is required for disable command');
    console.error('Usage: npm run key:disable -- --id <uuid>');
    process.exit(1);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(`Error: API key not found: ${id}`);
    process.exit(1);
  }

  if (key.status === 'disabled') {
    console.log(`API key "${key.name}" is already disabled.`);
    return;
  }

  try {
    await manager.updateKeyStatus(id, 'disabled');
    console.log(`\nAPI key disabled successfully.`);
    console.log(`  ID: ${key.id}`);
    console.log(`  Name: ${key.name}`);
    console.log(`  Status: disabled\n`);
  } catch (error) {
    console.error(
      'Error disabling API key:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Handle 'enable' command.
 * Enables a disabled API key by setting its status to 'active'.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments
 */
export async function handleEnable(
  manager: ApiKeyManager,
  args: Record<string, string | undefined>
): Promise<void> {
  const id = args.id;

  if (!id) {
    console.error('Error: --id is required for enable command');
    console.error('Usage: npm run key:enable -- --id <uuid>');
    process.exit(1);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(`Error: API key not found: ${id}`);
    process.exit(1);
  }

  if (key.status === 'active') {
    console.log(`API key "${key.name}" is already active.`);
    return;
  }

  try {
    await manager.updateKeyStatus(id, 'active');
    console.log(`\nAPI key enabled successfully.`);
    console.log(`  ID: ${key.id}`);
    console.log(`  Name: ${key.name}`);
    console.log(`  Status: active\n`);
  } catch (error) {
    console.error(
      'Error enabling API key:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Handle 'delete' command.
 * Permanently deletes an API key.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments
 */
export async function handleDelete(
  manager: ApiKeyManager,
  args: Record<string, string | undefined>
): Promise<void> {
  const id = args.id;

  if (!id) {
    console.error('Error: --id is required for delete command');
    console.error('Usage: npm run key:delete -- --id <uuid>');
    process.exit(1);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(`Error: API key not found: ${id}`);
    process.exit(1);
  }

  try {
    const name = key.name;
    await manager.deleteKey(id);
    console.log(`\nAPI key deleted successfully.`);
    console.log(`  ID: ${id}`);
    console.log(`  Name: ${name}\n`);
  } catch (error) {
    console.error(
      'Error deleting API key:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Handle 'report' command.
 * Shows usage report for API keys with optional filtering.
 *
 * @param manager - ApiKeyManager instance
 * @param args - Parsed arguments (--key-id, --from, --to)
 * @param usageTracker - UsageTracker instance (optional for backwards compatibility)
 */
export async function handleReport(
  manager: ApiKeyManager,
  args: Record<string, string | undefined>,
  usageTracker?: UsageTracker
): Promise<void> {
  // If no usageTracker provided, create one
  const tracker = usageTracker ?? createUsageTracker();
  if (!usageTracker) {
    await tracker.initialize();
  }

  // Parse filter arguments
  const keyId = args['key-id'];
  const from = args.from;
  const to = args.to;

  // Validate date format if provided
  const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !dateFormatRegex.test(from)) {
    console.error(`Error: Invalid --from date format: ${from}`);
    console.error('Expected format: YYYY-MM-DD');
    process.exit(1);
  }
  if (to && !dateFormatRegex.test(to)) {
    console.error(`Error: Invalid --to date format: ${to}`);
    console.error('Expected format: YYYY-MM-DD');
    process.exit(1);
  }

  // Get usage report
  const reports = tracker.getUsageReport({ keyId, from, to });

  // Handle empty report
  if (reports.length === 0) {
    console.log('\nNo usage data found.');
    if (keyId) {
      console.log(`  Filter: key-id = ${keyId}`);
    }
    if (from || to) {
      const dateFilter = [];
      if (from) dateFilter.push(`from = ${from}`);
      if (to) dateFilter.push(`to = ${to}`);
      console.log(`  Date range: ${dateFilter.join(', ')}`);
    }
    console.log('\nMake some API requests to generate usage data.\n');
    return;
  }

  // Enrich reports with key names
  const enrichedReports = reports.map((report) => {
    const key = manager.getKeyById(report.keyId);
    return {
      ...report,
      keyName: key?.name ?? 'Unknown Key',
    };
  });

  // Calculate totals
  const totalRequests = enrichedReports.reduce((sum, r) => sum + r.totalRequests, 0);
  const totalInputTokens = enrichedReports.reduce((sum, r) => sum + r.totalInputTokens, 0);
  const totalOutputTokens = enrichedReports.reduce((sum, r) => sum + r.totalOutputTokens, 0);
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Print header
  console.log('\nUsage Report');
  console.log('============\n');

  if (from || to) {
    const dateFilter = [];
    if (from) dateFilter.push(`from ${from}`);
    if (to) dateFilter.push(`to ${to}`);
    console.log(`Date Range: ${dateFilter.join(' ')}`);
  }
  console.log(`Report Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}}\n`);

  // Print summary table
  console.log('Summary by Key:');
  console.log('──────────────────────────────────────────────────────────────────────────────────────');
  console.log('  Key ID                                  Name                 Requests   Tokens      ');
  console.log('──────────────────────────────────────────────────────────────────────────────────────');

  for (const report of enrichedReports) {
    const keyIdShort = report.keyId.slice(0, 8) + '...';
    const name = report.keyName.length > 20 ? report.keyName.slice(0, 17) + '...' : report.keyName.padEnd(20);
    const requests = report.totalRequests.toString().padStart(8);
    const tokens = report.totalTokens.toString().padStart(10);
    console.log(`  ${keyIdShort}                                ${name} ${requests}   ${tokens}`);
  }

  console.log('──────────────────────────────────────────────────────────────────────────────────────');
  console.log(`  TOTAL                                                        ${totalRequests.toString().padStart(8)}   ${totalTokens.toString().padStart(10)}`);
  console.log();

  // Print token breakdown
  console.log('Token Breakdown:');
  console.log(`  Input Tokens:  ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output Tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Total Tokens:  ${totalTokens.toLocaleString()}`);
  console.log();

  // Print daily breakdown for each key (if only one key or showing all)
  if (enrichedReports.length <= 3) {
    for (const report of enrichedReports) {
      if (report.dailyBreakdown.length > 0) {
        console.log(`\nDaily Breakdown for ${report.keyName}:`);
        console.log('────────────────────────────────────────────────────────────────');
        console.log('  Date         Requests   Input Tokens  Output Tokens  Total');
        console.log('────────────────────────────────────────────────────────────────');

        for (const day of report.dailyBreakdown) {
          const total = day.inputTokens + day.outputTokens;
          console.log(
            `  ${day.date}   ${day.requestCount.toString().padStart(8)}   ` +
            `${day.inputTokens.toString().padStart(12)}   ` +
            `${day.outputTokens.toString().padStart(12)}   ` +
            `${total.toString().padStart(8)}`
          );
        }
        console.log('────────────────────────────────────────────────────────────────');
      }
    }
  }

  console.log();
}

/**
 * Command registry mapping command names to handlers.
 */
export const commands: Record<string, CommandHandler> = {
  create: handleCreate,
  list: handleList,
  disable: handleDisable,
  enable: handleEnable,
  delete: handleDelete,
  report: handleReport,
};

/**
 * Run a CLI command.
 *
 * @param command - Command name
 * @param args - Command-line arguments
 * @param usageTracker - Optional UsageTracker instance for report command
 */
export async function runCommand(
  command: string,
  args: string[],
  usageTracker?: UsageTracker
): Promise<void> {
  // Handle help flag
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  // Check if command exists
  const handler = commands[command];
  if (!handler) {
    console.error(`Error: Unknown command '${command}'`);
    printHelp();
    process.exit(1);
  }

  // Create and initialize the manager
  const manager = createApiKeyManager();
  await manager.initialize();

  // Parse arguments and run the command
  const parsedArgs = parseArgs(args);
  await handler(manager, parsedArgs, usageTracker);
}