#!/usr/bin/env node
/**
 * Configuration validation CLI script.
 * Validates configuration file and exits with appropriate code.
 *
 * Exit codes:
 *   0 - Configuration is valid
 *   1 - Configuration is invalid or file not found
 */

import { resolve } from 'path';
import { loadConfig } from '../src/config';
import { configSchema } from '../src/config/schema';

/**
 * Main entry point for config validation.
 */
async function main(): Promise<void> {
  // Get config path from args or environment
  const configPath = process.argv[2] ?? process.env.CONFIG_PATH ?? './config.yaml';
  const absolutePath = resolve(configPath);

  try {
    // Try to load and validate the configuration
    // Note: We don't need encryption key for validation, just schema check
    const config = await loadConfig(absolutePath);

    // Additional validation using schema
    const result = configSchema.safeParse(config);
    if (!result.success) {
      console.error(`✗ Configuration invalid: ${absolutePath}`);
      for (const error of result.error.errors) {
        console.error(`  ${error.path.join('.')}: ${error.message}`);
      }
      process.exit(1);
    }

    console.log(`✓ Configuration valid: ${absolutePath}`);
    console.log(`  Plans: ${config.plans.length}`);
    process.exit(0);
  } catch (error) {
    console.error(`✗ Configuration invalid: ${absolutePath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();