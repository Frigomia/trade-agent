"use client";
import { useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { HoldingForm } from "@/components/portfolio/HoldingForm";
import { TradeSheet } from "@/components/portfolio/TradeSheet";
import { LogTradeCta } from "@/components/portfolio/LogTradeCta";
import { RecurringInvestments } from "@/components/portfolio/RecurringInvestments";
import { PortfolioTabs } from "@/components/portfolio/PortfolioTabs";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/** Temporary development-only browser fixture. Copied into app/ by the Playwright test, then removed. */
export default function RecurringFixture() {
  const [holding, setHolding] = useState(false);
  const [trade, setTrade] = useState(false);
  const [saved, setSaved] = useState(false);
  if (process.env.NODE_ENV !== "development") return null;
  return <Box sx={{ p: 2, maxWidth: 1000, mx: "auto" }}>
    <Typography component="h1" variant="h5">Portfolio browser fixture</Typography>
    <ThemeToggle size={44} />
    <PortfolioTabs current="holdings" />
    <Button onClick={() => setHolding(true)}>Add holding</Button>
    <Button onClick={() => setTrade(true)}>Log a trade</Button>
    <RecurringInvestments />
    <LogTradeCta recommendation={{
      id: 1, user_id: "browser-test", created_at: "2026-11-06T00:00:00", ticker: "CNDX.L",
      asset_type: "ETF", action: "BUY", reasoning: [], ai_analysis: null,
      suggested_position_pct: null, status: "APPROVED", reviewed_at: null,
      fundamental_score: null, technical_signal: null, price_at_recommendation: null,
      current_price: null, price_change_pct: null,
    }} />
    {saved && <Typography role="status">Saved locally in test</Typography>}
    <HoldingForm open={holding} onClose={() => setHolding(false)} heldTickers={[]} onSaved={() => setSaved(true)} />
    <TradeSheet open={trade} onClose={() => setTrade(false)} prefill={{ ticker: "SAP.DE" }} holdings={[{ ticker: "SAP.DE", name: "SAP SE", asset_type: "STOCK" }]} onLogged={() => setSaved(true)} />
  </Box>;
}
