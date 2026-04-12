import fs from 'node:fs';
import path from 'node:path';
import type { ThemeColors, ThemeName } from './types';
import { PRESETS, THEME_NAMES } from './presets';

const CUSTOM_THEME_FILE = 'dashboard-theme.json';

function findThemeFile(): string | null {
  const p = path.resolve(process.cwd(), CUSTOM_THEME_FILE);
  if (fs.existsSync(p)) return p;
  return null;
}

export function loadCustomTheme(): { name: string; colors: ThemeColors } | null {
  const filePath = findThemeFile();
  if (!filePath) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const colors = raw.colors ?? raw;
    if (colors.brand && colors.success && colors.warning && colors.error && colors.muted) {
      return { name: raw.name ?? 'custom', colors: colors as ThemeColors };
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveTheme(name: ThemeName): { name: ThemeName; colors: ThemeColors } {
  if (name === 'custom') {
    const custom = loadCustomTheme();
    if (custom) return { name: 'custom', colors: custom.colors };
  }

  const presetColors = (PRESETS as Record<string, ThemeColors>)[name];
  if (presetColors) {
    return { name, colors: presetColors };
  }

  return { name: 'tokyo-night', colors: PRESETS['tokyo-night'] };
}

export function cycleThemeName(current: ThemeName): ThemeName {
  const names = [...THEME_NAMES];
  const idx = names.indexOf(current as Exclude<ThemeName, 'custom'>);
  const next = names[(idx + 1) % names.length]!;
  return next;
}

export { THEME_NAMES, PRESETS };
