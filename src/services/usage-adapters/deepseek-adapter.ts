/**
 * DeepSeek Usage Adapter.
 * Queries the official DeepSeek balance API for account balance display.
 */

import type { UsageAdapter, UsageResult } from '@/types';

interface DeepseekBalanceInfo {
  currency?: string;
  total_balance?: string;
}

interface DeepseekBalanceResponse {
  balance_infos?: DeepseekBalanceInfo[];
}

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
};

function formatBalance(info?: DeepseekBalanceInfo): string {
  const currency = info?.currency ?? '?';
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const totalBalance = info?.total_balance ?? '0';
  return `${symbol}${totalBalance}`;
}

export class DeepseekUsageAdapter implements UsageAdapter {
  readonly providerId = 'deepseek';
  readonly cacheTTL = 300;

  async queryUsage(apiKey: string): Promise<UsageResult> {
    try {
      const response = await fetch(DEEPSEEK_BALANCE_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Deepseek balance API returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      const body = (await response.json()) as DeepseekBalanceResponse;

      return {
        used: 0,
        limit: 0,
        percentage: 0,
        windows: [],
        summary: {
          mode: 'balance',
          value: formatBalance(body.balance_infos?.[0]),
        },
        raw: body,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Deepseek balance API returned HTTP')) {
        throw error;
      }
      throw new Error(
        `Failed to query Deepseek balance API: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
