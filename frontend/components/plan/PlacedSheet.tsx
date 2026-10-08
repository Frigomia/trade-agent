"use client";

import { useId, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { ShieldCheck, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import type { AssetType, PortfolioSummary } from "@/lib/api/portfolio-types";
import { todayIso } from "@/lib/format";
import { parsePlacedNumber, placeLine, trim } from "@/lib/orders";
import type { PlanLine } from "@/lib/plans";
import { useAction } from "@/lib/useAction";

const NETWORK = "Could not reach the server. Check the line: if it does not show as placed, try again.";
const muted = { fontSize: 12.5, color: "var(--muted)" } as const;

export interface PlacedSheetProps {
  open: boolean;
  /** The line being recorded; kept while the sheet slides out. */
  line: PlanLine | null;
  planId: number | null; // null (a preview) never opens the sheet
  /** The portfolio summary the page already loads; undefined while it loads or when it failed. */
  summary: PortfolioSummary | undefined;
  onClose: () => void;
  /** After the server recorded it. The sheet does not close itself: the caller closes it. */
  onPlaced: (line: PlanLine) => void;
  /** Reloads the plan, so a line placed elsewhere (409) settles. */
  onChanged: () => Promise<unknown>;
}

/**
 * Record placed order: a bottom sheet on phones, a right drawer on desktop. The form lives in an inner
 * component, keyed by the line, so its state starts fresh each time (MUI unmounts a closed drawer's
 * children). It only records the order here: approval never reaches a broker.
 */
export function PlacedSheet({ open, line, planId, summary, onClose, onPlaced, onChanged }: PlacedSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));
  const titleId = useId();
  return (
    <Drawer
      anchor={isPhone ? "bottom" : "right"}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": titleId,
          sx: { borderRadius: { xs: "16px 16px 0 0", md: 0 }, maxHeight: { xs: "92dvh", md: "none" } },
        },
      }}
    >
      {line && line.id !== null && planId !== null && (
        <PlacedForm
          key={line.ticker}
          line={line}
          lineId={line.id}
          planId={planId}
          summary={summary}
          titleId={titleId}
          onClose={onClose}
          onPlaced={onPlaced}
          onChanged={onChanged}
        />
      )}
    </Drawer>
  );
}

interface PlacedFormProps extends Omit<PlacedSheetProps, "open" | "line" | "planId"> {
  line: PlanLine;
  lineId: number;
  planId: number;
  titleId: string;
}

function PlacedForm({ line, lineId, planId, summary, titleId, onClose, onPlaced, onChanged }: PlacedFormProps) {
  // The backend's rule is "a holding row exists for the ticker". The summary lists every holding row,
  // closed ones (0 shares) included, so this mirrors it. Until the summary has loaded the ticker counts
  // as new: the choice is then shown and sent, and the backend ignores it for an existing holding.
  const isNew = !summary?.holdings.some((h) => h.ticker === line.ticker);
  const watched = summary?.watchlist.find((w) => w.ticker === line.ticker);
  const [assetType, setAssetType] = useState<AssetType>(watched?.asset_type ?? "ETF");
  // Planned shares, prefilled; the price stays empty: the plan's price is in EUR, the trade's is not.
  const [shares, setShares] = useState(() => String(Number(line.shares.toFixed(6))));
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIso);
  const [placedElsewhere, setPlacedElsewhere] = useState(false);
  const { run, submitting, error } = useAction();

  const sharesNum = parsePlacedNumber(shares);
  const priceNum = parsePlacedNumber(price);
  const ready = sharesNum !== null && priceNum !== null && date !== "" && !placedElsewhere;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready || sharesNum === null || priceNum === null) return;
    await run(async () => {
      try {
        await placeLine(planId, lineId, {
          date,
          shares: sharesNum,
          price: priceNum,
          ...(isNew ? { asset_type: assetType } : {}),
        });
      } catch (err) {
        if (!(err instanceof ApiError)) throw new ApiError(0, NETWORK);
        if (err.status === 409 && err.detail.includes("already recorded")) {
          setPlacedElsewhere(true);
          await onChanged().catch(() => undefined); // the row settles; the message below still shows
        }
        throw err;
      }
      onPlaced(line);
    });
  }

  const badShares = shares.trim() !== "" && sharesNum === null;
  const badPrice = price.trim() !== "" && priceNum === null;

  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit}
      sx={{ width: { xs: "auto", md: 420 }, p: 3, pb: { xs: 4, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: 18, fontWeight: 650 }}>
          Record placed order
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ mr: -1 }}>
          <X size={20} />
        </IconButton>
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 650 }}>{line.ticker}</Typography>
        <Typography sx={{ ...muted, overflowWrap: "anywhere" }}>{line.name}</Typography>
      </Box>

      <TextField
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        fullWidth
      />
      <TextField
        label="Shares"
        value={shares}
        onChange={(e) => setShares(e.target.value)}
        error={badShares}
        helperText={
          badShares
            ? "Enter a number of shares above 0."
            : `From the plan: about ${trim(line.shares)} shares. Change it if your broker filled a different number.`
        }
        slotProps={{ htmlInput: { inputMode: "decimal", autoComplete: "off" } }}
        fullWidth
      />
      <TextField
        label="Price per share"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={badPrice}
        helperText={badPrice ? "Enter a price above 0." : "Price in the currency of this holding"}
        slotProps={{ htmlInput: { inputMode: "decimal", autoComplete: "off" } }}
        fullWidth
      />

      {isNew && (
        <Box>
          <Typography id={`${titleId}-type`} sx={{ fontSize: 13, fontWeight: 500, mb: 0.75 }}>
            Asset type
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            aria-labelledby={`${titleId}-type`}
            value={assetType}
            onChange={(_, next: AssetType | null) => next && setAssetType(next)}
          >
            <ToggleButton value="ETF">ETF</ToggleButton>
            <ToggleButton value="STOCK">Stock</ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ ...muted, mt: 0.75 }}>
            {line.ticker} is not a holding yet. Recording this order adds it to your holdings.
            {watched ? " Prefilled from your watchlist." : ""}
          </Typography>
        </Box>
      )}

      <Typography sx={{ ...muted, display: "flex", gap: 1, alignItems: "flex-start" }}>
        <Box component="span" sx={{ color: "var(--accent)", display: "flex", pt: "1px" }}>
          <ShieldCheck size={15} aria-hidden />
        </Box>
        This only records the order here. Nothing is sent to a broker.
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: "flex", gap: 1.25 }}>
        <Button variant="outlined" onClick={onClose} sx={{ flex: 1, minHeight: 48 }}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={!ready || submitting} sx={{ flex: 1, minHeight: 48 }}>
          Record order
        </Button>
      </Box>
    </Box>
  );
}
