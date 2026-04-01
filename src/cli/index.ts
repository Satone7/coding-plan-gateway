/**
 * CPG CLI Main Entry Point.
 * Routes commands to appropriate handlers.
 */

import { exit } from 'process';
import {
  parseCliArgs,
  createCliContext,
  isHelpRequested,
  isVersionRequested,
} from './context';
import { handleKeyCommand } from './commands/key';
import { handleUsageReportCommand } from './commands/usage';
import { handlePlanCommand } from './commands/plan';
import { handleDashboardCommand } from './commands/dashboard';
import { CLI_EXIT_CODES, CLI_VERSION } from '@/types/cli';
import type { CliContext } from '@/types/cli';

/**
 * Print main help message.
 */
function printMainHelp(context: CliContext): void {
  console.log(context.formatter.formatHelp());
}

/**
 * Print version information.
 */
function printVersion(context: CliContext): void {
  console.log(context.formatter.formatVersion(CLI_VERSION));
}

/**
 * Main CLI entry point.
 */
export async function runCli(argv: string[]): Promise<void> {
  // Parse command-line arguments
  const parsedArgs = parseCliArgs(argv);
  const context = createCliContext(parsedArgs);

  // Handle global flags
  if (isVersionRequested(parsedArgs.options)) {
    printVersion(context);
    exit(CLI_EXIT_CODES.SUCCESS);
  }

  // Handle help with command context
  if (isHelpRequested(parsedArgs.options)) {
    console.log(context.formatter.formatHelp(parsedArgs.command));
    exit(CLI_EXIT_CODES.SUCCESS);
  }

  // Route to command handlers
  const { command, subcommand } = parsedArgs;

  try {
    switch (command) {
      case 'key':
        await handleKeyCommand(context, subcommand);
        break;

      case 'usage-report':
        await handleUsageReportCommand(context);
        break;

      case 'plan':
        await handlePlanCommand(context, subcommand);
        break;

      case 'dashboard':
        await handleDashboardCommand(context);
        break;

      case '':
        console.error('Error: No command specified');
        printMainHelp(context);
        exit(CLI_EXIT_CODES.GENERAL_ERROR);

      default:
        console.error(`Error: Unknown command '${command}'`);
        printMainHelp(context);
        exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(context.formatter.formatError({
      type: 'unknown',
      message,
      exitCode: CLI_EXIT_CODES.GENERAL_ERROR,
    }));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
}

/**
 * CLI bootstrap function.
 */
export async function main(): Promise<void> {
  // Skip 'node' and script path from arguments
  const argv = process.argv.slice(2);
  await runCli(argv);
}

// Run CLI when this file is loaded
void main();