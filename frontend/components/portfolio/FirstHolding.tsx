"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, ButtonBase, TextField, Typography } from "@mui/material";
import { ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AssetType } from "@/lib/api/portfolio-types";
import { todayIso } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Panel } from "@/components/ui/Panel";
import { TickerPicker } from "@/components/ui/TickerPicker";
import { saveIsinAfterAdd } from "@/lib/orders";
import type { SymbolMatch } from "@/lib/tickerSearch";

const STEPS = ["Add holdings", "Run an analysis on Today", "Decide"];

/**
 * The empty Portfolio page is the form for the first holding: three fields, with name, type and date
 * tucked behind an "optional" row. A name defaults to the ticker and the date to today, so a
 * newcomer is one short form away from their first analysis. Saving is the same upsert the drawer uses.
 */
export function FirstHolding({
  onSaved,
  onNote,
}: {
  onSaved: () => void;
  /** Where to show the "ISIN not saved" note: this form is replaced by the table once saved. */
  onNote: (note: string) => void;
}) {
  // The ISIN typed to find the picked symbol; it only counts while the ticker still is that symbol.
  const [pickedIsin, setPickedIsin] = useState<{ symbol: string; isin: string } | null>(null);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("STOCK");
  const [firstPurchase, setFirstPurchase] = useState(todayIso);
  const { run, submitting, error, setError } = useAction();

  // A search result fills the name and type too; both stay editable in the optional row.
  function handlePick(match: SymbolMatch) {
    setName(match.name);
    setAssetType(match.type);
    setPickedIsin(match.isin ? { symbol: match.symbol.toUpperCase(), isin: match.isin } : null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedTicker = ticker.trim().toUpperCase();
    const sharesNum = Number(shares);
    const costNum = Number(costBasis);
    if (!normalizedTicker || !(sharesNum > 0) || !(costNum > 0) || !firstPurchase) {
      setError("Enter a ticker, shares and an average cost.");
      return;
    }
    await run(async () => {
      await apiFetch("/portfolio/holdings", {
        method: "POST",
        body: JSON.stringify({
          ticker: normalizedTicker,
          name: name.trim() || normalizedTicker,
          asset_type: assetType,
          shares: sharesNum,
          cost_basis: costNum,
          first_purchase_date: firstPurchase,
          sector: null,
          target_weight: null,
        }),
      });
      // The holdings upsert never carries the ISIN; a failure saving it does not undo the add.
      const isinNote = await saveIsinAfterAdd(
        normalizedTicker,
        pickedIsin?.symbol === normalizedTicker ? pickedIsin.isin : null,
      );
      if (isinNote) onNote(isinNote);
      onSaved();
    });
  }

  return (
    <Box>
      <Typography component="h2" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
        What do you own?
      </Typography>
      <Typography sx={{ fontSize: 14, color: "var(--muted)", mt: 0.5, mb: 2.25, maxWidth: 460 }}>
        Start with one holding. You can add the rest, and edit anything, later.
      </Typography>
      <Panel component="form" aria-label="First holding" onSubmit={handleSubmit} sx={{ p: 2.5 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.2fr 1fr 1.2fr" }, gap: 1.5 }}>
          <TickerPicker label="Ticker" value={ticker} onChange={setTicker} onPick={handlePick} />
          <TextField
            label="Shares"
            type="number"
            placeholder="10"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
          />
          <TextField
            label="Average cost"
            type="number"
            placeholder="150.00"
            value={costBasis}
            onChange={(e) => setCostBasis(e.target.value)}
          />
        </Box>
        <ButtonBase
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1.75, mb: 1.5, fontSize: 12.5, color: "var(--text2)" }}
        >
          <ChevronRight size={14} aria-hidden style={{ transform: showMore ? "rotate(90deg)" : undefined }} />
          <Box component="span" sx={{ textDecoration: "underline", textDecorationColor: "var(--line2)", textUnderlineOffset: 3 }}>
            Name, type and first purchase date
          </Box>
          <Box component="span" sx={{ color: "var(--muted)" }}>
            (optional)
          </Box>
        </ButtonBase>
        {showMore && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.4fr .8fr 1fr" }, gap: 1.5, mb: 1.5 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              select
              label="Type"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType)}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="STOCK">Stock</option>
              <option value="ETF">ETF</option>
            </TextField>
            <TextField
              label="First purchase date"
              type="date"
              value={firstPurchase}
              onChange={(e) => setFirstPurchase(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.75 }}>
          <Button type="submit" variant="contained" disabled={submitting}>
            Add holding
          </Button>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
            A record of what you own. Nothing is bought or sold.
          </Typography>
        </Box>
      </Panel>
      <Box component="ol" sx={{ display: "flex", flexWrap: "wrap", gap: 2.25, listStyle: "none", p: 0, m: 0, mt: 2, fontSize: 12, color: "var(--muted)" }}>
        {STEPS.map((step, i) => (
          <Box component="li" key={step} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              aria-hidden
              sx={{ width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--line2)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 650, color: "var(--text2)" }}
            >
              {i + 1}
            </Box>
            {step}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
