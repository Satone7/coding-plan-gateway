import type { ThemeColors } from './theme/types';

export function formatCompactNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

export function getColor(percent: number, theme: ThemeColors): string {
  if (percent < 70) return theme.success;
  if (percent < 90) return theme.warning;
  return theme.error;
}

export function renderBar(percent: number, length: number = 10): string {
  const filledBlocks = Math.round((percent / 100) * length);
  const clampedFilled = Math.max(0, Math.min(filledBlocks, length));
  const emptyBlocks = length - clampedFilled;

  const filledChar = '▓';
  const emptyChar = '░';

  return filledChar.repeat(clampedFilled) + emptyChar.repeat(emptyBlocks);
}
