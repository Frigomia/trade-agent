import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The title row every signed-in screen starts with, as in the mockups: the page title (and an
 * optional quiet subtitle) on the left, the page's actions and the round theme toggle on the right.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
      <Box sx={{ flex: "1 1 180px", minWidth: 0 }}>
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        {subtitle && <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</Typography>}
      </Box>
      {actions}
      <ThemeToggle />
    </Box>
  );
}
