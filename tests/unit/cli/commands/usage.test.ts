/**
 * Unit tests for usage-report CLI command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLI_EXIT_CODES, type CliContext } from '@/types/cli';
import { createTableFormatter } from '@/cli/output/table';
import { createJsonFormatter } from '@/cli/output/json';

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`Process exited with code ${code}`);
});

// Mock the managers
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockGetUsageReport = vi.fn().mockReturnValue([
  {
    keyId: 'test-key-id',
    dateRange: { start: '2026-03-01', end: '2026-03-25' },
    requestCount: 100,
    inputTokens: 5000,
    outputTokens: 3000,
    totalTokens: 8000,
    totalRequests: 100,
    dailyBreakdown: [],
  },
]);
const mockGetKeyById = vi.fn().mockReturnValue({
  id: 'test-key-id',
  name: 'Test Key',
});

vi.mock('@/services/api-key-manager', () => ({
  createApiKeyManager: vi.fn(() => ({
    initialize: mockInitialize,
    getKeyById: mockGetKeyById,
    getAllKeys: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@/services/usage-tracker', () => ({
  createUsageTracker: vi.fn(() => ({
    initialize: mockInitialize,
    getUsageReport: mockGetUsageReport,
  })),
}));

describe('usage-report command', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockInitialize.mockResolvedValue(undefined);
    mockGetUsageReport.mockReturnValue([
      {
        keyId: 'test-key-id',
        dateRange: { start: '2026-03-01', end: '2026-03-25' },
        requestCount: 100,
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
        totalRequests: 100,
        dailyBreakdown: [],
      },
    ]);
    mockGetKeyById.mockReturnValue({
      id: 'test-key-id',
      name: 'Test Key',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  function createContext(options: Record<string, string | boolean | undefined> = {}): CliContext {
    return {
      args: {
        command: 'usage-report',
        options,
        positional: [],
      },
      formatter: createTableFormatter(),
      gatewayUrl: 'http://localhost:8080',
      configPath: '/app',
      jsonOutput: false,
    };
  }

  describe('handleUsageReportCommand', () => {
    it('should display usage report', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleUsageReportCommand(context);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0];
      expect(output).toContain('Usage Report');

      consoleSpy.mockRestore();
    });

    it('should use JSON formatter with --json flag', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext({ json: true });
      context.formatter = createJsonFormatter();
      context.jsonOutput = true;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleUsageReportCommand(context);

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should filter by key-id', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext({ 'key-id': 'specific-key-id' });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleUsageReportCommand(context);

      expect(mockGetUsageReport).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should filter by date range', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext({
        from: '2026-03-01',
        to: '2026-03-31',
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleUsageReportCommand(context);

      expect(mockGetUsageReport).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should show help with --help flag', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext({ help: true });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleUsageReportCommand(context);

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should validate date format', async () => {
      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext({ from: 'invalid-date' });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(handleUsageReportCommand(context)).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle storage errors gracefully', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('Storage error'));

      const { handleUsageReportCommand } = await import('@/cli/commands/usage');
      const context = createContext();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(handleUsageReportCommand(context)).rejects.toThrow();

      consoleErrorSpy.mockRestore();
    });
  });
});