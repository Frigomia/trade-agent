"use client";

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { SquareCheckBig } from "lucide-react";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: "12px",
        bgcolor: "var(--accent-solid)",
        color: "var(--on-accent)",
        display: "grid",
        placeItems: "center",
        flex: "none",
      }}
    >
      <SquareCheckBig size={Math.round(size * 0.52)} strokeWidth={1.75} />
    </Box>
  );
}

const ADVISORY = "Advisory information only, not investment advice.";

/**
 * The frame every signed-out screen shares (login, reset, accept invitation): the brand, the theme
 * toggle, one centred form column, and the advisory line. From the md breakpoint a brand panel
 * with the product's one-line promise fills the left half, as in the auth mockups.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex" }}>
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          width: "44%",
          maxWidth: 560,
          p: 5,
          borderRight: "1px solid var(--line)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <BrandMark />
          <Typography sx={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>
            trade-agent
          </Typography>
        </Box>
        <Box>
          <Typography
            component="p"
            sx={{ fontSize: 30, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1.15 }}
          >
            It shows its work, remembers how past calls turned out, and never places a trade.
          </Typography>
          <Typography sx={{ color: "var(--text2)", mt: 2, maxWidth: "36ch" }}>
            An advisory-only reasoning partner. You stay the decision-maker.
          </Typography>
          <Typography sx={{ color: "var(--muted)", fontSize: 12, mt: 4 }}>{ADVISORY}</Typography>
        </Box>
      </Box>
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          px: { xs: 2.5, md: 5 },
          pt: 1.5,
          pb: 2,
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <ThemeToggle />
        </Box>
        <Box
          sx={{
            flex: 1,
            width: "100%",
            maxWidth: 380,
            mx: "auto",
            pt: { xs: 4, md: 12 },
          }}
        >
          {children}
        </Box>
        <Typography
          sx={{
            display: { xs: "block", md: "none" },
            fontSize: 11.5,
            color: "var(--muted)",
            textAlign: "center",
            pb: 1,
          }}
        >
          {ADVISORY}
        </Typography>
      </Box>
    </Box>
  );
}

/** The phone-only brand tile above a form heading (the desktop brand lives in the left panel). */
export function AuthHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <Box>
      <Box sx={{ display: { xs: "block", md: "none" }, mb: 2.25 }}>
        <BrandMark />
      </Box>
      <Typography
        variant="h5"
        component="h1"
        sx={{ fontSize: 28, letterSpacing: "-0.03em", lineHeight: 1.15 }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography sx={{ color: "var(--muted)", mt: 0.5, fontSize: 14.5 }}>{subtitle}</Typography>
      )}
    </Box>
  );
}
