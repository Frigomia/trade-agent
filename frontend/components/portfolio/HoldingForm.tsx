// frontend/components/portfolio/HoldingForm.tsx
"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Drawer, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AssetType, HoldingSummary } from "@/lib/api/portfolio-types";
import { todayIso } from "@/lib/format";
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

// The body lives in an inner component so its state resets each time the drawer closes.
export function HoldingForm({ open, onClose, ...rest }: HoldingFormProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <HoldingFormBody onClose={onClose} {...rest} />
    </Drawer>
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
  const [assetType, setAssetType] = useState<AssetType>(holding?.asset_type ?? "STOCK");
  const [shares, setShares] = useState(holding ? String(holding.shares) : "");
  const [costBasis, setCostBasis] = useState(holding ? String(holding.cost_basis) : "");
  const [firstPurchase, setFirstPurchase] = useState(holding?.first_purchase_date ?? todayIso());
  const [target, setTarget] = useState(fractionToPercentText(holding?.target_weight));
  const { run, submitting, error, setError } = useAction();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { pick, isinFor } = usePickedIsin();

  const normalizedTicker = ticker.trim().toUpperCase();
  // POST /portfolio/holdings is an upsert: adding a held ticker silently overwrites it.
  const replacesExisting = !editing && heldTickers.includes(normalizedTicker);

  // A search result fills the name and type too; both stay editable below.
  function handlePick(match: SymbolMatch) {
    setName(match.name);
    setAssetType(match.type);
    pick(match);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const sharesNum = Number(shares);
    const costNum = Number(costBasis);
    if (
      !normalizedTicker ||
      !name.trim() ||
      shares === "" ||
      costBasis === "" ||
      // Editing shares to 0 is how a position is closed; a new holding must be positive.
      !(editing ? sharesNum >= 0 : sharesNum > 0) ||
      !(editing ? costNum >= 0 : costNum > 0) ||
      !firstPurchase
    ) {
      setError("Enter a ticker, a name, shares, an average cost and a date.");
      return;
    }
    const targetWeight = percentTextToFraction(target);
    if (targetWeight === undefined) {
      setError(TARGET_ERROR);
      return;
    }
    await run(async () => {
      await apiFetch("/portfolio/holdings", {
        method: "POST",
        body: JSON.stringify({
          ticker: normalizedTicker,
          name: name.trim(),
          asset_type: assetType,
          shares: sharesNum,
          cost_basis: costNum,
          first_purchase_date: firstPurchase,
          // The endpoint is a full replace: always send the sector and target or a save would wipe them.
          sector: holding?.sector ?? null,
          target_weight: targetWeight,
        }),
      });
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
    <Box component="form" onSubmit={handleSubmit} sx={{ width: { xs: 320, md: 400 }, p: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        {editing ? `Edit ${holding.ticker}` : "Add holding"}
      </Typography>
      {editing ? (
        <TextField label="Ticker" value={ticker} disabled fullWidth margin="normal" />
      ) : (
        <TickerPicker label="Ticker" value={ticker} onChange={setTicker} onPick={handlePick} />
      )}
      {replacesExisting && (
        <Alert severity="warning">
          You already hold {normalizedTicker}. This replaces its shares and average cost; use Log a
          trade to add to a position.
        </Alert>
      )}
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
        onChange={(e) => setAssetType(e.target.value as AssetType)}
        fullWidth
        margin="normal"
      >
        <option value="STOCK">Stock</option>
        <option value="ETF">ETF</option>
      </TextField>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Shares"
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Average cost"
          type="number"
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          fullWidth
          margin="normal"
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
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Save holding
      </Button>
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
