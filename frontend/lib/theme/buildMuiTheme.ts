import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";

/**
 * Every color/shadow/radius here reads a CSS custom property (see app/globals.css) instead
 * of a literal value, so the theme never drifts from the tokens Tailwind classes also use.
 * `mode` only steers MUI's own contrast/elevation math; it does not select the actual colors.
 */
// Literal per-mode mirrors of the accent/up/down/warn tokens in app/globals.css, used only as
// `palette.*.main`. Some MUI components (e.g. ListItemButton's `.selected`/hover styles) call
// theme.alpha()/decomposeColor() on `main` while building their static styles, which throws
// (MUI error #9) on a var(--...) reference it can't parse as a literal color. Every *rendered*
// color in this app still comes from the CSS var (via `light`/`dark`/`contrastText` below, and
// every styleOverride in this file) — `main` here only feeds that internal color math and must
// be kept in sync with globals.css by hand if those tokens change.
const ACCENT_MAIN = { light: "#067a52", dark: "#34e7a9" };
const UP_MAIN = { light: "#067a52", dark: "#34e7a9" };
const DOWN_MAIN = { light: "#c8323d", dark: "#ff6b72" };
const WARN_MAIN = { light: "#9a5b00", dark: "#f4c04f" };

export function buildMuiTheme(mode: "light" | "dark"): MuiTheme {
  return createTheme({
    palette: {
      mode,
      background: { default: "var(--bg)", paper: "var(--panel)" },
      text: { primary: "var(--text)", secondary: "var(--text2)" },
      // light/dark/contrastText are set explicitly (even though they repeat `main`) because
      // MUI's palette augmentation otherwise tries to compute them by parsing `main` as a
      // literal CSS color — which throws (MUI error #9) since these are var(--...) references
      // it can't decompose. The design spec has no separate light/dark shade for these tokens.
      primary: {
        main: ACCENT_MAIN[mode],
        light: "var(--accent-solid)",
        dark: "var(--accent-solid)",
        contrastText: "var(--on-accent)",
      },
      success: {
        main: UP_MAIN[mode],
        light: "var(--up)",
        dark: "var(--up)",
        contrastText: "var(--on-accent)",
      },
      error: {
        main: DOWN_MAIN[mode],
        light: "var(--down)",
        dark: "var(--down)",
        contrastText: "var(--on-accent)",
      },
      warning: {
        main: WARN_MAIN[mode],
        light: "var(--warn)",
        dark: "var(--warn)",
        contrastText: "var(--on-accent)",
      },
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
