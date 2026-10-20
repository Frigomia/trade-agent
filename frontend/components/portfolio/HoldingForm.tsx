// frontend/components/portfolio/HoldingForm.tsx
"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Dialog, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { AssetType, HoldingSummary } from "@/lib/api/portfolio-types";
import { useAction } from "@/lib/useAction";
import { TargetWeightField } from "@/components/portfolio/TargetWeightField";
import { fractionToPercentText, percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";
import { TickerPicker } from "@/components/ui/TickerPicker";
import { saveIsinAfterAdd } from "@/lib/orders";
import { usePickedIsin } from "@/lib/usePickedIsin";
import type { SymbolMatch } from "@/lib/tickerSearch";

export interface HoldingFormProps {
  open: boolean;
  onClose: () => void;
  holding?: HoldingSummary; // edit mode when set
  heldTickers: string[];
  prefillTicker?: string;
  onSaved: () => void;
}

// The body lives in an inner component so its state resets each time the modal closes.
export function HoldingForm({ open, onClose, ...rest }: HoldingFormProps) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="holding-form-title">
      <HoldingFormBody onClose={onClose} {...rest} />
    </Dialog>
  );
}

function HoldingFormBody({
  holding,
  heldTickers,
  prefillTicker,
  onClose,
  onSaved,
}: Omit<HoldingFormProps, "open">) {
  const editing = holding !== undefined;
  const [ticker, setTicker] = useState(holding?.ticker ?? prefillTicker ?? "");
  const [name, setName] = useState(holding?.name ?? "");
  const [assetType, setAssetType] = useState<AssetType | "">(holding?.asset_type ?? "");
  const [shares, setShares] = useState(holding ? String(holding.shares) : "");
  const [costBasis, setCostBasis] = useState(holding?.cost_basis == null ? "" : String(holding.cost_basis));
  const [firstPurchase, setFirstPurchase] = useState(holding?.first_purchase_date ?? "");
  const [showMore, setShowMore] = useState(editing);
  const [target, setTarget] = useState(fractionToPercentText(holding?.target_weight));
  const { run, submitting, error, setError } = useAction();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { pick, isinFor } = usePickedIsin();

  const normalizedTicker = ticker.trim().toUpperCase();
  // Existing tickers require an explicit update action instead of silently replacing a position.
  const replacesExisting = !editing && heldTickers.includes(normalizedTicker);

  // A search result fills the name and type too; both stay editable below.
  function handlePick(match: SymbolMatch) {
    setName(match.name);
    setAssetType(match.type);
    pick(match);
  }

  function changeTicker(value: string) {
    setTicker(value);
    setName("");
    setAssetType("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const sharesNum = Number(shares);
    const costNum = costBasis.trim() === "" ? null : Number(costBasis);
    if (
      !normalizedTicker ||
      shares === "" ||
      // Editing shares to 0 is how a position is closed; a new holding must be positive.
      !Number.isFinite(sharesNum) || !(editing ? sharesNum >= 0 : sharesNum > 0) ||
      (costNum !== null && (!Number.isFinite(costNum) || costNum < 0))
    ) {
      setError("Enter a ticker and valid shares. Average cost is optional and cannot be negative.");
      return;
    }
    const targetWeight = percentTextToFraction(target);
    if (targetWeight === undefined) {
      setError(TARGET_ERROR);
      return;
    }
    const purchaseDetails = editing || !replacesExisting ? {
      cost_basis: costNum, first_purchase_date: firstPurchase || null,
      target_weight: targetWeight,
    } : {
      ...(costNum !== null ? { cost_basis: costNum } : {}),
      ...(firstPurchase ? { first_purchase_date: firstPurchase } : {}),
      ...(target.trim() ? { target_weight: targetWeight } : {}),
    };
    await run(async () => {
      try {
        await apiFetch("/portfolio/holdings", {
          method: "POST",
          body: JSON.stringify({
            ticker: normalizedTicker,
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(assetType ? { asset_type: assetType } : {}),
            shares: sharesNum,
            ...purchaseDetails,
            ...(editing ? { sector: holding.sector } : {}),
          }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) setShowMore(true);
        throw err;
      }
      // The holdings upsert never carries the ISIN; it has its own route, and a failure there does not undo the save.
      await saveIsinAfterAdd(normalizedTicker, editing ? null : isinFor(normalizedTicker));
      onSaved();
      onClose();
    });
  }

  async function handleRemove() {
    if (!holding) return;
    await run(async () => {
      await apiFetch(`/portfolio/holdings/${encodeURIComponent(holding.ticker)}`, {
        method: "DELETE",
      });
      onSaved();
      onClose();
    });
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ width: "100%", p: 3 }}>
      <Typography id="holding-form-title" variant="h6" sx={{ fontWeight: 650 }}>
        {editing ? `Edit ${holding.ticker}` : "Add holding"}
      </Typography>
      {editing ? (
        <TextField label="Ticker" value={ticker} disabled fullWidth margin="normal" />
      ) : (
        <TickerPicker label="Ticker" value={ticker} onChange={changeTicker} onPick={handlePick} />
      )}
      {replacesExisting && (
        <Alert severity="warning">
          You already hold {normalizedTicker}. Update its total shares below. Blank purchase details keep
          the existing values. Use Log a trade to record an additional purchase.
        </Alert>
      )}
      <TextField label="Shares" type="number" value={shares} onChange={(e) => setShares(e.target.value)}
        fullWidth margin="normal" slotProps={{ htmlInput: { step: "any", min: editing ? 0 : undefined } }}
        helperText="Fractional shares are supported." />
      <Typography sx={{ fontSize: 13, color: "var(--muted)", mt: 1 }}>
        Company details fill automatically. Without an average cost, this holding stays out of P/L.
      </Typography>
      <Button type="button" onClick={() => setShowMore(!showMore)} aria-expanded={showMore} sx={{ mt: 1 }}>
        Purchase details and overrides (optional)
      </Button>
      {showMore && <>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
        margin="normal"
      />
      <TextField
        select
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        label="Type"
        value={assetType}
        onChange={(e) => setAssetType(e.target.value as AssetType | "")}
        fullWidth
        margin="normal"
      >
        <option value="">Automatic</option>
        <option value="STOCK">Stock</option>
        <option value="ETF">ETF</option>
      </TextField>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Average cost"
          type="number"
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          fullWidth
          margin="normal"
          helperText="Optional; leave empty if unknown."
          slotProps={{ htmlInput: { step: "any", min: 0 } }}
        />
      </Box>
      <TextField
        label="First purchase date"
        type="date"
        slotProps={{ inputLabel: { shrink: true } }}
        value={firstPurchase}
        onChange={(e) => setFirstPurchase(e.target.value)}
        fullWidth
        margin="normal"
      />
      <TargetWeightField value={target} onChange={setTarget} fullWidth margin="normal" />
      </>}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        {replacesExisting ? "Update position" : "Save holding"}
      </Button>
      <Button type="button" fullWidth sx={{ mt: 1 }} onClick={onClose}>Cancel</Button>
      {editing &&
        (confirmingRemove ? (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 13, mb: 1 }}>
              Remove {holding.ticker}? This can&apos;t be undone.
            </Typography>
            <Button
              color="error"
              variant="contained"
              fullWidth
              disabled={submitting}
              onClick={handleRemove}
            >
              Confirm remove
            </Button>
          </Box>
        ) : (
          <Button color="error" fullWidth sx={{ mt: 2 }} onClick={() => setConfirmingRemove(true)}>
            Remove holding
          </Button>
        ))}
    </Box>
  );
}
