"use client";

import { useState } from "react";
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
function toTime(iso: string): number {
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
  const full = variant === "full";

  const days = RANGES.find((r) => r.label === range)?.days ?? null;
  const cutoff = full && days !== null ? now - days * 86_400_000 : -Infinity;
  const points = collapseByDay(snapshots).filter((s) => toTime(s.created_at) >= cutoff);

  const chips = full && (
    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
      {RANGES.map((r) => (
        <Chip
          key={r.label}
          label={r.label}
          size="small"
          onClick={() => setRange(r.label)}
          color={range === r.label ? "primary" : "default"}
        />
      ))}
    </Box>
  );

  if (points.length < 2) {
    if (!full) return null;
    return (
      <Box>
        <Typography sx={{ fontSize: 13, color: "var(--muted)", py: 3 }}>
          Record a snapshot to start your history.
        </Typography>
        {chips}
      </Box>
    );
  }

  const values = points.map((p) => p.total_market_value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const coords = points.map(
    (p, i) => `${(i / (points.length - 1)) * 100},${40 - ((p.total_market_value - min) / span) * 36}`,
  );

  return (
    <Box>
      <svg
        role="img"
        aria-label="Portfolio value over time"
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
        style={{ width: "100%", height: full ? 120 : 36, display: "block" }}
      >
        <polygon points={`0,44 ${coords.join(" ")} 100,44`} fill="var(--accent)" opacity={0.12} />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {chips}
    </Box>
  );
}
