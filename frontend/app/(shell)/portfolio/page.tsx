"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Box, Button, ButtonBase, Typography } from "@mui/material";
import { Eye, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { HoldingSummary, PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { DASH, formatAmount, formatPct, formatClock, formatShare, formatSigned } from "@/lib/format";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { AllocationPanel } from "@/components/portfolio/AllocationPanel";
import { HoldingMenu } from "@/components/portfolio/HoldingMenu";
import { RemoveHoldingDialog } from "@/components/portfolio/RemoveHoldingDialog";
import { Logo } from "@/components/ui/Logo";
import { OverviewStrip } from "@/components/portfolio/OverviewStrip";
import { RiskPanel } from "@/components/portfolio/RiskPanel";
import { FirstHolding } from "@/components/portfolio/FirstHolding";
import { HoldingForm } from "@/components/portfolio/HoldingForm";
import { effectiveTarget, fractionToPercentText } from "@/lib/targetWeight";
import { TradeSheet } from "@/components/portfolio/TradeSheet";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/shell/PageHeader";
import { PortfolioTabs } from "@/components/portfolio/PortfolioTabs";
import { HOLDING_COLUMNS, HOLDING_GAP } from "@/lib/portfolio/holdingColumns";
import { allocate, largestPositions, type AllocationDim } from "@/lib/portfolio/allocation";
import { useAnalytics } from "@/lib/useAnalytics";

// A share count on the phone line, to one decimal at most ("1.4 sh"); a tiny one keeps its digits.
const shortShares = (shares: number) => Math.round(shares * 10) / 10 || shares;
// The row menu sits outside the row's edit button (a button cannot hold a button), in its own
// column; the header leaves the same room so the other columns stay lined up.
const MENU_COL = 44;

function plColor(value: number | null): string {
  return value !== null && value < 0 ? "var(--down)" : "var(--up)";
}

type Target = ReturnType<typeof effectiveTarget>;

const targetText = (fraction: number) => `${fractionToPercentText(fraction)}%`;

// Inside the row's edit button, so it is text, not a second button: a tap opens the same holding form.
function SetTarget() {
  return (
    <Box
      component="span"
      sx={{ color: "var(--muted)", textDecoration: "underline dotted", textUnderlineOffset: "3px" }}
    >
      Set target
    </Box>
  );
}

// Inside the row's edit button, so it is text, not a second button: a tap opens the holding form.
function AddPurchasePrice() {
  return (
    <Box component="span" sx={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px", fontSize: "0.75rem", fontWeight: 500 }}>
      Add purchase price
    </Box>
  );
}

/** "51.7% / 51%" over a slim bar with a tick at the target; `scale` is the table's largest weight or target. */
function WeightCell({ weight, target, scale }: { weight: number | null; target: Target; scale: number }) {
  const at = (fraction: number) => `${Math.min(100, (fraction / scale) * 100)}%`;
  return (
    <Box sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", alignItems: "flex-end", gap: 0.75, minWidth: 0, textAlign: "right" }}>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <b>{formatShare(weight)}</b>
        {target ? (
          <Box
            component="span"
            title={target.fromWatchlist ? "Target set on Discover. Change it there." : undefined}
            sx={{ color: "var(--muted)" }}
          >
            {" / "}
            {targetText(target.target)}
            {target.fromWatchlist && (
              <Eye size={11} role="img" aria-label="set on Discover" style={{ marginLeft: 3, verticalAlign: "-1px" }} />
            )}
          </Box>
        ) : (
          <Box component="span" sx={{ display: "block", fontSize: 12.5 }}>
            <SetTarget />
          </Box>
        )}
      </Typography>
      {target && weight !== null && (
        <Box aria-hidden sx={{ position: "relative", width: "100%", height: 6, borderRadius: 999, bgcolor: "var(--track)" }}>
          <Box sx={{ width: at(weight), height: "100%", borderRadius: 999, bgcolor: "var(--accent-solid)" }} />
          <Box sx={{ position: "absolute", left: at(target.target), top: -3, bottom: -3, width: 2, ml: "-1px", bgcolor: "var(--text)" }} />
        </Box>
      )}
    </Box>
  );
}

function HoldingRow({
  holding,
  target,
  scale,
  onEdit,
  onLogTrade,
  onRemove,
}: {
  holding: HoldingSummary;
  target: Target;
  scale: number;
  onEdit: () => void;
  onLogTrade: () => void;
  onRemove: () => void;
}) {
  // minWidth 0 lets a cell shrink with its minmax(0, fr) track; a long number then wraps, never overflows.
  const cell = { display: { xs: "none", md: "block" }, textAlign: "right" as const, minWidth: 0, overflowWrap: "anywhere" as const };
  const value = holding.market_value !== null ? formatAmount(holding.market_value) : DASH;
  const pl =
    holding.unrealized_pl !== null && holding.unrealized_pl_pct !== null
      ? `${formatSigned(holding.unrealized_pl)} · ${formatPct(holding.unrealized_pl_pct)}`
      : DASH;
  // No purchase price: there is no gain to show, and the way to get one is the form.
  const noCost = holding.cost_basis === null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
    <ButtonBase
      aria-label={`Edit ${holding.ticker}${target?.fromWatchlist ? " (target set on Discover)" : ""}`}
      onClick={onEdit}
      sx={{
        display: "grid",
        gridTemplateColumns: HOLDING_COLUMNS,
        gap: HOLDING_GAP,
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        alignItems: "center",
        py: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0, display: "flex", alignItems: "center", gap: 1.5 }}>
      <Logo name={holding.name} size={34} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{holding.ticker}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>{holding.name}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", display: { md: "none" } }}>
          {shortShares(holding.shares)} sh · {formatShare(holding.weight)}
          {target ? (
            ` / target ${targetText(target.target)}${target.fromWatchlist ? " (Discover)" : ""}`
          ) : (
            <> · <SetTarget /></>
          )}
        </Typography>
      </Box>
      </Box>
      <Typography sx={cell}>
        {holding.shares}
        <Box component="span" sx={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
          avg {holding.cost_basis !== null && Number.isFinite(holding.cost_basis) ? formatAmount(holding.cost_basis) : DASH}
        </Box>
      </Typography>
      <Typography sx={cell}>
        {holding.current_price !== null ? formatAmount(holding.current_price) : DASH}
        {holding.current_price !== null && holding.stale === true && (
          <Box component="span" sx={{ display: "block", fontSize: 12, color: "var(--warn)" }}>
            {holding.as_of ? `Stale quote · ${holding.as_of}` : "Quote date unavailable"}
          </Box>
        )}
      </Typography>
      <Box sx={{ textAlign: "right", display: { xs: "block", md: "none" } }}>
        <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
        <Typography sx={{ fontSize: 12, color: plColor(holding.unrealized_pl) }}>{noCost ? <AddPurchasePrice /> : pl}</Typography>
      </Box>
      <Typography sx={{ ...cell, fontWeight: 600 }}>{value}</Typography>
      <Typography sx={{ ...cell, color: plColor(holding.unrealized_pl) }}>{noCost ? <AddPurchasePrice /> : pl}</Typography>
      <WeightCell weight={holding.weight} target={target} scale={scale} />
    </ButtonBase>
    <HoldingMenu ticker={holding.ticker} onEdit={onEdit} onLogTrade={onLogTrade} onRemove={onRemove} />
    </Box>
  );
}

export default function PortfolioPage() {
  // When the figures were last read: the subtitle says so, as the approved mock does.
  const [read, setRead] = useState<number | null>(null);
  const {
    data: summary,
    error: summaryError,
    mutate: mutateSummary,
  } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch, { onSuccess: () => setRead(Date.now()) });
  const { data: snapshots, error: snapshotsError } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);
  useDailySnapshot();

  // The trade sheet opens for one holding, from its row menu.
  const [trade, setTrade] = useState<{ open: boolean; ticker?: string }>({ open: false });
  // The holding in the removal dialog is kept after it closes, so the text does not blank mid-fade.
  const [removingHolding, setRemovingHolding] = useState<HoldingSummary | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [holdingForm, setHoldingForm] = useState<{ open: boolean; holding?: HoldingSummary }>({
    open: false,
  });

  const holdings = summary?.holdings ?? [];
  const open = holdings.filter((h) => h.shares > 0);
  // The allocation donut's grouping, and the group a legend row selected: it filters the table.
  const [dim, setDim] = useState<AllocationDim>("sector");
  const [selected, setSelected] = useState<string | null>(null);
  const allocation = allocate(open, dim);
  // Measured risk is read only when there is something to measure (the route is costly and limited).
  // The key follows the open positions, so a change to one reads the figures again.
  const risk = useAnalytics(open.length > 0 ? open.map((h) => `${h.ticker}:${h.shares}`).sort().join(",") : null);
  const group = allocation.groups.find((g) => g.id === selected) ?? null;
  // A selected group that is no longer there (a holding was sold, a price went missing) is dropped
  // for good, so it cannot come back on its own with a later refresh.
  if (selected !== null && group === null) setSelected(null);
  const shown = group ? open.filter((h) => group.tickers.includes(h.ticker)) : open;
  // The plan reads a holding's target from the saved Discover list when the holding has none.
  const watchlist = summary?.watchlist ?? [];
  const targets = new Map(open.map((h) => [h.ticker, effectiveTarget(h, watchlist)]));
  // The weight bars share one scale, the largest weight or target in the table, so they compare.
  const scale = Math.max(0.01, ...open.map((h) => Math.max(h.weight ?? 0, targets.get(h.ticker)?.target ?? 0)));

  return (
    <Box>
      <PageHeader
        title="Portfolio"
        subtitle={`Your holdings, allocation and risk.${read === null ? "" : ` Updated today, ${formatClock(read)}.`}`}
        actions={
          <>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setHoldingForm({ open: true })}
        >
          Add holding
        </Button>
          </>
        }
      />
      <PortfolioTabs current="holdings" />

      {summaryError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load your portfolio.
        </Alert>
      )}

      {summary && open.length > 0 && (
        <Box sx={{ display: "grid", gap: 2 }}>
          <OverviewStrip summary={summary} openCount={open.length} snapshots={snapshots} snapshotsFailed={!!snapshotsError} />
          <AllocationPanel
            allocation={allocation}
            dim={dim}
            onDim={(next) => {
              setDim(next);
              setSelected(null);
            }}
            selected={group?.id ?? null}
            onSelect={setSelected}
            positions={largestPositions(open)}
          />
        </Box>
      )}

      <Box sx={{ mt: "20px" }}>
      {summary && open.length === 0 && <FirstHolding onAdd={() => setHoldingForm({ open: true })} />}
      {open.length > 0 && (
        <Panel component="section" aria-label="Your holdings" sx={{ p: "12px 18px 8px" }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, pt: 0.5 }}>
            <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
              Your holdings
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {group ? `${shown.length} of ${open.length} holdings` : `${open.length} holding${open.length === 1 ? "" : "s"}`}
            </Typography>
          </Box>
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: HOLDING_COLUMNS,
              gap: HOLDING_GAP,
              pr: `${MENU_COL}px`,
              py: 1,
              fontSize: 12,
              color: "var(--muted)",
              textAlign: "right",
              "& > :first-of-type": { textAlign: "left" },
            }}
          >
            <span>Holding</span>
            <span>Shares</span>
            <span>Price</span>
            <span>Value</span>
            <span>P/L</span>
            <span>Weight / Target</span>
          </Box>
          {group && (
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", py: 1 }}>
              Showing holdings in {group.name}.{" "}
              <ButtonBase onClick={() => setSelected(null)} sx={{ fontSize: "inherit", color: "var(--accent)", textDecoration: "underline", verticalAlign: "baseline" }}>
                Show all
              </ButtonBase>
            </Typography>
          )}
          {shown.map((holding) => (
            <HoldingRow
              key={holding.ticker}
              holding={holding}
              target={targets.get(holding.ticker) ?? null}
              scale={scale}
              onEdit={() => setHoldingForm({ open: true, holding })}
              onLogTrade={() => setTrade({ open: true, ticker: holding.ticker })}
              onRemove={() => {
                setRemovingHolding(holding);
                setRemoveOpen(true);
              }}
            />
          ))}
        </Panel>
      )}

      </Box>

      {summary && open.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <RiskPanel analytics={risk.analytics} failed={risk.failed} refreshFailed={risk.refreshFailed} retrying={risk.retrying} onRetry={risk.retry} />
        </Box>
      )}

      <RemoveHoldingDialog holding={removingHolding} open={removeOpen} onClose={() => setRemoveOpen(false)} onRemoved={() => mutateSummary()} />
      <TradeSheet
        open={trade.open}
        prefill={trade.ticker ? { ticker: trade.ticker } : undefined}
        onClose={() => setTrade({ open: false })}
        holdings={holdings.map((h) => ({ ticker: h.ticker, name: h.name }))}
        onLogged={() => mutateSummary()}
      />
      <HoldingForm
        open={holdingForm.open}
        onClose={() => setHoldingForm((s) => ({ ...s, open: false }))}
        holding={holdingForm.holding}
        heldTickers={holdings.map((h) => h.ticker)}
        onSaved={() => mutateSummary()}
      />
    </Box>
  );
}
