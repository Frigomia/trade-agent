"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Button } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, TradeAction } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { IsinNote } from "@/components/ui/IsinNote";
import { HoldingForm } from "./HoldingForm";
import { TradeSheet } from "./TradeSheet";

// HOLD and WATCH have no trade to record, so they map to nothing.
const TRADE_ACTION: Partial<Record<RecommendationOut["action"], TradeAction>> = {
  BUY: "BUY",
  ADD: "BUY",
  TRIM: "SELL",
  SELL: "SELL",
};

/**
 * "Log the trade I placed", shown after an approval. Opens Log a trade when the ticker is already a
 * holding (including a sold-out one), or the Add-holding form when it isn't — Log a trade can't open
 * a position. Nothing here places a trade: it only records one already made in a broker app.
 */
export function LogTradeCta({ recommendation }: { recommendation: RecommendationOut }) {
  const { data: summary, mutate } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const [open, setOpen] = useState(false);
  const [logged, setLogged] = useState(false);
  // Kept here: HoldingForm is replaced by the "Trade logged." alert once saved.
  const [isinNote, setIsinNote] = useState<string | null>(null);

  const action = TRADE_ACTION[recommendation.action];
  if (!action || !summary) return null;

  const held = summary.holdings.some((h) => h.ticker === recommendation.ticker);
  if (!held && action === "SELL") return null; // nothing to sell, and no way to open a position

  if (logged) {
    return (
      <>
        <Alert severity="success" sx={{ mt: 2, textAlign: "left" }}>
          Trade logged.
        </Alert>
        <IsinNote note={isinNote} onClose={() => setIsinNote(null)} />
      </>
    );
  }

  const done = () => {
    mutate();
    setLogged(true);
  };

  return (
    <>
      <Button variant="contained" fullWidth sx={{ mt: 2.5 }} onClick={() => setOpen(true)}>
        Log the trade I placed
      </Button>
      {held ? (
        <TradeSheet
          open={open}
          onClose={() => setOpen(false)}
          holdings={summary.holdings.map((h) => ({ ticker: h.ticker, name: h.name }))}
          prefill={{ ticker: recommendation.ticker, action }}
          onLogged={done}
        />
      ) : (
        <HoldingForm
          open={open}
          onClose={() => setOpen(false)}
          heldTickers={summary.holdings.map((h) => h.ticker)}
          prefillTicker={recommendation.ticker}
          onSaved={done}
          onNote={setIsinNote}
        />
      )}
    </>
  );
}
