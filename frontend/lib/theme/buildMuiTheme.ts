import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";
import type { StatusColors } from "./readStatusColors";

/**
 * Every color/shadow/radius here reads a CSS custom property (see app/globals.css) instead
 * of a literal value, so the theme never drifts from the tokens the rest of the app also uses —
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
 *
 * The component overrides below follow docs/design/mockups (the `.tA` rules): tinted glass
 * panels with a soft ambient shadow, 14px-radius buttons with a glow on the primary one, inputs
 * with a static label above the field and an emerald focus ring, tinted callouts instead of
 * filled alerts, and segmented toggles.
 */
export function buildMuiTheme(mode: "light" | "dark", statusColors: StatusColors): MuiTheme {
  // light/dark/contrastText are set explicitly (even though light/dark repeat `main`) because
  // MUI's palette augmentation otherwise tries to compute them by parsing `main` as a literal
  // CSS color — which throws (MUI error #9) since these are var(--...) references it can't
  // decompose. The design spec has no separate light/dark shade for these tokens, so light/dark
  // reuse the same resolved value as main.
  const statusColor = (main: string, contrastText = statusColors.onAccent) => ({
    main,
    light: main,
    dark: main,
    contrastText,
  });

  const fieldFocus = {
    "&.Mui-focused": { boxShadow: "0 0 0 3px var(--up-bg)" },
    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
      borderColor: "var(--accent)",
      borderWidth: 1,
    },
  };

  return createTheme({
    palette: {
      mode,
      background: { default: statusColors.bgDefault, paper: statusColors.bgPaper },
      text: { primary: statusColors.textPrimary, secondary: statusColors.textSecondary },
      primary: statusColor(statusColors.accentSolid),
      success: statusColor(statusColors.up),
      error: statusColor(statusColors.down, "#ffffff"),
      warning: statusColor(statusColors.warn),
    },
    shape: { borderRadius: 18 },
    typography: {
      // The `geist` package's GeistSans.variable (applied to <html> in layout.tsx) is fixed
      // to `--font-geist-sans`, not `--font-geist` — confirmed in node_modules/geist/dist/sans.js.
      // Using the wrong name here isn't a build/lint/type error, it's a var() that silently
      // resolves to nothing, so font-family falls back to the browser default.
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      h5: { fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25 },
      h6: { fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em", lineHeight: 1.3 },
      subtitle2: { fontSize: 12.5, fontWeight: 600 },
      body1: { fontSize: 15, lineHeight: 1.45 },
      body2: { fontSize: 13.5, lineHeight: 1.45 },
      button: { fontSize: 15, fontWeight: 600, textTransform: "none" },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: "var(--panel)",
            backgroundImage: "none",
            border: "1px solid var(--line)",
            backdropFilter: "blur(20px)",
            boxShadow: "var(--shadow)",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: "var(--bg)",
            borderLeft: "1px solid var(--line2)",
            boxShadow: "var(--pop)",
            backdropFilter: "none",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: "var(--bg)",
            border: "1px solid var(--line2)",
            borderRadius: 20,
            boxShadow: "var(--pop)",
            backdropFilter: "none",
          },
        },
      },
      MuiBackdrop: {
        styleOverrides: { root: { backgroundColor: "var(--scrim)" } },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            textTransform: "none",
            fontSize: 15,
            fontWeight: 600,
            minHeight: 46,
            padding: "0 18px",
            boxShadow: "none",
            "&.Mui-disabled": { opacity: 0.45 },
          },
          sizeSmall: { minHeight: 36, padding: "0 14px", fontSize: 13.5, borderRadius: 11 },
          contained: {
            "&.MuiButton-colorPrimary": {
              boxShadow: "var(--btn-shadow)",
              "&:hover": { boxShadow: "var(--btn-shadow)", filter: "brightness(1.06)" },
              "&.Mui-disabled": { boxShadow: "none" },
            },
          },
          // The mockups' "no" button: a quiet panel with a hairline, not an accent outline.
          outlined: {
            "&.MuiButton-colorPrimary": {
              color: "var(--text)",
              backgroundColor: "var(--panel)",
              border: "1px solid var(--line)",
              "&:hover": { backgroundColor: "var(--panel)", borderColor: "var(--line2)" },
            },
          },
          text: { "&.MuiButton-colorPrimary": { color: "var(--accent)" } },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999, fontWeight: 600 },
          sizeSmall: { height: 26, fontSize: 12 },
          // A selected filter/range chip is a wash with accent text, never a filled emerald pill.
          colorPrimary: {
            backgroundColor: "var(--up-bg)",
            color: "var(--accent)",
            "&:hover": { backgroundColor: "var(--up-bg)" },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 13,
            backgroundColor: "var(--field)",
            fontSize: 15,
            ...fieldFocus,
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "var(--line2)" },
            "&.Mui-error": { boxShadow: "0 0 0 3px var(--down-bg)" },
            "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: "var(--down)" },
            "&.Mui-disabled": { backgroundColor: "var(--track)", color: "var(--muted)" },
          },
          input: { padding: "12px 14px" },
          sizeSmall: { "& .MuiOutlinedInput-input": { padding: "9px 12px" } },
          multiline: { padding: 0 },
          notchedOutline: {
            top: 0,
            borderColor: "var(--line)",
            // The label sits above the field (see MuiInputLabel), so there is no notch to cut.
            "& legend": { display: "none" },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          // `outlined`/`shrink` come after `root` in MUI's style order, so they win over its
          // absolute, transformed floating label.
          outlined: {
            position: "static",
            transform: "none",
            maxWidth: "100%",
            marginBottom: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--text2)",
            "&.Mui-focused": { color: "var(--text2)" },
            "&.Mui-error": { color: "var(--down)" },
          },
          shrink: { transform: "none" },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: { fontSize: 12, color: "var(--muted)", marginLeft: 0, marginTop: 6, lineHeight: 1.4 },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: {
            color: "var(--accent)",
            fontWeight: 600,
            textDecorationColor: "currentColor",
            textUnderlineOffset: "3px",
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            padding: "11px 13px",
            fontSize: 12.5,
            lineHeight: 1.45,
            color: "var(--text2)",
            alignItems: "flex-start",
            // An Alert is a Paper; the mockups' note is a flat tinted strip, not a raised pane.
            border: "none",
            boxShadow: "none",
            backdropFilter: "none",
          },
          icon: { padding: 0, marginRight: 10, marginTop: 1, fontSize: 17, opacity: 1 },
          message: { padding: 0 },
          standard: {
            "&.MuiAlert-colorInfo, &.MuiAlert-colorSuccess": {
              backgroundColor: "var(--up-bg)",
              "& .MuiAlert-icon": { color: "var(--accent)" },
            },
            "&.MuiAlert-colorWarning": {
              backgroundColor: "var(--warn-bg)",
              "& .MuiAlert-icon": { color: "var(--warn)" },
            },
            "&.MuiAlert-colorError": {
              backgroundColor: "var(--down-bg)",
              "& .MuiAlert-icon": { color: "var(--down)" },
            },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 6, borderRadius: 6, backgroundColor: "var(--track)" },
          bar: { borderRadius: 6 },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: 2,
            padding: 3,
            borderRadius: 12,
            backgroundColor: "var(--track)",
          },
          grouped: {
            margin: 0,
            border: "1px solid transparent",
            borderRadius: 9,
            "&:not(:first-of-type)": { borderRadius: 9, marginLeft: 0, border: "1px solid transparent" },
            "&:not(:last-of-type)": { borderRadius: 9 },
            "&.Mui-selected": { border: "1px solid var(--line)" },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontSize: 13,
            color: "var(--muted)",
            padding: "6px 12px",
            "&.Mui-selected, &.Mui-selected:hover": {
              backgroundColor: "var(--panel)",
              color: "var(--text)",
              fontWeight: 600,
              boxShadow: "var(--shadow)",
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: "1px solid var(--line)", fontSize: 13.5, padding: "14px 16px" },
          head: { fontSize: 12, fontWeight: 400, color: "var(--muted)", padding: "10px 16px" },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: "var(--line)" } },
      },
    },
  });
}
