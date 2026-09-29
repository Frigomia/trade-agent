import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";

/**
 * Every color/shadow/radius here reads a CSS custom property (see app/globals.css) instead
 * of a literal value, so the theme never drifts from the tokens Tailwind classes also use.
 * `mode` only steers MUI's own contrast/elevation math; it does not select the actual colors.
 */
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
        main: "var(--accent-solid)",
        light: "var(--accent-solid)",
        dark: "var(--accent-solid)",
        contrastText: "var(--on-accent)",
      },
      success: { main: "var(--up)", light: "var(--up)", dark: "var(--up)", contrastText: "var(--on-accent)" },
      error: { main: "var(--down)", light: "var(--down)", dark: "var(--down)", contrastText: "var(--on-accent)" },
      warning: { main: "var(--warn)", light: "var(--warn)", dark: "var(--warn)", contrastText: "var(--on-accent)" },
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
