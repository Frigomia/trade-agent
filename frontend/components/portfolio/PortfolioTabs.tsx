"use client";

import { type Segment, SegmentedControl } from "@/components/ui/SegmentedControl";
import { useOpenOrders } from "@/lib/plans";

export type PortfolioView = "holdings" | "month" | "saved" | "orders";

// `short` is the phone label.
const VIEWS: { key: PortfolioView; label: string; short?: string; href: string }[] = [
  { key: "holdings", label: "Holdings", href: "/portfolio" },
  { key: "month", label: "This month", short: "Plan", href: "/portfolio/plan" },
  { key: "saved", label: "Saved plans", short: "Saved", href: "/portfolio/plan?tab=saved" },
  { key: "orders", label: "Orders", href: "/portfolio/plan?tab=orders" },
];

/** Holdings | This month | Saved plans | Orders: the views of Portfolio, as links so each is deep-linkable. */
export function PortfolioTabs({ current }: { current: PortfolioView }) {
  // Hidden at 0, while loading and on error: openLines is 0 in all three.
  const { openLines } = useOpenOrders();
  const segments: Segment[] = VIEWS.map((v) =>
    v.key === "orders" && openLines > 0
      ? { ...v, count: openLines > 99 ? "99+" : openLines, alert: true, ariaLabel: `Orders, ${openLines} open order${openLines === 1 ? "" : "s"}` }
      : v,
  );
  return <SegmentedControl label="Portfolio views" segments={segments} value={current} fill sx={{ mb: 2 }} />;
}
