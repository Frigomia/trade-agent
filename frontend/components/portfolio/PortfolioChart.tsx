"use client";

import { useId, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import type { Snapshot } from "@/lib/api/portfolio-types";

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
] as const;
type RangeLabel = (typeof RANGES)[number]["label"];

// The API returns naive UTC timestamps; Date.parse would otherwise read them as local time.
export function toTime(iso: string): number {
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
}

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

export function PortfolioChart({
  snapshots,
  variant = "full",
}: {
  snapshots: Snapshot[];
  variant?: "full" | "sparkline";
}) {
  const [range, setRange] = useState<RangeLabel>("3M");
  const [now] = useState(() => Date.now());
  const fade = useId();
  const full = variant === "full";

  const days = RANGES.find((r) => r.label === range)?.days ?? null;
  const cutoff = full && days !== null ? now - days * 86_400_000 : -Infinity;
  const points = collapseByDay(snapshots).filter((s) => toTime(s.created_at) >= cutoff);

  // The mockups' range control: quiet pills on the right, the selected one a wash with accent text.
  const chips = full && (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
      {RANGES.map((r) => (
        <Chip
          key={r.label}
          label={r.label}
          size="small"
          onClick={() => setRange(r.label)}
          color={range === r.label ? "primary" : "default"}
          sx={range === r.label ? undefined : { bgcolor: "transparent", color: "var(--muted)" }}
        />
      ))}
    </Box>
  );

  if (points.length < 2) {
    if (!full) return null;
    return (
      <Box>
        {chips}
        <Typography sx={{ fontSize: 13, color: "var(--muted)", py: 3 }}>
          Record a snapshot to start your history.
        </Typography>
      </Box>
    );
  }

  // One scale for both lines, so the cost basis sits where it really is relative to the value.
  const values = points.map((p) => p.total_market_value);
  const costs = points.map((p) => p.total_cost_basis);
  const min = Math.min(...values, ...(full ? costs : []));
  const span = Math.max(...values, ...(full ? costs : [])) - min || 1;
  const y = (v: number) => 40 - ((v - min) / span) * 36;
  const coords = (series: number[]) =>
    series.map((v, i) => `${(i / (points.length - 1)) * 100},${y(v)}`).join(" ");
  const market = coords(values);

  return (
    <Box>
      {chips}
      <svg
        role="img"
        aria-label="Portfolio value over time"
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
        style={{ width: "100%", height: full ? 180 : 36, display: "block", marginTop: full ? 8 : 0 }}
      >
        <defs>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={`0,44 ${market} 100,44`} fill={`url(#${fade})`} />
        <polyline
          points={market}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {full && (
          <polyline
            points={coords(costs)}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {full && (
        <Box sx={{ display: "flex", gap: 2.5, mt: 1, fontSize: 12, color: "var(--muted)" }}>
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <Box component="span" sx={{ width: 14, height: 0, borderTop: "2px solid var(--accent)" }} />
            Market value
          </Box>
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <Box component="span" sx={{ width: 14, height: 0, borderTop: "2px dashed var(--muted)" }} />
            Cost basis
          </Box>
        </Box>
      )}
    </Box>
  );
}
