import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The title row every signed-in screen starts with: the page title (30px on a desktop, 26px on a
 * phone) and an optional one-line subtitle on the left, the page's actions and the round theme
 * toggle on the right.
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
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 2.5, flexWrap: "wrap" }}>
      <Box sx={{ flex: "1 1 180px", minWidth: 0 }}>
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
      {actions}
      <ThemeToggle />
    </Box>
  );
}
