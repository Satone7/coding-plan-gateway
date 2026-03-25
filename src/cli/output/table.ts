/**
 * Table output formatter for CLI.
 * Provides human-readable output with proper formatting.
 */

import type { ApiKey } from '@/types/api-key';
import type { UsageReport } from '@/types/usage';
import type {
  OutputFormatter,
  TestKeyResult,
  CliError,
  EnrichedUsageReport,
  UsageTotals,
} from '@/types/cli';
import type { CreateKeyResult } from '@/services/api-key-manager';

/**
 * Format a date for display.
 */
function formatDate(date: Date | undefined): string {
  if (!date) {
    return 'N/A';
  }
  return date.toISOString().split('T')[0] ?? 'N/A';
}

/**
 * Format a datetime for display.
 */
function formatDateTime(date: Date | undefined): string {
  if (!date) {
    return 'N/A';
  }
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Pad a string to a specific length.
 */
function pad(str: string, length: number): string {
  return str.padEnd(length);
}

/**
 * Table output formatter implementation.
 */
export class TableFormatter implements OutputFormatter {
  formatKeyCreate(result: CreateKeyResult): string {
    const { plaintextKey, key } = result;
    const lines: string[] = [
      '',
      'API Key created successfully!',
      '',
      `  ID: ${key.id}`,
      `  Name: ${key.name}`,
      `  Key: ${plaintextKey}`,
    ];

    if (key.expiresAt) {
      lines.push(`  Expires: ${formatDate(key.expiresAt)}`);
    }

    lines.push('', 'IMPORTANT: Save this key now! It will not be shown again.', '');
    return lines.join('\n');
  }

  formatKeyList(keys: ApiKey[]): string {
    if (keys.length === 0) {
      return [
        '',
        'No API keys found.',
        'Create one with: cpg key create --name "My Key"',
        '',
      ].join('\n');
    }

    const lines: string[] = ['', 'API Keys:', ''];
    const header =
      '  ID                                      Name                 Status    Prefix    Created     Expires';
    const separator =
      '  --------------------------------------- -------------------- --------- --------- ----------- -----------';

    lines.push(header);
    lines.push(separator);

    for (const key of keys) {
      const status = key.status.padEnd(8);
      const name = truncate(key.name, 20).padEnd(20);
      lines.push(
        `  ${key.id}  ${name} ${status}  ${key.prefix}   ${formatDate(key.createdAt).padEnd(10)} ${formatDate(key.expiresAt).padEnd(10)}`
      );
    }

    lines.push('', `  Total: ${keys.length} key(s)`, '');
    return lines.join('\n');
  }

  formatKeyTest(result: TestKeyResult): string {
    const lines: string[] = ['', `Key: ${result.prefix}...`];

    if (result.status === 'valid' && result.key) {
      lines.push(`Status: valid`, '');
      lines.push(`  ID: ${result.key.id}`);
      lines.push(`  Name: ${result.key.name}`);
      lines.push(`  Created: ${formatDate(result.key.createdAt)}`);
      if (result.key.expiresAt) {
        lines.push(`  Expires: ${formatDate(result.key.expiresAt)}`);
      }
    } else {
      lines.push(`Status: ${result.status}`, '');
      if (result.error) {
        lines.push(`Error: ${result.error}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  formatKeyStatusChange(key: ApiKey, action: 'enabled' | 'disabled'): string {
    const lines: string[] = [
      '',
      `API key ${action} successfully.`,
      `  ID: ${key.id}`,
      `  Name: ${key.name}`,
      `  Status: ${key.status}`,
      '',
    ];
    return lines.join('\n');
  }

  formatKeyDelete(key: ApiKey): string {
    const lines: string[] = [
      '',
      'API key deleted successfully.',
      `  ID: ${key.id}`,
      `  Name: ${key.name}`,
      '',
    ];
    return lines.join('\n');
  }

  formatUsageReport(reports: EnrichedUsageReport[], totals: UsageTotals): string {
    if (reports.length === 0) {
      return [
        '',
        'No usage data found.',
        '',
        'Make some API requests to generate usage data.',
        '',
      ].join('\n');
    }

    const lines: string[] = ['', 'Usage Report', '============', ''];

    // Summary table
    lines.push('Summary by Key:');
    lines.push(
      '──────────────────────────────────────────────────────────────────────────────────────'
    );
    lines.push('  Key ID         Name                 Requests   Tokens      ');
    lines.push(
      '──────────────────────────────────────────────────────────────────────────────────────'
    );

    for (const report of reports) {
      const keyIdShort = report.keyId.slice(0, 8) + '...';
      const name = truncate(report.keyName, 20).padEnd(20);
      const requests = report.totalRequests.toString().padStart(8);
      const tokens = report.totalTokens.toString().padStart(10);
      lines.push(`  ${keyIdShort}                                ${name} ${requests}   ${tokens}`);
    }

    lines.push(
      '──────────────────────────────────────────────────────────────────────────────────────'
    );
    lines.push(
      `  TOTAL                                                        ${totals.totalRequests.toString().padStart(8)}   ${totals.totalTokens.toString().padStart(10)}`
    );
    lines.push('');

    // Token breakdown
    lines.push('Token Breakdown:');
    lines.push(`  Input Tokens:  ${totals.totalInputTokens.toLocaleString()}`);
    lines.push(`  Output Tokens: ${totals.totalOutputTokens.toLocaleString()}`);
    lines.push(`  Total Tokens:  ${totals.totalTokens.toLocaleString()}`);
    lines.push('');

    // Daily breakdown for each key
    if (reports.length <= 3) {
      for (const report of reports) {
        if (report.dailyBreakdown.length > 0) {
          lines.push(``, `Daily Breakdown for ${report.keyName}:`);
          lines.push('────────────────────────────────────────────────────────────────');
          lines.push('  Date         Requests   Input Tokens  Output Tokens  Total');
          lines.push('────────────────────────────────────────────────────────────────');

          for (const day of report.dailyBreakdown) {
            const total = day.inputTokens + day.outputTokens;
            lines.push(
              `  ${day.date}   ${day.requestCount.toString().padStart(8)}   ` +
                `${day.inputTokens.toString().padStart(12)}   ` +
                `${day.outputTokens.toString().padStart(12)}   ` +
                `${total.toString().padStart(8)}`
            );
          }
          lines.push('────────────────────────────────────────────────────────────────');
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  formatError(error: CliError): string {
    const lines: string[] = ['', `Error: ${error.message}`];

    if (error.suggestion) {
      lines.push('', `Suggestion: ${error.suggestion}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  formatHelp(command?: string): string {
    if (command === 'key') {
      return this.formatKeyHelp();
    }

    if (command === 'usage-report') {
      return this.formatUsageReportHelp();
    }

    return this.formatMainHelp();
  }

  private formatMainHelp(): string {
    return `
CPG CLI - Coding Plan Gateway Command Line Interface

Usage:
  cpg <command> [subcommand] [options]

Commands:
  key           Manage API keys
  usage-report  View usage reports

Global Options:
  --help, -h     Show this help message
  --version, -v  Show version information
  --json         Output in JSON format
  --gateway-url  Gateway URL for notifications (default: http://localhost:8080)

Examples:
  cpg key create --name "My Key"
  cpg key list
  cpg key test cpg_xxxx...
  cpg usage-report

Run "cpg key --help" for more information on key commands.
`;
  }

  private formatKeyHelp(): string {
    return `
CPG CLI - Key Management Commands

Usage:
  cpg key <subcommand> [options]

Subcommands:
  create    Create a new API key
  list      List all API keys
  test      Test if an API key is valid
  disable   Disable an API key
  enable    Enable a disabled API key
  delete    Delete an API key

Options:
  --name <name>    Key name (required for create)
  --id <uuid>      Key ID (required for disable/enable/delete)
  --expires <date> Expiration date YYYY-MM-DD (optional for create)
  --json           Output in JSON format

Examples:
  cpg key create --name "Production Key" --expires 2026-12-31
  cpg key list
  cpg key test cpg_xxxx...
  cpg key disable --id 550e8400-e29b-41d4-a716-446655440000
`;
  }

  private formatUsageReportHelp(): string {
    return `
CPG CLI - Usage Report Command

Usage:
  cpg usage-report [options]

Options:
  --key-id <uuid>  Filter by key ID
  --from <date>    Start date (YYYY-MM-DD)
  --to <date>      End date (YYYY-MM-DD)
  --json           Output in JSON format

Examples:
  cpg usage-report
  cpg usage-report --key-id 550e8400-e29b-41d4-a716-446655440000
  cpg usage-report --from 2026-03-01 --to 2026-03-31
`;
  }

  formatVersion(version: string): string {
    return `cpg version ${version}\n`;
  }
}

/**
 * Create a new table formatter instance.
 */
export function createTableFormatter(): TableFormatter {
  return new TableFormatter();
}