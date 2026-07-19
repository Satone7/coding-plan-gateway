/**
 * Kimi For Coding Usage Adapter.
 * Queries Kimi's coding-plan usages API to get real-time quota percentages.
 *
 * Endpoint semantics (verified against api.kimi.com/coding/v1/usages):
 * - `usage`: weekly quota window (limit/used/remaining/resetTime)
 * - `limits[]`: rolling rate-limit windows (currently a single 5h window),
 *   each with `window` (duration + timeUnit) and `detail` (same quota fields)
 * - Numeric fields are returned as strings (e.g. "100") — parsed leniently
 * - `resetTime` is an ISO 8601 string
 */

import type { UsageAdapter, UsageResult, UsageWindow } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Quota detail block shared by the weekly window and rolling windows.
 * Kimi returns numbers as strings, so accept both.
 */
interface KimiQuotaDetail {
  limit?: string | number;
  used?: string | number;
  remaining?: string | number;
  resetTime?: string | number;
}

/**
 * Response structure of GET /coding/v1/usages.
 */
interface KimiUsagesResponse {
  usage?: KimiQuotaDetail;
  limits?: Array<{
    window?: {
      duration?: number;
      timeUnit?: string;
    };
    detail?: KimiQuotaDetail;
  }>;
}

/**
 * Usages endpoint for the Kimi For Coding subscription.
 * Note: coding-plan keys (sk-kimi-…) only authenticate against
 * api.kimi.com/coding — the public api.moonshot.* surfaces reject them.
 */
const KIMI_USAGES_URL = 'https://api.kimi.com/coding/v1/usages';

/**
 * Parse a string-or-number JSON value into a finite number.
 */
function parseNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Convert a resetTime value (ISO string or epoch seconds/millis) to a
 * milliseconds timestamp. Returns undefined when absent or unparseable.
 */
function parseResetTime(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    if (value <= 0) {
      return undefined;
    }
    // Distinguish seconds from millis: epoch seconds < 1e12, millis >= 1e12
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

/**
 * Build a human-readable window label from the window descriptor,
 * e.g. { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' } → '5h'.
 */
function buildWindowLabel(window?: { duration?: number; timeUnit?: string }): string {
  const duration = window?.duration;
  if (!duration || duration <= 0) {
    return '5h';
  }
  switch (window?.timeUnit) {
    case 'TIME_UNIT_MINUTE':
      return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
    case 'TIME_UNIT_HOUR':
      return `${duration}h`;
    case 'TIME_UNIT_DAY':
      return `${duration}d`;
    default:
      return `${duration}u`;
  }
}

/**
 * Compute usage percentage for a quota detail block.
 * Prefers the explicit `used` field; falls back to limit - remaining.
 */
function computePercentage(detail: KimiQuotaDetail): number {
  const limit = parseNumber(detail.limit);
  if (!limit || limit <= 0) {
    return 0;
  }
  const used = parseNumber(detail.used);
  const remaining = parseNumber(detail.remaining);
  const effectiveUsed = used ?? (remaining !== undefined ? Math.max(0, limit - remaining) : 0);
  return (effectiveUsed / limit) * 100;
}

/**
 * Build the usage window list from a usages response: one window per rolling
 * rate-limit entry, plus the weekly quota window.
 */
function buildUsageWindows(body: KimiUsagesResponse): UsageWindow[] {
  const windows: UsageWindow[] = [];

  // Rolling rate-limit windows (currently a single 5h window)
  for (const entry of body.limits ?? []) {
    if (!entry.detail) {
      continue;
    }
    windows.push({
      type: 'TOKENS_LIMIT',
      percentage: computePercentage(entry.detail),
      windowLabel: buildWindowLabel(entry.window),
      nextResetTime: parseResetTime(entry.detail.resetTime),
    });
  }

  // Weekly quota window
  if (body.usage) {
    windows.push({
      type: 'TOKENS_LIMIT',
      percentage: computePercentage(body.usage),
      windowLabel: '1w',
      nextResetTime: parseResetTime(body.usage.resetTime),
    });
  }

  return windows;
}

/**
 * Usage adapter for Kimi For Coding (api.kimi.com/coding).
 *
 * Returns one window per rolling rate-limit entry plus the weekly quota
 * window. The overall percentage is the maximum across all windows, since
 * exhaustion in any window makes the plan unavailable.
 */
export class KimiUsageAdapter implements UsageAdapter {
  readonly providerId = 'kimi';
  readonly cacheTTL = 300; // 5 minutes

  async queryUsage(apiKey: string): Promise<UsageResult> {
    try {
      const response = await fetch(KIMI_USAGES_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Kimi usage API returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      const body = (await response.json()) as KimiUsagesResponse;
      const windows = buildUsageWindows(body);

      const maxPercentage =
        windows.length > 0 ? Math.max(...windows.map((w) => w.percentage)) : 0;

      logger.debug('Kimi usage queried', {
        percentage: maxPercentage,
        windowCount: windows.length,
        windows: windows.map((w) => `${w.windowLabel}:${w.percentage}%`),
      });

      return {
        used: parseNumber(body.usage?.used) ?? 0,
        limit: parseNumber(body.usage?.limit) ?? 0,
        percentage: maxPercentage,
        windows,
        raw: body,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Kimi usage API returned HTTP')) {
        throw error;
      }
      throw new Error(
        `Failed to query Kimi usage API: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
