/**
 * Key command handlers for CPG CLI.
 * Provides key create, list, test, disable, enable, and delete operations.
 */

import { exit } from 'process';
import { createApiKeyManager, type ApiKeyManager } from '@/services/api-key-manager';
import { generateKeyPrefix } from '@/utils/key-generator';
import { CLI_EXIT_CODES, type CliContext, type TestKeyResult, type CliError } from '@/types/cli';
import type { ApiKey } from '@/types/api-key';

/**
 * Format date for display.
 */
function formatDate(date: Date | undefined): string {
  if (!date) {
    return 'N/A';
  }
  return date.toISOString().split('T')[0] ?? 'N/A';
}

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
 * Handle key create subcommand.
 */
async function handleCreate(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { args, formatter } = context;
  const options = args.options;
  const name = options.name;

  if (!name || typeof name !== 'string') {
    console.error(formatter.formatError(
      createCliError('validation', '--name is required for create command', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    console.error('Usage: cpg key create --name "My Key" [--expires 2026-12-31]');
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Parse expiration date if provided
  let expiresAt: Date | undefined;
  if (options.expires && typeof options.expires === 'string') {
    const expiresDate = new Date(options.expires);
    if (isNaN(expiresDate.getTime())) {
      console.error(formatter.formatError(
        createCliError('validation', `Invalid expiration date format: ${options.expires}`, CLI_EXIT_CODES.GENERAL_ERROR)
      ));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
    if (expiresDate <= new Date()) {
      console.error(formatter.formatError(
        createCliError('validation', 'Expiration date must be in the future', CLI_EXIT_CODES.GENERAL_ERROR)
      ));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
    expiresAt = expiresDate;
  }

  try {
    const result = await manager.createKey({ name, expiresAt });
    console.log(formatter.formatKeyCreate(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to create API key: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }
}

/**
 * Handle key list subcommand.
 */
async function handleList(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { formatter } = context;
  const keys = manager.getAllKeys();
  console.log(formatter.formatKeyList(keys));
}

/**
 * Handle key test subcommand.
 */
async function handleTest(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { args, formatter } = context;
  const keyToTest = args.positional[0];

  if (!keyToTest) {
    console.error(formatter.formatError(
      createCliError('validation', 'Key argument is required for test command', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    console.error('Usage: cpg key test <key>');
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  try {
    const result = await manager.validateKeyWithStatus(keyToTest);
    const prefix = generateKeyPrefix(keyToTest) ?? keyToTest.slice(0, 8) + '...';

    const testResult: TestKeyResult = {
      prefix,
      status: result.status,
      key: result.key,
      error: result.valid ? undefined : `Key is ${result.status}`,
    };

    console.log(formatter.formatKeyTest(testResult));

    // Exit with appropriate code based on status
    if (!result.valid) {
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('unknown', `Failed to test API key: ${message}`, CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
}

/**
 * Handle key disable subcommand.
 */
async function handleDisable(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { args, formatter } = context;
  const options = args.options;
  const id = options.id;

  if (!id || typeof id !== 'string') {
    console.error(formatter.formatError(
      createCliError('validation', '--id is required for disable command', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    console.error('Usage: cpg key disable --id <uuid>');
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(formatter.formatError(
      createCliError('not_found', `API key not found: ${id}`, CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  if (key.status === 'disabled') {
    console.log(`API key "${key.name}" is already disabled.`);
    return;
  }

  try {
    await manager.updateKeyStatus(id, 'disabled');
    const updatedKey = manager.getKeyById(id)!;
    console.log(formatter.formatKeyStatusChange(updatedKey, 'disabled'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to disable API key: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }
}

/**
 * Handle key enable subcommand.
 */
async function handleEnable(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { args, formatter } = context;
  const options = args.options;
  const id = options.id;

  if (!id || typeof id !== 'string') {
    console.error(formatter.formatError(
      createCliError('validation', '--id is required for enable command', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    console.error('Usage: cpg key enable --id <uuid>');
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(formatter.formatError(
      createCliError('not_found', `API key not found: ${id}`, CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  if (key.status === 'active') {
    console.log(`API key "${key.name}" is already active.`);
    return;
  }

  try {
    await manager.updateKeyStatus(id, 'active');
    const updatedKey = manager.getKeyById(id)!;
    console.log(formatter.formatKeyStatusChange(updatedKey, 'enabled'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to enable API key: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }
}

/**
 * Handle key delete subcommand.
 */
async function handleDelete(
  context: CliContext,
  manager: ApiKeyManager
): Promise<void> {
  const { args, formatter } = context;
  const options = args.options;
  const id = options.id;

  if (!id || typeof id !== 'string') {
    console.error(formatter.formatError(
      createCliError('validation', '--id is required for delete command', CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    console.error('Usage: cpg key delete --id <uuid>');
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  const key = manager.getKeyById(id);
  if (!key) {
    console.error(formatter.formatError(
      createCliError('not_found', `API key not found: ${id}`, CLI_EXIT_CODES.GENERAL_ERROR)
    ));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  try {
    await manager.deleteKey(id);
    console.log(formatter.formatKeyDelete(key));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to delete API key: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }
}

/**
 * Handle key command routing.
 */
export async function handleKeyCommand(
  context: CliContext,
  subcommand?: string
): Promise<void> {
  const { args, formatter } = context;

  // Handle help flag
  if (context.args.options.help || context.args.options.h) {
    console.log(formatter.formatHelp('key'));
    return;
  }

  // Determine subcommand
  const action = subcommand ?? args.subcommand;

  if (!action) {
    console.error('Error: No subcommand specified for key command');
    console.log(formatter.formatHelp('key'));
    exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }

  // Create and initialize the manager
  const manager = createApiKeyManager();
  try {
    await manager.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatter.formatError(
      createCliError('storage', `Failed to initialize API key manager: ${message}`, CLI_EXIT_CODES.STORAGE_ERROR)
    ));
    exit(CLI_EXIT_CODES.STORAGE_ERROR);
  }

  // Route to subcommand handler
  switch (action) {
    case 'create':
      await handleCreate(context, manager);
      break;
    case 'list':
      await handleList(context, manager);
      break;
    case 'test':
      await handleTest(context, manager);
      break;
    case 'disable':
      await handleDisable(context, manager);
      break;
    case 'enable':
      await handleEnable(context, manager);
      break;
    case 'delete':
      await handleDelete(context, manager);
      break;
    default:
      console.error(`Error: Unknown key subcommand '${action}'`);
      console.log(formatter.formatHelp('key'));
      exit(CLI_EXIT_CODES.GENERAL_ERROR);
  }
}