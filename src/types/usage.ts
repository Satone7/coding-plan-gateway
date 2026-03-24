/**
 * Usage tracking types and validation schemas.
 * Provides type definitions for usage metrics and reporting.
 */

import { z } from 'zod';

/**
 * Usage record for a specific API key on a specific day.
 */
export interface UsageRecord {
  /** Reference to API Key ID */
  keyId: string;
  /** Date of usage (YYYY-MM-DD format) */
  date: string;
  /** Number of API requests */
  requestCount: number;
  /** Total input tokens consumed */
  inputTokens: number;
  /** Total output tokens consumed */
  outputTokens: number;
  /** Timestamp of most recent request */
  lastRequest: Date;
}

/**
 * Daily usage breakdown for reports.
 */
export interface DailyUsage {
  /** Date (YYYY-MM-DD format) */
  date: string;
  /** Number of API requests */
  requestCount: number;
  /** Total input tokens consumed */
  inputTokens: number;
  /** Total output tokens consumed */
  outputTokens: number;
}

/**
 * Date range for usage reports.
 */
export interface DateRange {
  /** Start date (YYYY-MM-DD format) */
  start: string;
  /** End date (YYYY-MM-DD format) */
  end: string;
}

/**
 * Aggregated usage report for an API key.
 */
export interface UsageReport {
  /** API Key ID */
  keyId: string;
  /** API Key name for display */
  keyName: string;
  /** Total number of requests */
  totalRequests: number;
  /** Total input tokens consumed */
  totalInputTokens: number;
  /** Total output tokens consumed */
  totalOutputTokens: number;
  /** Sum of all tokens */
  totalTokens: number;
  /** Date range covered by report */
  dateRange: DateRange;
  /** Daily breakdown within the date range */
  dailyBreakdown: DailyUsage[];
}

/**
 * Usage data storage schema (for JSON persistence).
 * Structure: { "YYYY-MM-DD": { keyId: metrics } }
 */
export interface UsageDataStorage {
  version: string;
  lastSync: string;
  usage: Record<string, Record<string, UsageRecordData>>;
}

/**
 * Usage record data without keyId and date (for storage structure).
 */
export interface UsageRecordData {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  lastRequest: string;
}

/**
 * Zod schema for usage record validation.
 */
export const usageRecordSchema = z.object({
  keyId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  lastRequest: z.coerce.date(),
});

/**
 * Zod schema for daily usage validation.
 */
export const dailyUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/**
 * Zod schema for date range validation.
 */
export const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Zod schema for usage report validation.
 */
export const usageReportSchema = z.object({
  keyId: z.string().uuid(),
  keyName: z.string(),
  totalRequests: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  dateRange: dateRangeSchema,
  dailyBreakdown: z.array(dailyUsageSchema),
});

/**
 * Zod schema for usage record data (storage format).
 */
export const usageRecordDataSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  lastRequest: z.string(),
});

/**
 * Zod schema for usage data storage file.
 */
export const usageDataStorageSchema = z.object({
  version: z.string().default('1.0'),
  lastSync: z.string(),
  usage: z.record(z.string(), z.record(z.string(), usageRecordDataSchema)),
});