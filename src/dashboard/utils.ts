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
 * Render a bar with embedded label (like ▓▓EXACT░░).
 * The bar portion (excluding label) is 4 chars.
 *
 * @param percent - Percentage (0-100)
 * @param label - Label text (EXACT or GUESS)
 * @returns String like "▓▓EXACT░░"
 */
export function renderBarWithLabel(percent: number, label: 'EXACT' | 'GUESS'): string {
  const barLength = 4;
  const filled = Math.round((percent / 100) * barLength);
  const clampedFilled = Math.max(0, Math.min(filled, barLength));
  const empty = barLength - clampedFilled;

  return '▓'.repeat(clampedFilled) + label + '░'.repeat(empty);
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
