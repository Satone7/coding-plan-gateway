# High-Density Dashboard Design

## Overview
This document specifies the design for a new High-Density Layout for the Coding Plan Gateway Dashboard. The goal is to maximize the terminal space by utilizing full-width sections, inline bar charts, compact number formatting, and a multi-view navigation system to reduce visual clutter while providing more actionable data.

## Architecture & Layout
- **Framework**: React with `ink` for terminal rendering.
- **State Management**: Introduce `currentView` state (`'home' | 'plans' | 'models' | 'keys' | 'health'`).
- **Navigation**: Listen for keystrokes (`1`, `2`, `3`, `4`, `H`, `E`, `Q`) using `useInput`.
- **Layout Approach**: 
  - Remove all border boxes (`borderStyle="single"`).
  - Use custom text dividers `────────────────────` spanning `stdout.columns` width.
  - Eliminate unnecessary margins and padding.

## Views

### Global Header (All Views)
- First row: Title on the left, current time on the right.
- Second row: Full-width divider line `══════════════════════════════════════════════════════════════════`.
- Third row: Global Stats (Active, Completed, Failed) on the left, Navigation hints `[Press 1-4: Plans|Models|Keys|Help]` on the right.

### Home View (Default)
1. **Active Requests**
   - Section header: `⏳ ACTIVE REQUESTS ───────────────────────────────────`.
   - Rows: Duration (e.g., `12s`), API Key, Model, Plan, Score, URL.
   - Truncation on long text (like URL).
2. **Errors**
   - Section header: `🚨 ERRORS (N) ──────────────────────────────────────────`.
   - Rows: Top 2-3 recent errors prefixed with `[WARN]` or `[ERROR]`.
3. **Usage Summaries**
   - Section header: `📈 USAGE BY PLAN ───────────────────────────────────────`.
   - Top 3 plans shown using inline bar charts.
   - Section header: `📈 USAGE BY MODEL ──────────────────────────────────────`.
   - Top 3 models shown using inline bar charts (horizontal wrap if space allows).
4. **Footer Navigation**
   - `[1]Plans  [2]Models  [3]API Keys  [4]Health  [E]Errors  [Q]Quit`

### Detailed Views
- **Plans (Key 1)**: Full list of plans, including exact requests, token usage, and semantic bar charts for quota/token consumption.
- **Models (Key 2)**: Full list of models sorted by request/token volume.
- **API Keys (Key 3)**: Full list of keys sorted by request/token volume.
- **Health (Key 4)**: Basic system connection state, latency (mocked if not available in state), uptime.

## Components & Utilities

### Utilities
- `formatCompactNumber(num)`: Formats numbers concisely (e.g., `1200000` -> `1.2M`, `800` -> `800`).
- `renderBar(percent, length=10)`: Generates a string of block characters. E.g., `80%` -> `▓▓▓▓▓▓▓▓░░`.
- `getColor(percent)`: Returns semantic color for the bar based on thresholds:
  - `< 70%`: Green
  - `70% - 90%`: Yellow
  - `> 90%`: Red

### Components
- **`Divider`**: A simple component that renders `─` repeated `columns` times.
- **`InlineBar`**: Takes a label, current value, max value, and renders the text + semantic bar.

## Trade-offs & Considerations
- **Terminal Resize**: Dividers must dynamically recalculate on resize. We already have `stdout.columns` in state, so we will bind divider length to it.
- **Accessibility**: Relying on `▓` and `░` might not render perfectly in every single terminal emulator, but it is standard enough for most modern ones (iTerm2, Terminal.app, Windows Terminal).
