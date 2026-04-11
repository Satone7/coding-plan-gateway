/**
 * Zhipu Usage Adapter.
 * Queries Zhipu's quota/limit API to get real-time usage percentages.
 */

import type { UsageAdapter, UsageResult } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Zhipu API response structure for quota limits.
 */
interface ZhipuQuotaResponse {
  data: {
    limits: Array<{
      type: string;
      percentage: number;
    }>;
  };
}

/**
 * Base domain for Zhipu platform.
 */
const ZHIPU_BASE_DOMAIN = 'https://open.bigmodel.cn';

/**
 * Usage adapter for Zhipu (bigmodel.cn) provider.
 * Queries the /api/monitor/usage/quota/limit endpoint.
 *
 * The API returns TOKENS_LIMIT percentages for multiple time windows
 * (5h and weekly). The adapter returns the highest percentage,
 * as exhaustion in any window means the plan is unavailable.
 */
export class ZhipuUsageAdapter implements UsageAdapter {
  readonly providerId = 'zhipu';
  readonly cacheTTL = 300; // 5 minutes

  async queryUsage(apiKey: string): Promise<UsageResult> {
    const url = `${ZHIPU_BASE_DOMAIN}/api/monitor/usage/quota/limit`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Zhipu usage API returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      const body = (await response.json()) as ZhipuQuotaResponse;
      const limits = body?.data?.limits ?? [];

      // Extract TOKENS_LIMIT percentages
      const tokenLimits = limits.filter(
        (limit) => limit.type === 'TOKENS_LIMIT'
      );

      // Use the highest percentage across all windows
      const maxPercentage =
        tokenLimits.length > 0
          ? Math.max(...tokenLimits.map((l) => l.percentage))
          : 0;

      // Derive approximate used/limit from percentage
      // Since the API only gives percentages, we estimate limit=10000 units
      const estimatedLimit = 10000;
      const estimatedUsed = Math.round((maxPercentage / 100) * estimatedLimit);

      logger.debug('Zhipu usage queried', {
        percentage: maxPercentage,
        windowCount: tokenLimits.length,
      });

      return {
        used: estimatedUsed,
        limit: estimatedLimit,
        percentage: maxPercentage,
        raw: body,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Zhipu usage API returned HTTP')) {
        throw error;
      }
      throw new Error(
        `Failed to query Zhipu usage API: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
