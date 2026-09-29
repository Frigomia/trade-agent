export interface StatusColors {
  accentSolid: string;
  up: string;
  down: string;
  warn: string;
  onAccent: string;
  textPrimary: string;
  textSecondary: string;
  bgDefault: string;
  bgPaper: string;
}

// Used before the DOM-reading effect below has run (first render / SSR), matching the dark
// theme's own literal values in app/globals.css so there's no flash of the wrong color.
export const DEFAULT_STATUS_COLORS: StatusColors = {
  accentSolid: "#34e7a9",
  up: "#34e7a9",
  down: "#ff6b72",
  warn: "#f4c04f",
  onAccent: "#032116",
  textPrimary: "#e7f3ef",
  textSecondary: "#cfe2dc",
  bgDefault: "#060d0c",
  bgPaper: "rgba(255, 255, 255, 0.035)",
};

// Resolves the live values of the handful of CSS custom properties buildMuiTheme needs as
// parseable literal colors (see buildMuiTheme.ts for why) by reading them off the DOM, so
// app/globals.css stays the single source of truth instead of being hand-copied here.
export function readStatusColors(): StatusColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    accentSolid: read("--accent-solid", DEFAULT_STATUS_COLORS.accentSolid),
    up: read("--up", DEFAULT_STATUS_COLORS.up),
    down: read("--down", DEFAULT_STATUS_COLORS.down),
    warn: read("--warn", DEFAULT_STATUS_COLORS.warn),
    onAccent: read("--on-accent", DEFAULT_STATUS_COLORS.onAccent),
    textPrimary: read("--text", DEFAULT_STATUS_COLORS.textPrimary),
    textSecondary: read("--text2", DEFAULT_STATUS_COLORS.textSecondary),
    bgDefault: read("--bg", DEFAULT_STATUS_COLORS.bgDefault),
    bgPaper: read("--panel", DEFAULT_STATUS_COLORS.bgPaper),
  };
}
