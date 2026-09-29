import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";
import type { StatusColors } from "./readStatusColors";

/**
 * Every color/shadow/radius here reads a CSS custom property (see app/globals.css) instead
 * of a literal value, so the theme never drifts from the tokens Tailwind classes also use —
 * with one exception: `statusColors.*`. MUI's stock components call theme.alpha()/emphasize()/
 * decomposeColor() on several palette fields at render time (not just at theme-creation time) —
 * not only `.main` (Button/Chip/Link/Skeleton/ToggleButton all touch `text.primary`,
 * Snackbar touches `background.default`, Alert touches a `light`/`dark` field) — which throws
 * (MUI error #9, "Unsupported var(...) color") on a var(--...) reference it can't parse as a
 * literal color. So every field below that MUI itself reads as a color needs an actual literal
 * value. `statusColors` is how the caller supplies these: ThemeProvider resolves them from the
 * same CSS custom properties at runtime (see readStatusColors.ts), so app/globals.css stays the
 * single source of truth instead of the values being hand-copied into this file. Everywhere
 * else (styleOverrides, borders, etc.) stays on the CSS var and responds live to a theme toggle
 * without this module knowing. `mode` only steers MUI's own contrast/elevation math; it does
 * not select the actual colors.
 */
export function buildMuiTheme(mode: "light" | "dark", statusColors: StatusColors): MuiTheme {
  // light/dark/contrastText are set explicitly (even though light/dark repeat `main`) because
  // MUI's palette augmentation otherwise tries to compute them by parsing `main` as a literal
  // CSS color — which throws (MUI error #9) since these are var(--...) references it can't
  // decompose. The design spec has no separate light/dark shade for these tokens, so light/dark
  // reuse the same resolved value as main.
  const statusColor = (main: string) => ({
    main,
    light: main,
    dark: main,
    contrastText: statusColors.onAccent,
  });

  return createTheme({
    palette: {
      mode,
      background: { default: statusColors.bgDefault, paper: statusColors.bgPaper },
      text: { primary: statusColors.textPrimary, secondary: statusColors.textSecondary },
      primary: statusColor(statusColors.accentSolid),
      success: statusColor(statusColors.up),
      error: statusColor(statusColors.down),
      warning: statusColor(statusColors.warn),
    },
    shape: { borderRadius: 18 },
    typography: {
      // The `geist` package's GeistSans.variable (applied to <html> in layout.tsx) is fixed
      // to `--font-geist-sans`, not `--font-geist` — confirmed in node_modules/geist/dist/sans.js.
      // Using the wrong name here isn't a build/lint/type error, it's a var() that silently
      // resolves to nothing, so font-family falls back to the browser default.
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: "var(--panel)",
            border: "1px solid var(--line)",
            backdropFilter: "blur(20px)",
            boxShadow: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: "var(--panel)",
            borderLeft: "1px solid var(--line)",
            backdropFilter: "blur(20px)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999 },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 14, textTransform: "none" },
        },
      },
    },
  });
}
