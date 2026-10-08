"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { Box, Button, InputAdornment, Link as MuiLink, Switch, TextField, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";
import { parseAmount } from "@/lib/plans";

const AMOUNT_ERROR = "Enter an amount from 0.01 to 1,000,000, two decimals at most.";

/** The ledger's top bar: amount, "Whole shares only" and "Make plan". The caller owns the values. */
export function PlanForm({
  amount,
  onAmountChange,
  wholeShares,
  onWholeSharesChange,
  onSubmit,
  pending,
}: {
  amount: string;
  onAmountChange: (value: string) => void;
  wholeShares: boolean;
  onWholeSharesChange: (value: boolean) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const valid = parseAmount(amount) !== null;
  const showError = amount.trim() !== "" && !valid;
  return (
    <Panel
      component="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (valid && !pending) onSubmit();
      }}
      sx={{ p: { xs: "14px 16px", md: "14px 18px" }, display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}
    >
      <TextField
        size="small"
        label="Amount this month"
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        error={showError}
        helperText={showError ? AMOUNT_ERROR : undefined}
        sx={{ width: { xs: "100%", sm: 190 } }}
        slotProps={{
          htmlInput: { inputMode: "decimal", autoComplete: "off" },
          input: { endAdornment: <InputAdornment position="end">EUR</InputAdornment> },
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography id="plan-whole-label" component="span" sx={{ fontSize: 14 }}>
          Whole shares only
        </Typography>
        <Switch
          checked={wholeShares}
          disabled={pending}
          onChange={(_, next) => onWholeSharesChange(next)}
          slotProps={{ input: { "aria-labelledby": "plan-whole-label" } }}
        />
      </Box>
      <Button type="submit" variant="contained" disabled={!valid || pending} sx={{ flex: { xs: "1 1 100%", sm: "none" } }}>
        Make plan
      </Button>
      <Typography sx={{ flex: "1 1 200px", fontSize: 12.5, color: "var(--muted)", textAlign: { sm: "right" } }}>
        Saved monthly amount, change it in{" "}
        <MuiLink component={Link} href="/more/preferences">
          Preferences
        </MuiLink>
      </Typography>
    </Panel>
  );
}
