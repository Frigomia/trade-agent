"use client";

import { useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { formatAmount, formatShare } from "@/lib/format";
import { ALLOCATION_DIMS, type Allocation, type AllocationDim, type Position } from "@/lib/portfolio/allocation";

const SIZE = 220;
const STROKE = 26;
const RADIUS = SIZE / 2 - 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2; // a hairline between slices, in the dash length

const color = (i: number) => `var(--c${(i % 6) + 1})`;

const label = { fontSize: "0.75rem", color: "var(--muted)" } as const;

/** Slices as stroked circle arcs: one per group, in the legend's order and colours. */
function Donut({ allocation, dim, selected, hover }: { allocation: Allocation; dim: AllocationDim; selected: string | null; hover: number | null }) {
  const dimLabel = ALLOCATION_DIMS.find((d) => d.key === dim)?.label.toLowerCase();
  const focus = hover ?? allocation.groups.findIndex((g) => g.id === selected);
  const shown = allocation.groups[focus] ?? null;
  // Where each slice starts along the circle: the shares before it.
  const starts = allocation.groups.map((_, i) => allocation.groups.slice(0, i).reduce((sum, g) => sum + g.share, 0) * CIRCUMFERENCE);
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Allocation by ${dimLabel}: ${allocation.groups.map((g) => `${g.name} ${formatShare(g.share)}`).join(", ")}`}
      style={{ flex: "none", maxWidth: "100%" }}
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--track)" strokeWidth={STROKE} />
      {allocation.groups.map((g, i) => {
        const length = g.share * CIRCUMFERENCE;
        const dash = Math.max(0, length - GAP);
        return (
          <circle
            key={g.id}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color(i)}
            strokeWidth={STROKE}
            strokeDasharray={`${dash.toFixed(2)} ${(CIRCUMFERENCE - dash).toFixed(2)}`}
            strokeDashoffset={(-starts[i]).toFixed(2)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            opacity={focus >= 0 && focus !== i ? 0.3 : 1}
          />
        );
      })}
      <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: "1.1875rem", fontWeight: 650, fill: "var(--text)", letterSpacing: "-0.02em" }}>
        {shown ? formatShare(shown.share) : allocation.groups.length}
      </text>
      <text x="50%" y="58%" textAnchor="middle" style={{ fontSize: "0.75rem", fill: "var(--muted)" }}>
        {shown ? shown.name : allocation.groups.length === 1 ? dimLabel : `${dimLabel}s`}
      </text>
    </svg>
  );
}

/** The mock's segmented control: a pill track, the chosen option lifted on a panel. */
function DimTabs({ dim, onDim }: { dim: AllocationDim; onDim: (dim: AllocationDim) => void }) {
  return (
    <Box role="group" aria-label="Group allocation by" sx={{ display: "inline-flex", gap: "2px", p: "3px", borderRadius: 999, bgcolor: "var(--track)", width: "max-content", maxWidth: "100%" }}>
      {ALLOCATION_DIMS.map((d) => {
        const on = d.key === dim;
        return (
          <ButtonBase
            key={d.key}
            aria-pressed={on}
            onClick={() => onDim(d.key)}
            sx={{
              minHeight: { xs: 40, md: 32 },
              px: 1.75,
              borderRadius: 999,
              fontSize: "0.75rem",
              fontWeight: on ? 650 : 500,
              color: on ? "var(--text)" : "var(--text2)",
              bgcolor: on ? "var(--panel)" : "transparent",
              boxShadow: on ? "var(--shadow)" : "none",
            }}
          >
            {d.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/**
 * Where the money is: a donut by sector, country or currency, with a legend whose rows filter the
 * holdings below (a pressed row, pressed again to clear), and the largest positions beside it.
 * The slices are never the only carrier of meaning: every group is named with its share and value.
 */
export function AllocationPanel({
  allocation,
  dim,
  onDim,
  selected,
  onSelect,
  positions,
}: {
  allocation: Allocation;
  dim: AllocationDim;
  onDim: (dim: AllocationDim) => void;
  selected: string | null;
  onSelect: (name: string | null) => void;
  positions: Position[];
}) {
  const [hoverIndex, setHover] = useState<number | null>(null);
  // A hover left over from a grouping with more rows is not a row of this one.
  const hover = hoverIndex !== null && hoverIndex < allocation.groups.length ? hoverIndex : null;
  return (
    <Panel component="section" aria-label="Allocation" sx={{ p: "20px 24px", display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Where your money is
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={label}>Select a row to filter the holdings below</Typography>
      </Box>

      {allocation.groups.length === 0 ? (
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>
          No holding has a live price yet, so there is nothing to chart.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { md: "minmax(0, 1.5fr) minmax(0, 1fr)" }, alignItems: "start" }}>
          <Box sx={{ display: "grid", gap: 1.75, minWidth: 0 }}>
            <DimTabs dim={dim} onDim={onDim} />
            <Box sx={{ display: "flex", gap: 3.5, alignItems: "center", flexWrap: "wrap" }}>
              <Donut allocation={allocation} dim={dim} selected={selected} hover={hover} />
              <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: "2px", flex: 1, minWidth: 190 }}>
                {allocation.groups.map((g, i) => {
                  const on = g.id === selected;
                  return (
                    <li key={g.id}>
                      <ButtonBase
                        aria-pressed={on}
                        onClick={() => onSelect(on ? null : g.id)}
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(i)}
                        onBlur={() => setHover(null)}
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "12px minmax(0, 1fr) auto auto",
                          gap: 1,
                          alignItems: "center",
                          width: "100%",
                          minHeight: 44,
                          px: 1.25,
                          borderRadius: "10px",
                          textAlign: "left",
                          fontSize: "0.8125rem",
                          color: "var(--text2)",
                          bgcolor: on ? "var(--accent-wash)" : "transparent",
                          "&:hover": { bgcolor: on ? "var(--accent-wash)" : "var(--track)" },
                        }}
                      >
                        <Box component="i" aria-hidden sx={{ width: 12, height: 12, borderRadius: "4px", bgcolor: color(i) }} />
                        <Box component="span" sx={{ overflowWrap: "anywhere", color: on ? "var(--text)" : undefined, fontWeight: on ? 650 : 400 }}>{g.name}</Box>
                        <Box component="b" sx={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{formatShare(g.share)}</Box>
                        <Box component="small" sx={{ ...label, minWidth: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatAmount(g.value)}</Box>
                      </ButtonBase>
                    </li>
                  );
                })}
              </Box>
            </Box>
          </Box>

          <Box sx={{ minWidth: 0, borderLeft: { md: "1px solid var(--line)" }, pl: { md: 3 }, borderTop: { xs: "1px solid var(--line)", md: 0 }, pt: { xs: 2, md: 0 }, display: "grid", gap: 1 }}>
            <Typography component="h3" sx={{ fontSize: "0.8125rem", fontWeight: 650 }}>
              Largest positions
            </Typography>
            <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "grid" }}>
              {positions.map((p) => (
                <Box component="li" key={p.ticker} sx={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 56px 52px", gap: 1.25, alignItems: "center", py: 0.75, fontSize: "0.8125rem" }}>
                  <Logo name={p.name} size={28} />
                  <Box component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{p.ticker}</Box>
                  <Box aria-hidden sx={{ height: 6, borderRadius: 999, bgcolor: "var(--track)", overflow: "hidden" }}>
                    <Box sx={{ height: "100%", width: `${Math.min(100, (p.share / (positions[0]?.share || 1)) * 100)}%`, bgcolor: "var(--accent)", borderRadius: 999 }} />
                  </Box>
                  <Box component="b" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatShare(p.share)}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {allocation.unpriced > 0 && (
        <Typography sx={{ ...label, color: "var(--warn)" }}>
          {allocation.unpriced} holding{allocation.unpriced === 1 ? " has" : "s have"} no live price and {allocation.unpriced === 1 ? "isn't" : "aren't"} in this chart.
        </Typography>
      )}
      <Typography sx={label}>Amounts are as entered; mixed currencies are not converted.</Typography>
    </Panel>
  );
}
