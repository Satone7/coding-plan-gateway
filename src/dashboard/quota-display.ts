import type { ProviderUsageData, LocalQuotaData } from './hooks/useDashboardState';

export type QuotaDisplay =
  | {
      kind: 'summary';
      text: string;
      colorPercent: number;
    }
  | {
      kind: 'windows';
      windows: ProviderUsageData['windows'];
    }
  | {
      kind: 'local';
      percentage: number;
      resetAt: string | null;
    }
  | {
      kind: 'none';
    };

export function getQuotaDisplay(
  providerData?: ProviderUsageData,
  localQuotaData?: LocalQuotaData
): QuotaDisplay {
  if (providerData?.summary) {
    return {
      kind: 'summary',
      text: providerData.summary.value,
      colorPercent: 0,
    };
  }

  if (providerData && providerData.windows.length > 0) {
    return {
      kind: 'windows',
      windows: providerData.windows,
    };
  }

  if (localQuotaData) {
    return {
      kind: 'local',
      percentage: localQuotaData.percentage,
      resetAt: localQuotaData.resetAt,
    };
  }

  return { kind: 'none' };
}
