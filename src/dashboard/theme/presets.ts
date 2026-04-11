import type { ThemeColors, ThemeName } from './types';

export const PRESETS: Record<Exclude<ThemeName, 'custom'>, ThemeColors> = {
  'tokyo-night': {
    brand: '#7DCFFF',
    success: '#9ECE6A',
    warning: '#E0AF68',
    error: '#F7768E',
    muted: '#565F89',
  },
  'catppuccin-mocha': {
    brand: '#89DCEB',
    success: '#A6E3A1',
    warning: '#F9E2AF',
    error: '#F38BA8',
    muted: '#6C7086',
  },
  dracula: {
    brand: '#8BE9FD',
    success: '#50FA7B',
    warning: '#F1FA8C',
    error: '#FF5555',
    muted: '#6272A4',
  },
  nord: {
    brand: '#88C0D0',
    success: '#A3BE8C',
    warning: '#EBCB8B',
    error: '#BF616A',
    muted: '#4C566A',
  },
};

export const THEME_NAMES: Exclude<ThemeName, 'custom'>[] = ['tokyo-night', 'catppuccin-mocha', 'dracula', 'nord'];
