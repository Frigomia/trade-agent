import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import ToggleButton from "@mui/material/ToggleButton";
import { buildMuiTheme } from "./buildMuiTheme";
import { DEFAULT_STATUS_COLORS, type StatusColors } from "./readStatusColors";

// Matches app/globals.css's :root[data-theme="light"] token values — this test doesn't exercise
// readStatusColors' DOM reading, just that buildMuiTheme's output is safe for MUI to render.
const LIGHT_STATUS_COLORS: StatusColors = {
  accentSolid: "#067a52",
  up: "#067a52",
  down: "#c8323d",
  warn: "#9a5b00",
  onAccent: "#ffffff",
  textPrimary: "#0b1f19",
  textSecondary: "#29473c",
  bgDefault: "#f2f8f5",
  bgPaper: "rgba(255, 255, 255, 0.78)",
};

describe.each([
  ["dark", DEFAULT_STATUS_COLORS],
  ["light", LIGHT_STATUS_COLORS],
] as const)("buildMuiTheme(%s)", (mode, statusColors) => {
  const theme = buildMuiTheme(mode, statusColors);

  // Each of these components reads a palette field (text.primary, background.default, or a
  // light/dark shade) through theme.alpha()/emphasize() at render time, which throws
  // "MUI: Unsupported var(...) color" if that field is still a raw CSS custom-property string
  // instead of a literal color (see buildMuiTheme.ts's doc comment). This is the regression test
  // for that crash.
  it.each([
    ["Button", () => <Button>Click</Button>],
    ["Chip", () => <Chip label="Chip" />],
    ["Alert", () => <Alert severity="success">Alert</Alert>],
    ["Snackbar", () => <Snackbar open message="Snack" />],
    ["Link", () => <Link href="#">Link</Link>],
    ["Skeleton", () => <Skeleton />],
    ["ToggleButton", () => <ToggleButton value="a">A</ToggleButton>],
  ])("renders %s without throwing", (_name, renderChild) => {
    expect(() => render(<MuiThemeProvider theme={theme}>{renderChild()}</MuiThemeProvider>)).not.toThrow();
  });
});
