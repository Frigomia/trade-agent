"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Box, Typography } from "@mui/material";
import type { HistoryRange, PriceHistory } from "@/lib/api/discovery-types";
import { Change } from "@/components/ui/Change";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatAmount } from "@/lib/format";
import { buildPriceChart, CHART_HEIGHT, CHART_LEFT, CHART_WIDTH, cleanPoints, rangeChangePct } from "@/lib/priceChart";

const RANGE_NAME: Record<HistoryRange, string> = { "1w": "One week", "1m": "One month", "6m": "Six months", "1y": "One year", "5y": "Five years" };

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * One price series as a line with its area, five dates on the x axis and the numbers beside it as
 * text. The chart takes focus: arrow keys (and the pointer) read one close at a time.
 */
export function PriceChart({
  history,
  range,
  onRange,
}: {
  history: PriceHistory;
  range: HistoryRange;
  onRange: (range: HistoryRange) => void;
}) {
  const fade = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const clean = cleanPoints(history.points);
  const geo = buildPriceChart(clean, range);
  const currency = history.currency ?? "";
  const money = (v: number) => `${currency} ${formatAmount(v)}`.trim();

  const ranges = (
    <SegmentedControl
      label="Range"
      size="compact"
      segments={RANGES.map((r) => ({ key: r.key, label: r.label }))}
      value={range}
      onChange={(key) => {
        setPicked(null);
        onRange(key);
      }}
    />
  );

  if (!geo) {
    return (
      <Box sx={{ display: "grid", gap: 1.5 }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>{ranges}</Box>
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", py: 4, textAlign: "center" }}>
          Not enough price history for this range.
        </Typography>
      </Box>
    );
  }

  const last = clean[clean.length - 1];
  // Clamped, so a refreshed (shorter) series can never leave the reading pointing past its end.
  const index = Math.min(picked ?? clean.length - 1, clean.length - 1);
  const point = clean[index];
  const change = rangeChangePct(clean);
  const step = (e: KeyboardEvent) => {
    const to = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: clean.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setPicked(Math.min(clean.length - 1, Math.max(0, to)));
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPicked(geo.indexAtX(((e.clientX - box.left) / box.width) * CHART_WIDTH));
  };

  return (
    <Box sx={{ display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
        <Typography component="span" sx={{ fontSize: "1.625rem", fontWeight: 650, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
          {money(last.close)}
        </Typography>
        {change !== null && (
          <Box component="span" sx={{ fontSize: "0.8125rem" }}>
            <Change pct={change} /> <Box component="span" sx={{ color: "var(--muted)" }}>over this range</Box>
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        {ranges}
      </Box>
      <Box
        component="svg"
        role="img"
        tabIndex={0}
        aria-label={`Price chart, ${clean.length} daily closes. Use the arrow keys to read a day.`}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        onKeyDown={step}
        onPointerMove={move}
        onPointerLeave={(e) => {
          // A finger lifting also "leaves"; only a mouse leaving clears the reading.
          if (e.pointerType === "mouse") setPicked(null);
        }}
        onBlur={() => setPicked(null)}
        sx={{ width: "100%", height: "auto", display: "block", overflow: "visible", touchAction: "pan-y", "&:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: 4, borderRadius: "8px" } }}
      >
        <defs>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {geo.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={CHART_LEFT} x2={CHART_WIDTH} y1={t.y} y2={t.y} stroke="var(--line)" />
            <text x={CHART_LEFT - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {formatAmount(t.value)}
            </text>
          </g>
        ))}
        <path d={geo.areaPath} fill={`url(#${fade})`} />
        <path d={geo.linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {geo.xTicks.map((t) => (
          <text key={`${t.x}-${t.label}`} x={t.x} y={CHART_HEIGHT - 6} textAnchor={t.anchor} fontSize={10} fill="var(--muted)">
            {t.label}
          </text>
        ))}
        <circle cx={geo.xAt(index)} cy={geo.yAt(point.close)} r={4.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />
      </Box>
      <Typography aria-live="polite" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
        {picked === null
          ? `${day(last.date)}, last close. ${RANGE_NAME[range]} shown, ${clean.length} days.`
          : `${day(point.date)}: ${money(point.close)}`}
      </Typography>
    </Box>
  );
}
