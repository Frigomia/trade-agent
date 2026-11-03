import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The title row every signed-in screen starts with: the page title (30px on a desktop, 26px on a
 * phone) and an optional one-line subtitle on the left, the page's actions and the round theme
 * toggle on the right. Mobile actions move to their own row so titles do not get squeezed.
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
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr) auto", md: "minmax(0, 1fr) auto auto" },
        alignItems: "start",
        columnGap: 1.5,
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
        <Box sx={{ gridColumn: { xs: "1 / -1", md: 2 }, gridRow: { xs: 2, md: 1 }, minWidth: 0, display: "flex", justifyContent: { md: "flex-end" }, "& > *": { maxWidth: "100%" } }}>
          {actions}
        </Box>
      )}
      <Box sx={{ gridColumn: { xs: 2, md: actions ? 3 : 2 }, gridRow: 1 }}>
        <ThemeToggle />
      </Box>
    </Box>
  );
}
