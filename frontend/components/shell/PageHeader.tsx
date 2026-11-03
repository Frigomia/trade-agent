import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The title row every signed-in screen starts with: the page title (30px on a desktop, 26px on a
 * phone) and an optional one-line subtitle on the left, the page's actions and the round theme
 * toggle on the right. `wideActions` (a labelled button, not an icon) gives the actions their own
 * full-width row on a phone, so they cannot squeeze the title or push the theme toggle down.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  wideActions = false,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  wideActions?: boolean;
}) {
  // A grid, so the theme toggle is always the last column of the first row, top right, whatever the actions are.
  const own = Boolean(wideActions && actions);
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: actions && !own ? "minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto", md: actions ? "minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto" },
        alignItems: "start",
        columnGap: 1,
        rowGap: 1.5,
        mb: 2.5,
      }}
    >
      <Box sx={{ minWidth: 0, gridColumn: 1, gridRow: 1 }}>
        <Typography
          variant="h5"
          component="h1"
          sx={{ fontSize: { xs: "1.625rem", md: "1.875rem" }, letterSpacing: "-0.025em", lineHeight: 1.15 }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", mt: 0.5 }}>{subtitle}</Typography>
        )}
      </Box>
      {actions && (
        <Box
          sx={{
            gridColumn: { xs: own ? "1 / -1" : 2, md: 2 },
            gridRow: { xs: own ? 2 : 1, md: 1 },
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            ...(own && { flexWrap: "wrap", "& > *": { maxWidth: "100%", flex: { xs: "1 1 100%", md: "none" } } }),
          }}
        >
          {actions}
        </Box>
      )}
      <Box sx={{ gridColumn: "-2 / -1", gridRow: 1 }}>
        <ThemeToggle />
      </Box>
    </Box>
  );
}
