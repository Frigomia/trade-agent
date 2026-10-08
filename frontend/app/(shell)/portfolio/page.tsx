"use client";

import { useState, type ReactNode } from "react";
import NextLink from "next/link";
import useSWR from "swr";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  IconButton,
  Link as MuiLink,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Camera, Check, Eye, Pencil, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import type {
  AssetType,
  HoldingSummary,
  PortfolioSummary,
  Snapshot,
  WatchlistSummary,
} from "@/lib/api/portfolio-types";
import { formatAmount, formatPct, formatSigned } from "@/lib/format";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { Amount } from "@/components/portfolio/Amount";
import { FirstHolding } from "@/components/portfolio/FirstHolding";
import { HoldingForm } from "@/components/portfolio/HoldingForm";
import { TargetWeightField } from "@/components/portfolio/TargetWeightField";
import { WatchTargetDialog } from "@/components/portfolio/WatchTargetDialog";
import { fractionToPercentText, percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";
import { TradeSheet } from "@/components/portfolio/TradeSheet";
import { Panel } from "@/components/ui/Panel";
import { TickerPicker } from "@/components/ui/TickerPicker";
import { PageHeader } from "@/components/shell/PageHeader";

const DASH = "—";
const COLUMNS = { xs: "1fr auto", md: "1.6fr .6fr .8fr .8fr .9fr 1fr" };
// The watch icon sits outside the row's edit button (a button cannot hold a button), in its own
// column; the header leaves the same room so the other columns stay lined up.
const WATCH_COL = 44;

function plColor(value: number | null): string {
  return value !== null && value < 0 ? "var(--down)" : "var(--up)";
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>{label}</Typography>
      <Box sx={{ fontWeight: 600 }}>{children}</Box>
    </Box>
  );
}

