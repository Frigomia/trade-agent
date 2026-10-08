import Link from "next/link";
import { Box } from "@mui/material";

export type PortfolioView = "holdings" | "month" | "saved";

const VIEWS: { view: PortfolioView; label: string; href: string }[] = [
  { view: "holdings", label: "Holdings", href: "/portfolio" },
  { view: "month", label: "This month", href: "/portfolio/plan" },
  { view: "saved", label: "Saved plans", href: "/portfolio/plan?tab=saved" },
];

// The approved segmented control: a bordered pill track, the current view filled with the accent tint.
const SEGMENTED = {
  display: "flex",
  mb: 2,
  maxWidth: { md: 480 },
  p: "3px",
  border: "1px solid var(--line2)",
  borderRadius: "12px",
  "& a": {
    flex: 1,
    textAlign: "center",
    py: 1,
    px: 1,
    borderRadius: "9px",
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
    textDecoration: "none",
    color: "var(--muted)",
    "&[aria-current='page']": { bgcolor: "var(--up-bg)", color: "var(--accent)", fontWeight: 650 },
    "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: 1 },
  },
} as const;

/** Holdings | This month | Saved plans: the three views of Portfolio, as links so each is deep-linkable. */
export function PortfolioTabs({ current }: { current: PortfolioView }) {
  return (
    <Box component="nav" aria-label="Portfolio views" sx={SEGMENTED}>
      {VIEWS.map(({ view, label, href }) => (
        <Link key={view} href={href} aria-current={view === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </Box>
  );
}
