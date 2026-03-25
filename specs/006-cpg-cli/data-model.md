# Data Model: CPG CLI Executable

**Branch**: `006-cpg-cli` | **Date**: 2026-03-25

## Entities

### CLI Command Arguments

The CLI uses a hierarchical command structure with the following patterns:

```
cpg <command> [subcommand] [options]
```

| Command | Subcommand | Options | Description |
|---------|------------|---------|-------------|
| `key` | `create` | `--name`, `--expires`, `--json` | Create new API key |
| `key` | `list` | `--json` | List all API keys |
| `key` | `test` | `<key>`, `--json` | Validate API key |
| `key` | `disable` | `--id`, `--json` | Disable API key |
| `key` | `enable` | `--id`, `--json` | Enable API key |
| `key` | `delete` | `--id`, `--json` | Delete API key |
| `usage-report` | - | `--key-id`, `--from`, `--to`, `--json` | Show usage report |

### Global Options

| Option | Short | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | false | Show help message |
| `--version` | `-v` | boolean | false | Show version |
| `--json` | | boolean | false | Output in JSON format |
| `--config` | `-c` | string | - | Path to config directory |
| `--gateway-url` | | string | http://localhost:8080 | Gateway URL for notifications |

### Exit Codes

| Code | Meaning | Example |
|------|---------|---------|
| 0 | Success | Operation completed successfully |
| 1 | General error | Invalid arguments, operation failed |
| 2 | Configuration error | Missing ENCRYPTION_KEY |
| 3 | Network error | Gateway unreachable |
| 4 | Storage error | File not accessible |

---

## Types

### CLI Types (src/types/cli.ts)

```typescript
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
  /** Format error message */
  formatError(error: CliError): string;
  /** Format help message */
  formatHelp(command?: string): string;
}

/**
 * Result of key test command.
 */
export interface TestKeyResult {
  /** The key prefix for identification */
  prefix: string;
  /** Validation status */
  status: 'valid' | 'invalid' | 'disabled' | 'expired';
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
```

---

## Gateway Notification Types

### Internal Reload Endpoint (src/routes/internal/reload.ts)

```typescript
/**
 * Request body for reload endpoint.
 */
export interface ReloadRequest {
  /** Type of data that changed */
  type: 'api-keys' | 'usage' | 'all';
}

/**
 * Response from reload endpoint.
 */
export interface ReloadResponse {
  /** Whether reload was successful */
  success: boolean;
  /** Message describing the result */
  message: string;
  /** Timestamp of reload */
  timestamp: string;
}
```

---

## State Transitions

### API Key Status Flow

```
              ┌─────────┐
              │ Create  │
              └────┬────┘
                   │
                   ▼
              ┌─────────┐
         ┌───▶│ Active  │◀───┐
         │    └────┬────┘    │
         │         │         │
    enable│         │disable  │enable
         │         ▼         │
         │    ┌─────────┐    │
         └────│Disabled │────┘
              └────┬────┘
                   │
                   │delete
                   ▼
              ┌─────────┐
              │ Deleted │
              └─────────┘
```

### Key Test Status Determination

```typescript
function determineStatus(key: ApiKey | null, isValid: boolean): TestKeyResult['status'] {
  if (!key) return 'invalid';
  if (!isValid) return 'invalid';
  if (key.status === 'disabled') return 'disabled';
  if (key.expiresAt && new Date() > key.expiresAt) return 'expired';
  return 'valid';
}
```

---

## File Structure Impact

### New Files

| Path | Purpose |
|------|---------|
| `bin/cpg` | Executable entry point |
| `src/cli/index.ts` | CLI main entry |
| `src/cli/commands/key.ts` | Key command handlers |
| `src/cli/commands/usage.ts` | Usage report command |
| `src/cli/output/json.ts` | JSON output formatter |
| `src/cli/output/table.ts` | Table output formatter |
| `src/cli/context.ts` | CLI context creation |
| `src/routes/internal/reload.ts` | Reload endpoint |
| `src/services/gateway-notifier.ts` | Gateway notification client |
| `src/types/cli.ts` | CLI-specific types |

### Modified Files

| Path | Changes |
|------|---------|
| `package.json` | Add `bin` field, update scripts |
| `Dockerfile` | Copy bin/cpg, add to PATH |
| `docker-compose.e2e.yml` | Ensure CLI availability |

---

## Alignment with Existing Data Models

This feature extends existing models without modifying core structures:

- **ApiKey**: Used as-is from `src/types/api-key.ts`
- **ApiKeyStorage**: Used as-is for persistence
- **UsageReport**: Used as-is from `src/types/usage.ts`
- **CreateKeyResult**: Extended from existing in `api-key-manager.ts`