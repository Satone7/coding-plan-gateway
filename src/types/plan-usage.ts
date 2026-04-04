/**
 * Plan usage types and validation schemas.
 * Provides type definitions for plan usage tracking and reporting.
 */

import { z } from 'zod';
import type { QuotaPeriod } from './coding-plan';

/**
 * Daily usage record for a specific plan.
 */
export interface PlanUsageRecord {
  /** Reference to the coding plan (integer ID) */
  planId: number;
  /** Date of usage in YYYY-MM-DD format */
  date: string;
  /** Number of requests made on this date */
  requestCount: number;
  /** Timestamp of last update to this record */
  lastUpdated: Date;
}

/**
 * Daily usage breakdown for plan reports.
 */
export interface DailyPlanUsage {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Number of requests on this date */
  requestCount: number;
}

/**
 * Aggregated usage report for a plan over a date range.
 */
export interface PlanUsageReport {
  /** Reference to the coding plan (integer ID) */
  planId: number;
  /** Plan name for display (from CodingPlan config) */
  planName: string;
  /** Total requests in the date range */
  totalRequests: number;
  /** Quota limit from plan configuration */
  limit: number;
  /** Remaining quota: limit - totalRequests */
  remaining: number;
  /** Usage percentage: (totalRequests / limit) * 100 */
  percentage: number;
  /** Date range covered by report */
  dateRange: {
    start: string;
    end: string;
  };
  /** Daily breakdown within the date range */
  dailyBreakdown: DailyPlanUsage[];
  /** Quota period type from plan configuration */
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  /** Next reset date for daily/monthly plans */
  resetAt: Date | null;
}

/**
 * Usage adjustment history record.
 */
export interface UsageAdjustmentHistory {
  /** Unique identifier for this adjustment record (UUID) */
  id: string;
  /** Reference to the coding plan (integer ID) */
  planId: number;
  /** When the adjustment was made */
  timestamp: Date;
  /** Usage value before adjustment */
  oldValue: number;
  /** Usage value after adjustment */
  newValue: number;
  /** Method used for adjustment */
  adjustmentType: 'count' | 'percent';
  /** Original input value (e.g., 75 for --percent 75) */
  adjustmentValue: number;
}

/**
 * Plan usage data storage schema (for JSON persistence).
 * Structure: { "YYYY-MM-DD": { planId: record } }
 */
export interface PlanUsageDataStorage {
  version: string;
  lastSync: string;
  records: Record<string, Record<string, PlanUsageRecordData>>;
}

/**
 * Plan usage record data without planId and date (for storage structure).
 */
export interface PlanUsageRecordData {
  requestCount: number;
  lastUpdated: string;
}

/**
 * Usage adjustment history storage schema.
 */
export interface AdjustmentHistoryStorage {
  version: string;
  lastSync: string;
  adjustments: AdjustmentRecordData[];
}

/**
 * Adjustment record data for storage.
 */
export interface AdjustmentRecordData {
  id: string;
  planId: number;
  timestamp: string;
  oldValue: number;
  newValue: number;
  adjustmentType: 'count' | 'percent';
  adjustmentValue: number;
}

/**
 * Plan usage summary for list display.
 */
export interface PlanUsageSummary {
  /** Reference to the coding plan (integer ID) */
  planId: number;
  /** Plan name for display */
  planName: string;
  /** Quota limit from plan configuration */
  limit: number;
  /** Current usage count */
  used: number;
  /** Remaining quota */
  remaining: number;
  /** Usage percentage */
  percentage: number;
  /** Quota period type */
  quotaPeriod: QuotaPeriod | 'daily' | 'monthly' | 'total';
  /** Next reset date */
  resetAt: Date | null;
}

/**
 * Zod schema for plan usage record validation.
 */
export const planUsageRecordSchema = z.object({
  planId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestCount: z.number().int().nonnegative(),
  lastUpdated: z.coerce.date(),
});

/**
 * Zod schema for daily plan usage validation.
 */
export const dailyPlanUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestCount: z.number().int().nonnegative(),
});

/**
 * Zod schema for plan usage record data (storage format).
 */
export const planUsageRecordDataSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  lastUpdated: z.string(),
});

/**
 * Zod schema for plan usage data storage file.
 */
export const planUsageDataStorageSchema = z.object({
  version: z.string().default('1.0'),
  lastSync: z.string(),
  records: z.record(z.string(), z.record(z.string(), planUsageRecordDataSchema)),
});

/**
 * Zod schema for adjustment record data.
 */
export const adjustmentRecordDataSchema = z.object({
  id: z.string().uuid(),
  planId: z.number().int().positive(),
  timestamp: z.string(),
  oldValue: z.number().int().nonnegative(),
  newValue: z.number().int().nonnegative(),
  adjustmentType: z.enum(['count', 'percent']),
  adjustmentValue: z.number().nonnegative(),
});

/**
 * Zod schema for adjustment history storage file.
 */
export const adjustmentHistoryStorageSchema = z.object({
  version: z.string().default('1.0'),
  lastSync: z.string(),
  adjustments: z.array(adjustmentRecordDataSchema),
});

/**
 * Zod schema for usage adjustment request.
 */
export const usageAdjustmentRequestSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  percent: z.number().min(0).max(100).optional(),
}).refine(
  (data) => (data.count !== undefined) !== (data.percent !== undefined),
  'Exactly one of count or percent must be provided'
);

/**
 * Plan info needed for usage report generation with expiresOn support.
 * Extended to support quota reset date calculations based on plan expiration.
 */
export interface PlanInfo {
  /** Plan identifier (integer) */
  id: number;
  /** Plan display name */
  name: string;
  /** Quota configuration including expiration settings */
  quota: {
    /** Maximum allowed usage */
    limit: number;
    /** Quota reset period (structured QuotaPeriod or legacy string for backward compat) */
    period: QuotaPeriod | 'daily' | 'monthly' | 'total';
    /** Optional day of month for reset (1-31). Used for monthly quotas with custom reset dates. */
    expiresOn?: number;
    /** Optional ISO 8601 datetime for absolute expiration. Takes precedence over expiresOn. */
    expiresAt?: string;
  };
}