function HoldingRow({
  holding,
  watched,
  onEdit,
  onWatch,
}: {
  holding: HoldingSummary;
  watched: boolean;
  onEdit: () => void;
  onWatch: () => void;
}) {
  const cell = { display: { xs: "none", md: "block" }, textAlign: "right" as const };
  const value = holding.market_value !== null ? formatAmount(holding.market_value) : DASH;
  const pl =
    holding.unrealized_pl !== null && holding.unrealized_pl_pct !== null
      ? `${formatSigned(holding.unrealized_pl)} · ${formatPct(holding.unrealized_pl_pct)}`
      : DASH;
  return (
    <Box sx={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
    <ButtonBase
      aria-label={`Edit ${holding.ticker}`}
      onClick={onEdit}
      sx={{
        display: "grid",
        gridTemplateColumns: COLUMNS,
        gap: 2,
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        alignItems: "center",
        py: 1.5,
      }}
    >
      <Box>
        <Typography sx={{ fontWeight: 600 }}>{holding.ticker}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{holding.name}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", display: { md: "none" } }}>
          {holding.shares} sh
          {holding.weight !== null ? ` · ${(holding.weight * 100).toFixed(1)}%` : ""}
        </Typography>
      </Box>
      <Typography sx={cell}>{holding.shares}</Typography>
      <Typography sx={cell}>{formatAmount(holding.cost_basis)}</Typography>
      <Typography sx={cell}>
        {holding.current_price !== null ? formatAmount(holding.current_price) : DASH}
      </Typography>
      <Box sx={{ textAlign: "right", display: { xs: "block", md: "none" } }}>
        <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
        <Typography sx={{ fontSize: 12, color: plColor(holding.unrealized_pl) }}>{pl}</Typography>
      </Box>
      <Typography sx={{ ...cell, fontWeight: 600 }}>{value}</Typography>
      <Typography sx={{ ...cell, color: plColor(holding.unrealized_pl) }}>{pl}</Typography>
    </ButtonBase>
    <Tooltip title={watched ? "On your watchlist" : "Add to watchlist"}>
      {/* A span, so the tooltip still shows on the disabled button. */}
      <span style={{ width: WATCH_COL, display: "flex", justifyContent: "center", flex: "none" }}>
        <IconButton
          size="small"
          aria-label={watched ? `${holding.ticker} is on your watchlist` : `Add ${holding.ticker} to watchlist`}
          disabled={watched}
          onClick={onWatch}
          sx={{ color: watched ? "var(--up)" : "var(--muted)" }}
        >
          {watched ? <Check size={16} /> : <Eye size={16} />}
        </IconButton>
      </span>
    </Tooltip>
    </Box>
  );
}

export default function PortfolioPage() {
  const {
    data: summary,
    error: summaryError,
    mutate: mutateSummary,
  } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { mutate: mutateSnapshots } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);
  useDailySnapshot();

  const [tradeOpen, setTradeOpen] = useState(false);
  const [holdingForm, setHoldingForm] = useState<{ open: boolean; holding?: HoldingSummary }>({
    open: false,
  });
  const snapshot = useAction();
  const watch = useAction();
  const [watchTicker, setWatchTicker] = useState("");
  const [watchType, setWatchType] = useState<AssetType>("STOCK");
  const [watchTarget, setWatchTarget] = useState("");
  const [editingTarget, setEditingTarget] = useState<WatchlistSummary | null>(null);

  const holdings = summary?.holdings ?? [];
  const open = holdings.filter((h) => h.shares > 0);
  // Nothing owned and nothing watched yet: the watchlist panel is the "or" next to the first-holding form.
  const justWatching = summary !== undefined && open.length === 0 && summary.watchlist.length === 0;

  const recordSnapshot = () =>
    snapshot.run(async () => {
      await apiFetch("/portfolio/snapshot", { method: "POST" });
      mutateSnapshots();
    });

  // The ticker in the confirmation dialog. It is kept after the dialog closes so the text does not
  // go blank while the dialog fades out.
  const [removing, setRemoving] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmRemoval() {
    setConfirmOpen(false);
    await watch.run(async () => {
      await apiFetch(`/portfolio/watchlist/${encodeURIComponent(removing)}`, { method: "DELETE" });
      mutateSummary();
    });
  }

  // Tickers are stored upper-cased, so compare that way.
  const watched = new Set((summary?.watchlist ?? []).map((w) => w.ticker.toUpperCase()));
  const typedTicker = watchTicker.trim().toUpperCase();
  const alreadyWatched = watched.has(typedTicker);

  // target_weight is sent only when one was typed: omitting it keeps a saved target (null would clear it).
  function addToWatchlist(ticker: string, assetType: AssetType, targetText = "") {
    if (!ticker) return;
    const target = percentTextToFraction(targetText);
    if (target === undefined) {
      watch.setError(TARGET_ERROR);
      return;
    }
    return watch.run(async () => {
      await apiFetch("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker, asset_type: assetType, ...(target !== null && { target_weight: target }) }),
      });
      setWatchTicker("");
      setWatchTarget("");
      mutateSummary();
    });
  }

  return (
    <Box>
      <PageHeader
        title="Portfolio"
        subtitle={
          <MuiLink component={NextLink} href="/portfolio/plan">
            Plan this month&apos;s contribution
          </MuiLink>
        }
        actions={
          <>
        <Button
          variant="outlined"
          startIcon={<Camera size={16} />}
          disabled={snapshot.submitting || open.length === 0}
          onClick={recordSnapshot}
        >
          Record snapshot
        </Button>
        <Button
          variant="outlined"
          startIcon={<Plus size={16} />}
          onClick={() => setHoldingForm({ open: true })}
        >
          Add holding
        </Button>
        <Button
          variant="contained"
          disabled={holdings.length === 0}
          onClick={() => setTradeOpen(true)}
        >
          Log a trade
        </Button>
          </>
        }
      />

      {summaryError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load your portfolio.
        </Alert>
      )}
      {snapshot.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {snapshot.error}
        </Alert>
      )}

      {summary && open.length > 0 && (
        <>
          <Box sx={{ display: "flex", gap: 4, alignItems: "flex-end", flexWrap: "wrap", mb: 1 }}>
            <Stat label="Portfolio value">
              <Amount value={summary.total_market_value} size={38} />
            </Stat>
            <Stat label="Cost basis">
              <Amount value={summary.total_cost_basis} />
            </Stat>
            <Stat label="Total P/L">
              <Box component="span" sx={{ color: plColor(summary.total_pl) }}>
                {formatSigned(summary.total_pl)}
                {summary.total_pl_pct !== null && ` (${formatPct(summary.total_pl_pct)})`}
              </Box>
            </Stat>
          </Box>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
            Mixed currencies are not converted; totals add amounts as entered.
          </Typography>
          {summary.unpriced_count > 0 && (
            <Typography sx={{ fontSize: 12, color: "var(--warn)" }}>
              {summary.unpriced_count} holding{summary.unpriced_count === 1 ? " has" : "s have"} no
              live price and {summary.unpriced_count === 1 ? "isn't" : "aren't"} in these totals.
            </Typography>
          )}
        </>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { md: "minmax(0, 1fr) 320px" },
          gap: 2,
          mt: "20px",
          alignItems: "start",
        }}
      >
      {summary && open.length === 0 && <FirstHolding onSaved={() => mutateSummary()} />}
      {open.length > 0 && (
        <Panel sx={{ p: "8px 18px" }}>
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: COLUMNS,
              gap: 2,
              pr: `${WATCH_COL}px`,
              py: 1,
              fontSize: 12,
              color: "var(--muted)",
              textAlign: "right",
              "& > :first-of-type": { textAlign: "left" },
            }}
          >
            <span>Holding</span>
            <span>Shares</span>
            <span>Avg cost</span>
            <span>Price</span>
            <span>Value</span>
            <span>P/L</span>
          </Box>
          {open.map((holding) => (
            <HoldingRow
              key={holding.ticker}
              holding={holding}
              watched={watched.has(holding.ticker.toUpperCase())}
              onEdit={() => setHoldingForm({ open: true, holding })}
              onWatch={() => void addToWatchlist(holding.ticker, holding.asset_type)}
            />
          ))}
        </Panel>
      )}

      <Panel sx={{ p: "16px 18px" }}>
        <Typography sx={{ fontWeight: 600, mb: justWatching ? 0.25 : 1 }}>
          {justWatching ? "Or just watch" : "Watchlist"}
        </Typography>
        {justWatching && (
          <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mb: 1 }}>
            Follow a stock or ETF you don&apos;t own yet.
          </Typography>
        )}
        {(summary?.watchlist ?? []).map((item) => (
          <Box
            key={item.ticker}
            sx={{ display: "flex", alignItems: "center", py: 1, borderBottom: "1px solid var(--line)" }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.ticker}</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                {item.note ?? "Watching"}
                {item.target_weight != null && ` · target ${fractionToPercentText(item.target_weight)}%`}
              </Typography>
            </Box>
            <Typography>
              {item.current_price !== null ? formatAmount(item.current_price) : DASH}
            </Typography>
            <IconButton
              size="small"
              aria-label={`Edit target for ${item.ticker}`}
              onClick={() => setEditingTarget(item)}
              sx={{ ml: 0.5, color: "var(--muted)" }}
            >
              <Pencil size={15} />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`Remove ${item.ticker} from watchlist`}
              disabled={watch.submitting}
              onClick={() => {
                setRemoving(item.ticker);
                setConfirmOpen(true);
              }}
              sx={{ ml: 0.5, color: "var(--muted)" }}
            >
              <X size={16} />
            </IconButton>
          </Box>
        ))}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 1, mt: 1.5 }}>
          <Box sx={{ flex: "1 1 120px", minWidth: 0 }}>
            <TickerPicker
              dense
              label="Watchlist ticker"
              value={watchTicker}
              onChange={setWatchTicker}
              onPick={(match) => setWatchType(match.type)}
            />
          </Box>
          <TextField
            select
            size="small"
            sx={{ minWidth: 100 }}
            slotProps={{
              select: { native: true },
              htmlInput: { "aria-label": "Watchlist type" },
            }}
            value={watchType}
            onChange={(e) => setWatchType(e.target.value as AssetType)}
          >
            <option value="STOCK">Stock</option>
            <option value="ETF">ETF</option>
          </TextField>
          <TargetWeightField size="small" value={watchTarget} onChange={setWatchTarget} sx={{ width: 150 }} />
          <Button
            variant="outlined"
            disabled={alreadyWatched || watch.submitting}
            onClick={() => void addToWatchlist(typedTicker, watchType, watchTarget)}
            sx={{ whiteSpace: "nowrap" }}
          >
            Add to watchlist
          </Button>
        </Box>
        {alreadyWatched && (
          <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 0.75 }}>Already on your watchlist.</Typography>
        )}
        {watch.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {watch.error}
          </Alert>
        )}
      </Panel>
      </Box>

      <WatchTargetDialog item={editingTarget} onClose={() => setEditingTarget(null)} onSaved={() => mutateSummary()} />
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogContent>
          <DialogContentText>Remove {removing} from your watchlist?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" onClick={() => void confirmRemoval()}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      <TradeSheet
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
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
