"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Alert, Box, Button, ButtonBase, TextField, Typography } from "@mui/material";
import { Camera, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import type {
  AssetType,
  HoldingSummary,
  PortfolioSummary,
  Snapshot,
} from "@/lib/api/portfolio-types";
import { formatAmount, formatPct, formatSigned } from "@/lib/format";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { Amount } from "@/components/portfolio/Amount";
import { HoldingForm } from "@/components/portfolio/HoldingForm";
import { PortfolioChart } from "@/components/portfolio/PortfolioChart";
import { TradeSheet } from "@/components/portfolio/TradeSheet";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/shell/PageHeader";

const DASH = "—";
const COLUMNS = { xs: "1fr auto", md: "1.6fr .6fr .8fr .8fr .9fr 1fr" };

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

function HoldingRow({ holding, onEdit }: { holding: HoldingSummary; onEdit: () => void }) {
  const cell = { display: { xs: "none", md: "block" }, textAlign: "right" as const };
  const value = holding.market_value !== null ? formatAmount(holding.market_value) : DASH;
  const pl =
    holding.unrealized_pl !== null && holding.unrealized_pl_pct !== null
      ? `${formatSigned(holding.unrealized_pl)} · ${formatPct(holding.unrealized_pl_pct)}`
      : DASH;
  return (
    <ButtonBase
      aria-label={`Edit ${holding.ticker}`}
      onClick={onEdit}
      sx={{
        display: "grid",
        gridTemplateColumns: COLUMNS,
        gap: 2,
        width: "100%",
        textAlign: "left",
        alignItems: "center",
        py: 1.5,
        borderBottom: "1px solid var(--line)",
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
  );
}

export default function PortfolioPage() {
  const {
    data: summary,
    error: summaryError,
    mutate: mutateSummary,
  } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const {
    data: snapshots,
    error: snapshotsError,
    mutate: mutateSnapshots,
  } = useSWR<Snapshot[]>(
    "/portfolio/snapshots",
    apiFetch,
  );
  useDailySnapshot();

  const [tradeOpen, setTradeOpen] = useState(false);
  const [holdingForm, setHoldingForm] = useState<{ open: boolean; holding?: HoldingSummary }>({
    open: false,
  });
  const snapshot = useAction();
  const watch = useAction();
  const [watchTicker, setWatchTicker] = useState("");
  const [watchType, setWatchType] = useState<AssetType>("STOCK");

  const holdings = summary?.holdings ?? [];
  const open = holdings.filter((h) => h.shares > 0);

  const recordSnapshot = () =>
    snapshot.run(async () => {
      await apiFetch("/portfolio/snapshot", { method: "POST" });
      mutateSnapshots();
    });

  function addToWatchlist() {
    const ticker = watchTicker.trim().toUpperCase();
    if (!ticker) return;
    return watch.run(async () => {
      await apiFetch("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker, asset_type: watchType }),
      });
      setWatchTicker("");
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

      {summary && open.length === 0 && (
        <Box sx={{ textAlign: "center", py: 5 }}>
          <Typography sx={{ color: "var(--muted)", mb: 2 }}>Your portfolio is empty.</Typography>
          <Button variant="contained" onClick={() => setHoldingForm({ open: true })}>
            Add holding
          </Button>
        </Box>
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

      {open.length > 0 && (
        <Box sx={{ my: 2 }}>
          {snapshotsError ? (
            <Alert severity="error">Could not load your value history.</Alert>
          ) : (
            <PortfolioChart snapshots={snapshots ?? []} />
          )}
        </Box>
      )}

      <Box
        sx={{
          display: { md: "grid" },
          gridTemplateColumns: { md: "minmax(0, 1fr) 320px" },
          gap: 2,
          alignItems: "start",
        }}
      >
      {open.length > 0 && (
        <Panel sx={{ p: "8px 18px", mb: { xs: 2, md: 0 } }}>
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: COLUMNS,
              gap: 2,
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
              onEdit={() => setHoldingForm({ open: true, holding })}
            />
          ))}
        </Panel>
      )}

      <Panel sx={{ p: "16px 18px" }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Watchlist</Typography>
        {(summary?.watchlist ?? []).map((item) => (
          <Box
            key={item.ticker}
            sx={{ display: "flex", py: 1, borderBottom: "1px solid var(--line)" }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.ticker}</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                {item.note ?? "Watching"}
              </Typography>
            </Box>
            <Typography>
              {item.current_price !== null ? formatAmount(item.current_price) : DASH}
            </Typography>
          </Box>
        ))}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 1, mt: 1.5 }}>
          <TextField
            size="small"
            sx={{ flex: "1 1 120px" }}
            label="Watchlist ticker"
            value={watchTicker}
            onChange={(e) => setWatchTicker(e.target.value)}
          />
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
          <Button variant="outlined" onClick={addToWatchlist} sx={{ whiteSpace: "nowrap" }}>
            Add to watchlist
          </Button>
        </Box>
        {watch.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {watch.error}
          </Alert>
        )}
      </Panel>
      </Box>

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
