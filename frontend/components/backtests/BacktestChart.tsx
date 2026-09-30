"use client";

import { useId, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Box, Typography } from "@mui/material";
import type { EquityCurve } from "@/lib/backtest";
import { CHART_HEIGHT, CHART_MARGIN, CHART_WIDTH, buildChart } from "@/lib/backtestChart";
import { formatAmount } from "@/lib/format";

const NOTE_SX = { fontSize: 12, color: "var(--muted)" };

export function BacktestChart({
  curve,
  startDate,
  endDate,
}: {
  curve: EquityCurve;
  startDate: string;
  endDate: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  const geometry = buildChart(curve);
  if (!geometry) return null;

  const { count, xAt, yAt, indexAtX } = geometry;
  const { strategy, buy_and_hold: buyAndHold } = curve;
  const last = count - 1;

  function onMouseMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    setHover(indexAtX(((e.clientX - rect.left) / rect.width) * CHART_WIDTH));
  }

  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    let next: number | null;
    if (e.key === "ArrowRight") next = hover === null ? 0 : Math.min(last, hover + 1);
    else if (e.key === "ArrowLeft") next = hover === null ? last : Math.max(0, hover - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setHover(next);
  }

  const range = (values: number[]) => `${formatAmount(values[0])} to ${formatAmount(values[count - 1])}`;

  const bottom = CHART_HEIGHT - CHART_MARGIN.bottom;

  return (
    <Box>
      <svg
        role="img"
        aria-label="Strategy value against buy-and-hold over the tested period"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        tabIndex={0}
        style={{ width: "100%", height: "auto", display: "block", marginTop: 10 }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {geometry.yTicks.map((t) => (
          <line
            key={t.value}
            x1={CHART_MARGIN.left}
            x2={CHART_WIDTH - CHART_MARGIN.right}
            y1={t.y}
            y2={t.y}
            stroke="var(--line)"
            strokeWidth={0.5}
          />
        ))}
        <path
          d={`${geometry.strategyPath}L${xAt(last)},${bottom}L${xAt(0)},${bottom}Z`}
          fill={`url(#${gradientId})`}
        />
        <path
          d={geometry.buyAndHoldPath}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeDasharray="5 5"
          strokeLinejoin="round"
        />
        <path d={geometry.strategyPath} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" />
        {hover !== null && (
          <>
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={CHART_MARGIN.top}
              y2={bottom}
              stroke="var(--muted)"
              strokeWidth={0.5}
            />
            <circle cx={xAt(hover)} cy={yAt(strategy[hover])} r={3.5} fill="var(--accent)" />
            <circle cx={xAt(hover)} cy={yAt(buyAndHold[hover])} r={3.5} fill="var(--muted)" />
          </>
        )}
      </svg>
      <Box sx={{ display: "flex", gap: 2, fontSize: 12, color: "var(--muted)", mt: 0.5, flexWrap: "wrap" }}>
        {[
          ["Signal strategy", { height: 3, bgcolor: "var(--accent)", borderRadius: "2px" }],
          ["Buy and hold", { borderTop: "2px dashed var(--muted)" }],
        ].map(([label, swatch]) => (
          <Box key={label as string} component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <Box component="i" sx={{ width: 14, display: "block", ...(swatch as object) }} />
            {label as string}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
        <Typography sx={NOTE_SX}>{startDate}</Typography>
        <Typography sx={NOTE_SX}>Points are evenly spaced trading days.</Typography>
        <Typography sx={NOTE_SX}>{endDate}</Typography>
      </Box>
      <Typography sx={{ ...NOTE_SX, mt: 1 }}>Strategy (solid line): {range(strategy)}</Typography>
      <Typography sx={NOTE_SX}>Buy-and-hold (dashed line): {range(buyAndHold)}</Typography>
      <Typography aria-live="polite" sx={{ ...NOTE_SX, mt: 1 }}>
        {hover === null
          ? "Hover, or use the arrow keys, to read a point."
          : `Point ${hover + 1} of ${count}: Strategy ${formatAmount(strategy[hover])}, Buy-and-hold ${formatAmount(buyAndHold[hover])}`}
      </Typography>
    </Box>
  );
}
