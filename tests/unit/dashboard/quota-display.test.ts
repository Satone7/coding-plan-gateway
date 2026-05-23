import { describe, expect, it } from 'vitest';
import { getQuotaDisplay } from '@/dashboard/quota-display';

describe('getQuotaDisplay', () => {
  it('should prefer provider summary over percentage windows', () => {
    const result = getQuotaDisplay(
      {
        windows: [
          { type: 'TOKENS_LIMIT', percentage: 87, windowLabel: '5h' },
        ],
        summary: {
          mode: 'balance',
          value: '¥12.34',
        },
        lastUpdated: new Date().toISOString(),
      },
      undefined
    );

    expect(result).toEqual({
      kind: 'summary',
      text: '¥12.34',
      colorPercent: 0,
    });
  });

  it('should fall back to provider windows when no summary exists', () => {
    const result = getQuotaDisplay(
      {
        windows: [
          { type: 'TOKENS_LIMIT', percentage: 42, windowLabel: '5h' },
        ],
        lastUpdated: new Date().toISOString(),
      },
      undefined
    );

    expect(result.kind).toBe('windows');
    expect(result.windows).toHaveLength(1);
  });

  it('should fall back to local quota when no provider data exists', () => {
    const result = getQuotaDisplay(undefined, {
      percentage: 35,
      resetAt: '2026-05-23T12:30:00.000Z',
      limit: 100,
      used: 35,
    });

    expect(result).toEqual({
      kind: 'local',
      percentage: 35,
      resetAt: '2026-05-23T12:30:00.000Z',
    });
  });
});
