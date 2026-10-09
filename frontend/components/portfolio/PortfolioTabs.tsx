"use client";

import Link from "next/link";
import { Box } from "@mui/material";
import { useOpenOrders } from "@/lib/plans";

export type PortfolioView = "holdings" | "month" | "saved" | "orders";

// `short` is the phone label; the full label stays the accessible name.
const VIEWS: { view: PortfolioView; label: string; short?: string; href: string }[] = [
  { view: "holdings", label: "Holdings", href: "/portfolio" },
  { view: "month", label: "This month", short: "Plan", href: "/portfolio/plan" },
  { view: "saved", label: "Saved plans", short: "Saved", href: "/portfolio/plan?tab=saved" },
  { view: "orders", label: "Orders", href: "/portfolio/plan?tab=orders" },
];

// The approved segmented control: a bordered pill track, the current view filled with the accent tint.
const SEGMENTED = {
  display: "flex",
  mb: 2,
  maxWidth: { md: 620 },
  p: "3px",
  border: "1px solid var(--line2)",
  borderRadius: "12px",
  "& a": {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: { xs: "4px", md: "7px" },
    py: 1,
    px: { xs: "2px", md: 1 },
    borderRadius: "9px",
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
    textDecoration: "none",
    color: "var(--muted)",
    "&[aria-current='page']": { bgcolor: "var(--up-bg)", color: "var(--accent)", fontWeight: 650 },
    "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: 1 },
  },
  "& [data-badge]": {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 22,
    height: 20,
    px: "6px",
    borderRadius: "999px",
    bgcolor: "var(--up-bg)",
    color: "var(--up)",
    fontSize: 12,
    fontWeight: 650,
    lineHeight: 1,
  },
  "& a[aria-current='page'] [data-badge]": { bgcolor: "var(--accent-solid)", color: "var(--on-accent)" },
} as const;

// Below md the long label is hidden (display only; both stay in the DOM and the link keeps its aria-label).
const FULL = { display: { xs: "none", md: "inline" } } as const;
const SHORT = { display: { xs: "inline", md: "none" } } as const;

/** Holdings | This month | Saved plans | Orders: the views of Portfolio, as links so each is deep-linkable. */
export function PortfolioTabs({ current }: { current: PortfolioView }) {
  // Hidden at 0, while loading and on error: openLines is 0 in all three.
  const { openLines } = useOpenOrders();
  return (
    <Box component="nav" aria-label="Portfolio views" sx={SEGMENTED}>
      {VIEWS.map(({ view, label, short, href }) => (
        <Link
          key={view}
          href={href}
          aria-current={view === current ? "page" : undefined}
          aria-label={short ? label : undefined}
        >
          {short ? (
            <>
              <Box component="span" aria-hidden sx={FULL}>
                {label}
              </Box>
              <Box component="span" aria-hidden sx={SHORT}>
                {short}
              </Box>
            </>
          ) : (
            label
          )}
          {view === "orders" && openLines > 0 && (
            <Box component="span" data-badge role="img" aria-label={`${openLines} open orders`}>
              <span aria-hidden>{openLines > 99 ? "99+" : openLines}</span>
            </Box>
          )}
        </Link>
      ))}
    </Box>
  );
}
