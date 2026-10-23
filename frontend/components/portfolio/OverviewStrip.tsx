"use client";

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { formatPct, formatSigned } from "@/lib/format";
import { Amount } from "./Amount";
import { collapseByDay, PortfolioChart } from "./PortfolioChart";

/** The chart waits for this many days of saved values rather than draw a line through two points. */
export const MIN_CHART_DAYS = 7;

const label = { fontSize: "0.75rem", color: "var(--muted)" } as const;

function Stat({ title, children, note, main = false }: { title: string; children: ReactNode; note?: ReactNode; main?: boolean }) {
  return (
    <Box sx={{ display: "grid", gap: 0.5, minWidth: 0, gridColumn: main ? "1 / -1" : undefined }}>
      <Typography component="small" sx={label}>
        {title}
      </Typography>
      <Box component="b" sx={{ fontSize: main ? "2rem" : "1.375rem", fontWeight: 650, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
        {children}
      </Box>
      {note && <Typography component="em" sx={{ ...label, fontStyle: "normal" }}>{note}</Typography>}
    </Box>
  );
}

const NotAvailable = ({ children }: { children: ReactNode }) => (
  <Box component="span" sx={{ fontSize: "1rem", fontWeight: 500, color: "var(--text2)" }}>
    {children}
  </Box>
);

const heading = (
  <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
    Value over time
  </Typography>
);

/** The right column: the title (with the range control on its row once there is a chart), then the chart or why there is none. */
function Chart({ snapshots, failed }: { snapshots: Snapshot[] | undefined; failed: boolean }) {
  const titled = (body: ReactNode) => (
    <>
      <Box sx={{ mb: 1.5 }}>{heading}</Box>
      {body}
    </>
  );
  if (failed && snapshots === undefined) {
    return titled(
      <Box sx={{ display: "grid", placeContent: "center", minHeight: 150, p: 2, textAlign: "center", border: "1px dashed var(--line2)", borderRadius: "14px" }}>
        <Typography sx={{ ...label, maxWidth: "34ch" }}>The saved values could not be loaded, so there is no chart. Reload to try again.</Typography>
      </Box>,
    );
  }
  if (snapshots === undefined) {
    return titled(<Box aria-busy sx={{ height: 150, borderRadius: "14px", bgcolor: "var(--track)" }} />);
  }
  const days = collapseByDay(snapshots).length;
  if (days < MIN_CHART_DAYS) {
    return titled(
      <Box sx={{ display: "grid", placeContent: "center", justifyItems: "center", textAlign: "center", gap: 0.75, minHeight: 150, p: 2, border: "1px dashed var(--line2)", borderRadius: "14px" }}>
        <Typography component="b" sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>
          The chart needs a little more history
        </Typography>
        <Typography sx={{ ...label, maxWidth: "34ch" }}>
          It appears once there are at least {MIN_CHART_DAYS} days of saved values. You have {days} so far. A day is saved when you open the app and every holding has a price.
        </Typography>
      </Box>,
    );
  }
  return <PortfolioChart snapshots={snapshots} heading={heading} />;
}

/**
 * Why there is no gain or loss to show. A holding counts only with both a live price and a known
 * purchase cost, so none counting is either cause, or both. The two counts overlap (a holding with
 * neither is in both), so when both are set the note names both causes without counting holdings.
 */
function gainUnavailableNote(summary: Pick<PortfolioSummary, "unknown_basis_count" | "unpriced_count">): string {
  const noCost = (summary.unknown_basis_count ?? 0) > 0;
  const noQuote = summary.unpriced_count > 0;
  if (noCost && noQuote) {
    return "Some holdings are missing a purchase price or a live price. Add the purchase prices (edit a holding); quotes return on their own.";
  }
  if (noCost) return "Add purchase prices to see it. Edit a holding to add one.";
  if (noQuote) return "Some holdings have no live price, so there is no gain or loss to show yet. It returns when quotes do.";
  return "There is not enough price and cost data to work out a gain or loss yet.";
}

/**
 * The slim strip above the allocation: total value, gain or loss, today's change and the value
 * chart. Gain or loss and the day's change say "Not available" and why, never a made-up zero.
 */
export function OverviewStrip({ summary, openCount, snapshots, snapshotsFailed = false, snapshotNote = null }: { summary: PortfolioSummary; openCount: number; snapshots: Snapshot[] | undefined; snapshotsFailed?: boolean; snapshotNote?: string | null }) {
  const noCosts = summary.pl_covered_count === 0;
  const left = summary.unknown_basis_count ?? 0;
  const up = summary.total_pl >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Panel component="section" aria-label="Portfolio overview" sx={{ p: { xs: "16px", md: "20px 24px" }, display: "grid", gap: 3, gridTemplateColumns: { md: "minmax(0, 1fr) minmax(0, 1.4fr)" }, alignItems: "center" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>
        <Stat title="Total value" main note={`${openCount} holding${openCount === 1 ? "" : "s"} · amounts as entered`}>
          <Amount value={summary.total_market_value} size={32} />
        </Stat>
        {noCosts ? (
          <Stat title="Total gain or loss" note={gainUnavailableNote(summary)}>
            <NotAvailable>Not available</NotAvailable>
          </Stat>
        ) : (
          <Stat
            title="Total gain or loss"
            note={left > 0 ? `${left} holding${left === 1 ? "" : "s"} without a purchase price ${left === 1 ? "is" : "are"} left out` : undefined}
          >
            <Box component="span" sx={{ color: up ? "var(--up)" : "var(--down)" }}>
              {formatSigned(summary.total_pl)}
              {summary.total_pl_pct !== null && (
                <Box component="span" sx={{ display: "block", fontSize: "0.75rem", fontWeight: 500 }}>
                  {formatPct(summary.total_pl_pct)} <Arrow size={12} aria-hidden style={{ verticalAlign: "-1px" }} />
                </Box>
              )}
            </Box>
          </Stat>
        )}
        <Stat title="Today" note="The previous close is not saved yet.">
          <NotAvailable>Not available</NotAvailable>
        </Stat>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Chart snapshots={snapshots} failed={snapshotsFailed} />
        {snapshotNote && <Typography role="status" sx={{ ...label, color: "var(--warn)", mt: 1 }}>{snapshotNote}</Typography>}
      </Box>
      {summary.unpriced_count > 0 && (
        <Typography sx={{ ...label, color: "var(--warn)", gridColumn: "1 / -1" }}>
          {summary.unpriced_count} holding{summary.unpriced_count === 1 ? " has" : "s have"} no live price and {summary.unpriced_count === 1 ? "isn't" : "aren't"} in these totals.
        </Typography>
      )}
    </Panel>
  );
}
