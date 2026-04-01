import { spawn } from 'child_process';
import path from 'path';
import { exit } from 'process';
import { CLI_EXIT_CODES } from '@/types/cli';
import type { CliContext } from '@/types/cli';

import fs from 'fs';

/**
 * Handle dashboard command.
 * Launches the TUI dashboard.
 */
export async function handleDashboardCommand(context: CliContext): Promise<void> {
  if (context.args.options.help || context.args.options.h) {
    console.log(`
Usage: cpg dashboard

Launches the TUI dashboard to monitor the locally running Coding Plan Gateway.
The dashboard connects via IPC to receive real-time metrics and logs.

Options:
  -h, --help     Show this help message
    `);
    return;
  }

  try {
    // Resolve the path to the compiled dashboard script
    // In dist/cli/commands/dashboard.js, the path to dist/dashboard.mjs is ../../dashboard.mjs
    let dashboardScript = path.resolve(__dirname, '..', '..', 'dashboard.mjs');
    
    if (!fs.existsSync(dashboardScript)) {
      // Fallback for dev environment (e.g. running from src/)
      dashboardScript = path.resolve(__dirname, '..', '..', '..', 'dist', 'dashboard.mjs');
    }

    if (!fs.existsSync(dashboardScript)) {
      console.error(context.formatter.formatError({
        type: 'unknown',
        message: 'Dashboard script not found. Please run "npm run build" or "npm run build:dashboard" first.',
        exitCode: CLI_EXIT_CODES.GENERAL_ERROR,
      }));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
    
    // We run the dashboard script as a child process, inheriting stdio
    // This allows ink to take over the terminal
    
    // Check if we are running in docker environment
    const isDocker = fs.existsSync('/.dockerenv');
    const env = { ...process.env };
    
    if (isDocker && !env.IPC_SOCKET_PATH) {
      env.IPC_SOCKET_PATH = '/app/data/coding-plan-gateway.sock';
    }
    
    const child = spawn(process.execPath, [dashboardScript], {
      stdio: 'inherit',
      env
    });

    child.on('error', (error) => {
      console.error(context.formatter.formatError({
        type: 'unknown',
        message: `Failed to start dashboard: ${error.message}`,
        exitCode: CLI_EXIT_CODES.GENERAL_ERROR,
      }));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    });

    child.on('exit', (code) => {
      exit(code ?? CLI_EXIT_CODES.SUCCESS);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(context.formatter.formatError({
      type: 'unknown',
      message: `Error launching dashboard: ${message}`,
      exitCode: CLI_EXIT_CODES.GENERAL_ERROR,
    }));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
}
