"use client";

import Link from "next/link";
import { Box } from "@mui/material";
import { useOpenOrders } from "@/lib/plans";

export type PortfolioView = "holdings" | "month" | "saved" | "orders";

// `short` is the phone label.
const VIEWS: { view: PortfolioView; label: string; short?: string; href: string }[] = [
  { view: "holdings", label: "Holdings", href: "/portfolio" },
  { view: "month", label: "This month", short: "Plan", href: "/portfolio/plan" },
  { view: "saved", label: "Saved plans", short: "Saved", href: "/portfolio/plan?tab=saved" },
  { view: "orders", label: "Orders", href: "/portfolio/plan?tab=orders" },
];

// The approved Explorer segmented control: a rounded track, the current view a raised panel-coloured
// pill with the accent text. On a phone the four views share the full width.
const SEGMENTED = {
  display: { xs: "grid", md: "flex" },
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "4px",
  mb: 2,
  p: "4px",
  width: { xs: "100%", md: "max-content" },
  maxWidth: "100%",
  borderRadius: 999,
  bgcolor: "var(--track)",
  "& a": {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: { xs: "4px", md: "7px" },
    minHeight: { xs: 44, md: 36 },
    px: { xs: "4px", md: "18px" },
    borderRadius: 999,
    fontSize: { xs: "0.75rem", md: "0.875rem" },
    fontWeight: 500,
    whiteSpace: "nowrap",
    textDecoration: "none",
    color: "var(--text2)",
    "&[aria-current='page']": { bgcolor: "var(--panel)", color: "var(--accent)", fontWeight: 650, boxShadow: "var(--shadow)" },
    "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: 1 },
  },
  "& [data-badge]": {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 22,
    height: 20,
    px: "6px",
    borderRadius: "999px",
    bgcolor: "var(--accent-wash)",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 650,
    lineHeight: 1,
  },
  "& a[aria-current='page'] [data-badge]": { bgcolor: "var(--accent-solid)", color: "var(--on-accent)" },
} as const;

// Below md the long label is hidden and the short one shown (display: none drops the hidden one from
// the accessible name, so the name is the visible text at every width).
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
          aria-label={view === "orders" && openLines > 0 ? `Orders, ${openLines} open order${openLines === 1 ? "" : "s"}` : undefined}
        >
          {short ? (
            <>
              <Box component="span" sx={FULL}>
                {label}
              </Box>
              <Box component="span" sx={SHORT}>
                {short}
              </Box>
            </>
          ) : (
            label
          )}
          {view === "orders" && openLines > 0 && (
            <Box component="span" data-badge aria-hidden>
              {openLines > 99 ? "99+" : openLines}
            </Box>
          )}
        </Link>
      ))}
    </Box>
  );
}
