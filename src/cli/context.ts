/**
 * CLI context factory.
 * Creates the execution context for CLI commands.
 */

import type { CliContext, ParsedArgs, OutputFormatter } from '@/types/cli';
import { DEFAULT_GATEWAY_URL, CLI_ENV_VARS } from '@/types/cli';
import { createTableFormatter, createJsonFormatter } from './output';

/**
 * Parse command-line arguments into a structured format.
 * Handles both --key value and --key=value formats.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: '',
    subcommand: undefined,
    options: {},
    positional: [],
  };

  let i = 0;

  // First positional argument is the command
  while (i < argv.length) {
    const arg = argv[i];

    if (!arg) {
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const equalIndex = arg.indexOf('=');
      if (equalIndex > 0) {
        // --key=value format
        const key = arg.slice(2, equalIndex);
        const value = arg.slice(equalIndex + 1);
        result.options[key] = value;
      } else {
        // --key value format or boolean flag
        const key = arg.slice(2);
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          result.options[key] = nextArg;
          i++;
        } else {
          result.options[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flags like -h, -v
      const flag = arg.slice(1);
      result.options[flag] = true;
    } else {
      // Positional argument
      if (!result.command) {
        result.command = arg;
      } else if (!result.subcommand) {
        result.subcommand = arg;
      } else {
        result.positional.push(arg);
      }
    }

    i++;
  }

  return result;
}

/**
 * Get the output formatter based on arguments.
 */
export function getFormatter(jsonOutput: boolean): OutputFormatter {
  return jsonOutput ? createJsonFormatter() : createTableFormatter();
}

/**
 * Get the gateway URL from environment or arguments.
 */
export function getGatewayUrl(options: Record<string, string | boolean | undefined>): string {
  // Priority: CLI argument > Environment variable > Default
  if (typeof options['gateway-url'] === 'string') {
    return options['gateway-url'];
  }

  const envGatewayUrl = process.env[CLI_ENV_VARS.GATEWAY_URL];
  if (envGatewayUrl) {
    return envGatewayUrl;
  }

  return DEFAULT_GATEWAY_URL;
}

/**
 * Get the config path from environment or arguments.
 */
export function getConfigPath(options: Record<string, string | boolean | undefined>): string {
  // Priority: CLI argument > Environment variable > Default
  if (typeof options.config === 'string') {
    return options.config;
  }

  if (typeof options.c === 'string') {
    return options.c;
  }

  const envConfigPath = process.env[CLI_ENV_VARS.CONFIG_PATH];
  if (envConfigPath) {
    return envConfigPath;
  }

  return process.cwd();
}

/**
 * Create CLI context from parsed arguments.
 */
export function createCliContext(args: ParsedArgs): CliContext {
  const jsonOutput = args.options.json === true;
  const formatter = getFormatter(jsonOutput);

  return {
    args,
    formatter,
    gatewayUrl: getGatewayUrl(args.options),
    configPath: getConfigPath(args.options),
    jsonOutput,
  };
}

/**
 * Check if help was requested.
 */
export function isHelpRequested(options: Record<string, string | boolean | undefined>): boolean {
  return options.help === true || options.h === true;
}

/**
 * Check if version was requested.
 */
export function isVersionRequested(options: Record<string, string | boolean | undefined>): boolean {
  return options.version === true || options.v === true;
}