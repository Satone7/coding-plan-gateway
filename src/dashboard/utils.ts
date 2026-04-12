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

/**
 * Calculate bar layout with centered label.
 * Progress flows left-to-right across all 7 positions: [2 bar chars][GUESS][2 bar chars]
 * Each position is covered or not based on percentage.
 *
 * @param percent - Percentage (0-100)
 * @param label - Label length (5 for EXACT/GUESS)
 * @returns Array of 7 items: each is { filled: boolean, char: string }
 *   - positions 0,1: ▓ or ░
 *   - positions 2-6: label characters
 *   - positions 7,8: ▓ or ░
 */
export function calcBarLayout(
  percent: number,
  label: string
): Array<{ filled: boolean; char: string }> {
  const totalPositions = 2 + label.length + 2; // 9 for EXACT/GUESS
  const filledCount = Math.round((percent / 100) * totalPositions);

  const result: Array<{ filled: boolean; char: string }> = [];

  // Left 2 bar positions
  for (let i = 0; i < 2; i++) {
    result.push({
      filled: i < filledCount,
      char: i < filledCount ? '▓' : '░',
    });
  }

  // Label positions
  for (let i = 0; i < label.length; i++) {
    const positionIndex = 2 + i;
    result.push({
      filled: positionIndex < filledCount,
      char: label.charAt(i),
    });
  }

  // Right 2 bar positions
  for (let i = 0; i < 2; i++) {
    const positionIndex = 2 + label.length + i;
    result.push({
      filled: positionIndex < filledCount,
      char: positionIndex < filledCount ? '▓' : '░',
    });
  }

  return result;
}

/**
 * Format reset time compactly.
 * Returns HH:MM if today, MM.DD-HH:MM otherwise.
 *
 * @param nextResetTimeMs - Millisecond timestamp of next reset
 * @returns Compact string like "22:04" or "04.15-08:00"
 */
export function formatResetTime(nextResetTimeMs: number): string {
  const resetDate = new Date(nextResetTimeMs);
  const now = new Date();

  const hours = resetDate.getHours().toString().padStart(2, '0');
  const minutes = resetDate.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  // Check if same day
  if (
    resetDate.getFullYear() === now.getFullYear() &&
    resetDate.getMonth() === now.getMonth() &&
    resetDate.getDate() === now.getDate()
  ) {
    return timeStr;
  }

  // Different day: show MM.DD-HH:MM
  const month = (resetDate.getMonth() + 1).toString().padStart(2, '0');
  const day = resetDate.getDate().toString().padStart(2, '0');
  return `${month}.${day}-${timeStr}`;
}

/**
 * Format reset time from ISO string.
 *
 * @param isoString - ISO datetime string or null
 * @returns Compact string like "22:04" or "04.15-08:00", or empty string if null
 */
export function formatResetTimeFromIso(isoString: string | null): string {
  if (!isoString) return '';
  const timestamp = new Date(isoString).getTime();
  return formatResetTime(timestamp);
}
