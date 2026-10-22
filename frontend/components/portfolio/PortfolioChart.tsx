"use client";

import { useId, useState, type ReactNode } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import type { Snapshot } from "@/lib/api/portfolio-types";
import { toTime } from "@/lib/format";

const RANGES = [
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
] as const;
type RangeLabel = (typeof RANGES)[number]["label"];

export { toTime };

// One point per UTC day (the day's last snapshot), oldest first.
export function collapseByDay(snapshots: Snapshot[]): Snapshot[] {
  const byDay = new Map<string, Snapshot>();
  const ordered = [...snapshots].sort(
    (a, b) => toTime(a.created_at) - toTime(b.created_at) || a.id - b.id,
  );
  for (const snapshot of ordered) {
    byDay.set(snapshot.created_at.slice(0, 10), snapshot);
  }
  return [...byDay.values()];
}

// The plot is this tall; the value labels on its left and the date labels under it line up with it.
const PLOT_HEIGHT = 130;
const DAY = 86_400_000;

// Spelled out, not from the locale: some English locales write "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** "18.9k": the value scale is read at a glance, so it is not printed in full. */
const axisText = (value: number) => COMPACT.format(value).toLowerCase();

/**
 * Up to six evenly spaced dates for under the plot: the month ("Nov") when the chart covers a few
 * months, the day and month ("12 Oct") for a shorter one. A label that repeats the one before it
 * is left out.
 */
function dateTicks(points: Snapshot[]): { at: number; text: string }[] {
  const times = points.map((p) => toTime(p.created_at));
  const months = (times[times.length - 1] - times[0]) / DAY >= 120;
  const count = Math.min(6, points.length);
  const ticks: { at: number; text: string }[] = [];
  for (let k = 0; k < count; k++) {
    const i = Math.round((k * (points.length - 1)) / Math.max(1, count - 1));
    const date = new Date(times[i]);
    const text = months ? MONTHS[date.getUTCMonth()] : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
    if (ticks.length === 0 || ticks[ticks.length - 1].text !== text) ticks.push({ at: i / (points.length - 1), text });
  }
  return ticks;
}

const axisLabel = { fontSize: "0.75rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums", lineHeight: 1 } as const;

export function PortfolioChart({
  snapshots,
  variant = "full",
  heading,
}: {
  snapshots: Snapshot[];
  variant?: "full" | "sparkline";
  /** The title, shown on the left of the same row as the range control. */
  heading?: ReactNode;
}) {
  const [range, setRange] = useState<RangeLabel>("1Y");
  const [now] = useState(() => Date.now());
  const fade = useId();
  const full = variant === "full";

  const days = RANGES.find((r) => r.label === range)?.days ?? null;
  const cutoff = full && days !== null ? now - days * DAY : -Infinity;
  const points = collapseByDay(snapshots).filter((s) => toTime(s.created_at) >= cutoff);

  // The approved range control: a rounded track, the chosen range a raised panel pill. It shares a row
  // with the title, which sits on the left.
  const header = full && (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, minWidth: 0 }}>
      {heading}
      <Box role="group" aria-label="Chart range" sx={{ display: "inline-flex", gap: "2px", ml: "auto", p: "3px", borderRadius: 999, bgcolor: "var(--track)" }}>
        {RANGES.map((r) => {
          const on = range === r.label;
          return (
            <ButtonBase
              key={r.label}
              aria-pressed={on}
              onClick={() => setRange(r.label)}
              sx={{ minWidth: 36, minHeight: { xs: 44, md: 28 }, px: 1, borderRadius: 999, fontSize: "0.75rem", fontWeight: on ? 650 : 500, color: on ? "var(--text)" : "var(--text2)", bgcolor: on ? "var(--panel)" : "transparent", boxShadow: on ? "var(--shadow)" : "none" }}
            >
              {r.label}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );

  if (points.length < 2) {
    if (!full) return null;
    return (
      <Box>
        {header}
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", py: 3 }}>
          Your history starts when a day is saved: when you open the app and every holding has a price.
        </Typography>
      </Box>
    );
  }

  // One scale for both lines, so the cost basis sits where it really is relative to the value.
  const values = points.map((p) => p.total_market_value);
  const costs = points.map((p) => p.total_cost_basis);
  const showCosts = full && points.every((p) => p.cost_basis_complete !== false);
  const min = Math.min(...values, ...(showCosts ? costs : []));
  const top = Math.max(...values, ...(showCosts ? costs : []));
  const span = top - min || 1;
  const y = (v: number) => 40 - ((v - min) / span) * 36;
  const coords = (series: number[]) =>
    series.map((v, i) => `${(i / (points.length - 1)) * 100},${y(v)}`).join(" ");
  const market = coords(values);
  const at = (v: number) => `${(y(v) / 44) * 100}%`; // a value's height in the plot, from the top
  const scale = [top, min + span / 2, min];

  const plot = (
    <svg
      role="img"
      aria-label="Portfolio value over time"
      viewBox="0 0 100 44"
      preserveAspectRatio="none"
      style={{ width: "100%", height: full ? PLOT_HEIGHT : 36, display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {full &&
        scale.map((v) => (
          <line key={v} x1={0} x2={100} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      <polygon points={`0,44 ${market} 100,44`} fill={`url(#${fade})`} />
      <polyline points={market} fill="none" stroke="var(--accent)" strokeWidth={full ? 2 : 1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {showCosts && (
        <polyline points={coords(costs)} fill="none" stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );

  if (!full) return plot;

  return (
    <Box>
      {header}
      <Box sx={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: "10px" }}>
        <Box aria-hidden sx={{ position: "relative", height: PLOT_HEIGHT, minWidth: 30 }}>
          {scale.map((v) => (
            <Box key={v} component="span" sx={{ ...axisLabel, position: "absolute", right: 0, top: at(v), transform: "translateY(-50%)" }}>
              {axisText(v)}
            </Box>
          ))}
        </Box>
        <Box sx={{ position: "relative", height: PLOT_HEIGHT }}>
          {plot}
          {/* The latest value: a dot on the last point, ringed in the card colour. */}
          <Box aria-hidden sx={{ position: "absolute", right: 0, top: at(values[values.length - 1]), width: 10, height: 10, borderRadius: "50%", bgcolor: "var(--accent)", border: "2px solid var(--panel)", boxSizing: "border-box", transform: "translate(50%, -50%)" }} />
        </Box>
        <Box />
        <Box aria-hidden sx={{ position: "relative", height: 20, mt: 1 }}>
          {dateTicks(points).map((tick, i, all) => (
            <Box
              key={`${tick.text}-${i}`}
              component="span"
              sx={{ ...axisLabel, position: "absolute", top: 0, left: `${tick.at * 100}%`, transform: i === 0 ? "none" : i === all.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {tick.text}
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 2.5, mt: 0.5, fontSize: "0.75rem", color: "var(--muted)" }}>
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          <Box component="span" sx={{ width: 14, height: 0, borderTop: "2px solid var(--accent)" }} />
          Market value
        </Box>
        {showCosts && (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <Box component="span" sx={{ width: 14, height: 0, borderTop: "2px dashed var(--muted)" }} />
            Cost basis
          </Box>
        )}
      </Box>
      {!showCosts && (
        <Typography sx={{ mt: 1, fontSize: "0.75rem", color: "var(--muted)" }}>
          Cost comparison unavailable: purchase costs are incomplete in this period.
        </Typography>
      )}
    </Box>
  );
}
