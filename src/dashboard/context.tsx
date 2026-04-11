import React, { createContext, useContext, useState, useMemo } from 'react';
import type { ThemeColors, ThemeName } from './theme/types';
import { resolveTheme, cycleThemeName, loadCustomTheme } from './theme';

interface ThemeContextValue {
  theme: ThemeColors;
  themeName: ThemeName;
  themeDisplayName: string;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): { name: ThemeName; colors: ThemeColors; displayName: string } {
  const envTheme = process.env.DASHBOARD_THEME as ThemeName | undefined;
  const custom = loadCustomTheme();

  if (custom && (envTheme === 'custom' || (!envTheme && custom))) {
    return { name: 'custom', colors: custom.colors, displayName: custom.name };
  }

  const resolved = resolveTheme(envTheme ?? 'tokyo-night');
  const displayName = envTheme ?? 'tokyo-night';
  return { name: resolved.name, colors: resolved.colors, displayName };
}

function getDisplayName(name: ThemeName): string {
  if (name === 'custom') {
    const custom = loadCustomTheme();
    return custom?.name ?? 'Custom';
  }
  const labels: Record<string, string> = {
    'tokyo-night': 'Tokyo Night',
    'catppuccin-mocha': 'Catppuccin',
    dracula: 'Dracula',
    nord: 'Nord',
  };
  return labels[name] ?? name;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => getInitialTheme(), []);
  const [themeName, setThemeName] = useState<ThemeName>(initial.name);
  const [themeDisplayName, setThemeDisplayName] = useState(initial.displayName);

  const theme = useMemo(() => {
    if (themeName === 'custom') {
      const custom = loadCustomTheme();
      if (custom) return custom.colors;
    }
    return resolveTheme(themeName).colors;
  }, [themeName]);

  const cycleTheme = () => {
    const next = cycleThemeName(themeName);
    setThemeName(next);
    setThemeDisplayName(getDisplayName(next));
  };

  const value = useMemo(
    () => ({ theme, themeName, themeDisplayName, cycleTheme }),
    [theme, themeName, themeDisplayName, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
