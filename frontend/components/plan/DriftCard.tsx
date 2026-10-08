"use client";

import NextLink from "next/link";
import { Link as MuiLink, Typography } from "@mui/material";
import { useDrift, type DriftItem } from "@/lib/plans";
import { Panel } from "@/components/ui/Panel";

const SHOWN = 3;

/** "AAPL is 7.2 points above its target, NVDA 6.1 below, and 2 more". */
export function driftSentence(items: DriftItem[]): string {
  const part = (d: DriftItem, i: number) => {
    const where = d.points >= 0 ? "above" : "below";
    const points = Math.abs(d.points).toFixed(1);
    return i === 0 ? `${d.ticker} is ${points} points ${where} its target` : `${d.ticker} ${points} ${where}`;
  };
  const shown = items.slice(0, SHOWN).map(part);
  const more = items.length - SHOWN;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")}${more > 0 ? "," : " and"} ${shown.at(-1)}` : shown[0];
  return more > 0 ? `${list} and ${more} more.` : `${list}.`;
}

/** Shows only when some holding has drifted from its target; silent while loading or on failure. */
export function DriftCard() {
  const { drift } = useDrift();
  if (!drift || drift.length === 0) return null;
  return (
    <Panel sx={{ p: "12px 14px", my: 1.5 }}>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Off target</Typography>
      <Typography sx={{ fontSize: 14, mt: 0.5 }}>{driftSentence(drift)}</Typography>
      <MuiLink component={NextLink} href="/portfolio/plan" sx={{ fontSize: 12.5, display: "inline-block", mt: 0.75 }}>
        Plan this month&apos;s contribution
      </MuiLink>
    </Panel>
  );
}
