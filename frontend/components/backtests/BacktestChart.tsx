"use client";

import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Box, Typography } from "@mui/material";
import type { EquityCurve } from "@/lib/backtest";
import { CHART_HEIGHT, CHART_MARGIN, CHART_WIDTH, buildChart, formatTick } from "@/lib/backtestChart";
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
  const geometry = buildChart(curve);
  if (!geometry) return null;

  const { count, xAt, yAt } = geometry;
  const { strategy, buy_and_hold: buyAndHold } = curve;
  const last = count - 1;

  function onMouseMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(geometry!.indexAtX(((e.clientX - rect.left) / rect.width) * CHART_WIDTH));
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

  return (
    <Box>
      <svg
        role="img"
        aria-label="Strategy value against buy-and-hold over the tested period"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        tabIndex={0}
        style={{ width: "100%", maxWidth: 560, height: "auto", display: "block" }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        {geometry.yTicks.map((t) => (
          <g key={t.value}>
            <line
              x1={CHART_MARGIN.left}
              x2={CHART_WIDTH - CHART_MARGIN.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
            <text
              x={CHART_MARGIN.left - 6}
              y={t.y}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted)"
              dominantBaseline="middle"
            >
              {formatTick(t.value)}
            </text>
          </g>
        ))}
        <path d={geometry.strategyPath} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        <path
          d={geometry.buyAndHoldPath}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {hover !== null && (
          <>
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={CHART_MARGIN.top}
              y2={CHART_HEIGHT - CHART_MARGIN.bottom}
              stroke="var(--muted)"
              strokeWidth={0.5}
            />
            <circle cx={xAt(hover)} cy={yAt(strategy[hover])} r={3} fill="var(--accent)" />
            <circle cx={xAt(hover)} cy={yAt(buyAndHold[hover])} r={3} fill="var(--muted)" />
          </>
        )}
      </svg>
      <Box sx={{ display: "flex", justifyContent: "space-between", maxWidth: 560, mt: 0.5 }}>
        <Typography sx={NOTE_SX}>{startDate}</Typography>
        <Typography sx={NOTE_SX}>Points are evenly spaced trading days.</Typography>
        <Typography sx={NOTE_SX}>{endDate}</Typography>
      </Box>
      <Typography sx={{ fontSize: 13, mt: 1 }}>Strategy (solid line): {range(strategy)}</Typography>
      <Typography sx={{ fontSize: 13 }}>Buy-and-hold (dashed line): {range(buyAndHold)}</Typography>
      <Typography aria-live="polite" sx={{ fontSize: 13, mt: 1 }}>
        {hover === null
          ? "Hover, or use the arrow keys, to read a point."
          : `Point ${hover + 1} of ${count}: Strategy ${formatAmount(strategy[hover])}, Buy-and-hold ${formatAmount(buyAndHold[hover])}`}
      </Typography>
    </Box>
  );
}
