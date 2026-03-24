#!/usr/bin/env node
/**
 * API Key Management CLI entry point.
 * Routes commands to the appropriate handlers.
 *
 * Usage:
 *   npm run key:create -- --name "My Key"
 *   npm run key:list
 *   npm run key:disable -- --id <uuid>
 *   npm run key:enable -- --id <uuid>
 *   npm run key:delete -- --id <uuid>
 *   npm run usage:report
 */

// Register tsconfig paths for path alias support
import 'tsconfig-paths/register';

import { runCommand } from '../src/cli/api-key-cli';

/**
 * Main entry point for API key CLI.
 */
async function main(): Promise<void> {
  // Get command from arguments (node script.js <command> [--args...])
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  // Show help if no command provided
  if (!command) {
    console.error('Error: No command specified');
    console.log('');
    console.log('Available commands:');
    console.log('  create    Create a new API key');
    console.log('  list      List all API keys');
    console.log('  disable   Disable an API key');
    console.log('  enable    Enable an API key');
    console.log('  delete    Delete an API key');
    console.log('  report    View usage report');
    console.log('');
    console.log('Run with --help for more information.');
    process.exit(1);
  }

  // Run the command
  await runCommand(command, commandArgs);
}

void main();