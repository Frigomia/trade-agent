"use client";

import { useState, type ReactNode } from "react";
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
import { effectiveTarget, fractionToPercentText, percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";
import { TradeSheet } from "@/components/portfolio/TradeSheet";
import { Panel } from "@/components/ui/Panel";
import { IsinNote } from "@/components/ui/IsinNote";
import { TickerPicker } from "@/components/ui/TickerPicker";
import { saveIsinAfterAdd } from "@/lib/orders";
import { PageHeader } from "@/components/shell/PageHeader";
import { PortfolioTabs } from "@/components/portfolio/PortfolioTabs";
import { AVG_COST_DISPLAY, HOLDING_COLUMNS, HOLDING_GAP } from "@/lib/portfolio/holdingColumns";

const DASH = "—";
// A share count on the phone line, to one decimal at most ("1.4 sh"); a tiny one keeps its digits.
const shortShares = (shares: number) => Math.round(shares * 10) / 10 || shares;
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

type Target = ReturnType<typeof effectiveTarget>;

const pctText = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
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

/** "51.7% / 51%" over a slim bar with a tick at the target; `scale` is the table's largest weight or target. */
function WeightCell({ weight, target, scale }: { weight: number | null; target: Target; scale: number }) {
  const at = (fraction: number) => `${Math.min(100, (fraction / scale) * 100)}%`;
  return (
    <Box sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", alignItems: "flex-end", gap: 0.75, minWidth: 0, textAlign: "right" }}>
      <Typography component="span" sx={{ fontSize: "inherit" }}>
        <b>{weight !== null ? pctText(weight) : DASH}</b>
        {target ? (
          <Box
            component="span"
            title={target.fromWatchlist ? "Target from the watchlist" : undefined}
            sx={{ color: "var(--muted)" }}
          >
            {" / "}
            {targetText(target.target)}
            {target.fromWatchlist && (
              <Eye size={11} role="img" aria-label="from watchlist" style={{ marginLeft: 3, verticalAlign: "-1px" }} />
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
  watched,
  onEdit,
  onWatch,
}: {
  holding: HoldingSummary;
  target: Target;
  scale: number;
  watched: boolean;
  onEdit: () => void;
  onWatch: () => void;
}) {
  // minWidth 0 lets a cell shrink with its minmax(0, fr) track; a long number then wraps, never overflows.
  const cell = { display: { xs: "none", md: "block" }, textAlign: "right" as const, minWidth: 0, overflowWrap: "anywhere" as const };
  const value = holding.market_value !== null ? formatAmount(holding.market_value) : DASH;
  const pl =
    holding.unrealized_pl !== null && holding.unrealized_pl_pct !== null
      ? `${formatSigned(holding.unrealized_pl)} · ${formatPct(holding.unrealized_pl_pct)}`
      : DASH;
  return (
    <Box sx={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
    <ButtonBase
      aria-label={`Edit ${holding.ticker}${target?.fromWatchlist ? " (target from watchlist)" : ""}`}
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
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{holding.ticker}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>{holding.name}</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", display: { md: "none" } }}>
          {shortShares(holding.shares)} sh · {holding.weight !== null ? pctText(holding.weight) : DASH}
          {target ? (
            ` / target ${targetText(target.target)}${target.fromWatchlist ? " (watchlist)" : ""}`
          ) : (
            <> · <SetTarget /></>
          )}
        </Typography>
      </Box>
      <Typography sx={cell}>{holding.shares}</Typography>
      <Typography sx={{ ...cell, display: AVG_COST_DISPLAY }}>{formatAmount(holding.cost_basis)}</Typography>
      <Typography sx={cell}>
        {holding.current_price !== null ? formatAmount(holding.current_price) : DASH}
      </Typography>
      <Box sx={{ textAlign: "right", display: { xs: "block", md: "none" } }}>
        <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
        <Typography sx={{ fontSize: 12, color: plColor(holding.unrealized_pl) }}>{pl}</Typography>
      </Box>
      <Typography sx={{ ...cell, fontWeight: 600 }}>{value}</Typography>
      <Typography sx={{ ...cell, color: plColor(holding.unrealized_pl) }}>{pl}</Typography>
      <WeightCell weight={holding.weight} target={target} scale={scale} />
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
  const [isinNote, setIsinNote] = useState<string | null>(null);
  // The ISIN typed to find the picked watchlist symbol; it only counts while the ticker still is that symbol.
  const [watchIsin, setWatchIsin] = useState<{ symbol: string; isin: string } | null>(null);

  const holdings = summary?.holdings ?? [];
  const open = holdings.filter((h) => h.shares > 0);
  // Nothing owned and nothing watched yet: the watchlist panel is the "or" next to the first-holding form.
  const justWatching = summary !== undefined && open.length === 0 && summary.watchlist.length === 0;
  const watchlist = summary?.watchlist ?? [];
  const targets = new Map(open.map((h) => [h.ticker, effectiveTarget(h, watchlist)]));
  // The weight bars share one scale, the largest weight or target in the table, so they compare.
  const scale = Math.max(0.01, ...open.map((h) => Math.max(h.weight ?? 0, targets.get(h.ticker)?.target ?? 0)));
  // A ticker you own keeps its target on the holding, so its watchlist row offers no target edit.
  const owned = new Set(open.map((h) => h.ticker.toUpperCase()));

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
  function addToWatchlist(ticker: string, assetType: AssetType, targetText = "", isin: string | null = null) {
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
      setWatchIsin(null);
      // The ISIN has its own route; a failure there does not undo the add.
      const note = await saveIsinAfterAdd(ticker, isin);
      if (note) setIsinNote(note);
      mutateSummary();
    });
  }

  return (
    <Box>
      <PageHeader
        title="Portfolio"
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
      <PortfolioTabs current="holdings" />

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
          // The watchlist sits beside the table only from lg; below that the table needs the full width.
          gridTemplateColumns: { lg: "minmax(0, 1fr) 320px" },
          gap: 2,
          mt: "20px",
          alignItems: "start",
        }}
      >
      {summary && open.length === 0 && <FirstHolding onSaved={() => mutateSummary()} onNote={setIsinNote} />}
      <IsinNote note={isinNote} onClose={() => setIsinNote(null)} />
      {open.length > 0 && (
        <Panel sx={{ p: "8px 18px" }}>
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: HOLDING_COLUMNS,
              gap: HOLDING_GAP,
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
            <Box component="span" sx={{ display: AVG_COST_DISPLAY }}>
              Avg cost
            </Box>
            <span>Price</span>
            <span>Value</span>
            <span>P/L</span>
            <span>Weight / Target</span>
          </Box>
          {open.map((holding) => (
            <HoldingRow
              key={holding.ticker}
              holding={holding}
              target={targets.get(holding.ticker) ?? null}
              scale={scale}
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
        {watchlist.map((item) => {
          const isOwned = owned.has(item.ticker.toUpperCase());
          return (
          <Box
            key={item.ticker}
            sx={{ display: "flex", alignItems: "center", py: 1, borderBottom: "1px solid var(--line)" }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.ticker}</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                {isOwned ? (
                  "Owned · target on the holding"
                ) : (
                  <>
                    {item.note ?? "Watching"}
                    {item.target_weight != null && ` · target ${targetText(item.target_weight)}`}
                  </>
                )}
              </Typography>
            </Box>
            <Typography>
              {item.current_price !== null ? formatAmount(item.current_price) : DASH}
            </Typography>
            {isOwned ? (
              // Keeps the price lined up with the rows that have a pencil.
              <Box sx={{ ml: 0.5, width: 25, flex: "none" }} />
            ) : (
              <IconButton
                size="small"
                aria-label={`Edit target for ${item.ticker}`}
                onClick={() => setEditingTarget(item)}
                sx={{ ml: 0.5, color: "var(--muted)" }}
              >
                <Pencil size={15} />
              </IconButton>
            )}
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
          );
        })}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 1, mt: 1.5 }}>
          <Box sx={{ flex: "1 1 120px", minWidth: 0 }}>
            <TickerPicker
              dense
              label="Watchlist ticker"
              value={watchTicker}
              onChange={setWatchTicker}
              onPick={(match) => {
                setWatchType(match.type);
                setWatchIsin(match.isin ? { symbol: match.symbol.toUpperCase(), isin: match.isin } : null);
              }}
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
            onClick={() =>
              void addToWatchlist(typedTicker, watchType, watchTarget, watchIsin?.symbol === typedTicker ? watchIsin.isin : null)
            }
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
