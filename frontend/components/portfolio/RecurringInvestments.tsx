"use client";

import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecurringData, RecurringInput, RecurringOccurrence, RecurringPlan, RecurringPreview } from "@/lib/api/recurring-types";
import { formatAmount, todayIso } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { PortfolioTabs } from "./PortfolioTabs";
import { TradeSheet } from "./TradeSheet";

const PATH = "/portfolio/recurring";

function PlanForm({ plan, onSaved, onClose }: { plan: RecurringPlan | null; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [ticker, setTicker] = useState(plan?.ticker ?? "");
  const [assetType, setAssetType] = useState<"STOCK" | "ETF">(plan?.asset_type ?? "STOCK");
  const [source, setSource] = useState(plan?.source ?? "");
  const [amount, setAmount] = useState(plan ? String(plan.amount) : "");
  const [currency, setCurrency] = useState(plan?.currency ?? "EUR");
  const [start, setStart] = useState(plan?.start_date ?? todayIso);
  const [preview, setPreview] = useState<{ input: string; data: RecurringPreview } | null>(null);
  const { run, error, submitting } = useAction();
  const payload: RecurringInput = { name, ticker: ticker.trim().toUpperCase(), asset_type: assetType, source: source.trim() || null,
    amount: Number(amount), currency: currency.trim().toUpperCase(), start_date: start, frequency: "monthly" };
  const input = JSON.stringify(payload);
  const currentPreview = preview?.input === input ? preview.data : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!currentPreview) {
        const data = await apiFetch<RecurringPreview>(`${PATH}/preview${plan ? "?editing=true" : ""}`, { method: "POST", body: input });
        setPreview({ input, data });
      } else {
        await apiFetch(plan ? `${PATH}/${plan.id}` : PATH, { method: plan ? "PUT" : "POST", body: input });
        onSaved();
        onClose();
      }
    });
  }

  return <Box component="form" onSubmit={submit}>
    <Stack spacing={2} sx={{ pt: 1 }}>
      <TextField required label="Name" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField required label="Stock / ETF ticker" value={ticker} onChange={e => setTicker(e.target.value)} slotProps={{ htmlInput: { maxLength: 20 } }} />
      <TextField select label="Asset type" value={assetType} onChange={e => setAssetType(e.target.value as "STOCK" | "ETF")}>
        <MenuItem value="STOCK">Stock</MenuItem><MenuItem value="ETF">ETF</MenuItem>
      </TextField>
      <TextField label="Source / account (optional)" value={source} onChange={e => setSource(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField required label="Expected amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} slotProps={{ htmlInput: { min: 0.01, step: 0.01, max: 9999999999.99 } }} />
      <TextField required label="Currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} slotProps={{ htmlInput: { pattern: "[A-Z]{3}", maxLength: 3 } }} />
      <TextField label="Frequency" value="Monthly" slotProps={{ input: { readOnly: true } }} />
      <TextField required label="Start date" type="date" value={start} onChange={e => setStart(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: "2000-01-01", max: "2100-12-31" } }} />
      <Typography>Entries are added automatically on the dates you set. Purchases happen through your employer or investment provider.</Typography>
      <Typography sx={{ color: "var(--muted)" }}>Dates use UTC. The 29th–31st use the last day in shorter months. A scheduled date does not confirm execution.</Typography>
      {plan ? <Typography>Edits apply after today. Entries already due keep their original details, including confirmed history.</Typography>
        : <Typography>A past start date creates all entries due through today as unconfirmed catch-up entries when you save.</Typography>}
      {currentPreview && <Alert severity="info">
        Next dates: {currentPreview.upcoming_dates.join(", ")}.
        {!plan && ` ${currentPreview.catch_up_count} unconfirmed entries will be added now.`}
      </Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" disabled={submitting}>{currentPreview ? "Save recurring investment" : "Preview dates"}</Button>
      <Button onClick={onClose} disabled={submitting}>Cancel</Button>
    </Stack>
  </Box>;
}

export function RecurringInvestments() {
  const { data, error, mutate } = useSWR<RecurringData>(PATH, apiFetch, { refreshInterval: 60000 });
  const { mutate: mutateGlobal } = useSWRConfig();
  const [editing, setEditing] = useState<RecurringPlan | null | undefined>();
  const [confirming, setConfirming] = useState<RecurringOccurrence | null>(null);
  const [ending, setEnding] = useState<RecurringPlan | null>(null);
  const { run, submitting, error: actionError } = useAction();
  const refresh = () => { void mutate(); };
  const change = (path: string, body: object) => run(async () => {
    await apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
    await mutate();
  });

  return <>
    <PageHeader title="Recurring investments" subtitle="Track purchases arranged with your employer or investment provider." />
    <PortfolioTabs current="recurring" />
    <Alert severity="info" sx={{ mb: 2 }}>Expected amounts are separate from confirmed holdings, cost basis and performance. They do not add to or subtract from the monthly contribution planner.</Alert>
    <Button variant="contained" onClick={() => setEditing(null)} sx={{ mb: 2 }}>Add recurring investment</Button>
    {error && <Alert severity="error">Could not load recurring investments. Try again.</Alert>}
    {!data && !error && <Typography>Loading recurring investments…</Typography>}
    {actionError && <Alert severity="error">{actionError}</Alert>}
    <Stack spacing={2}>
      {data?.plans.length === 0 && <Panel><Typography>No recurring investments yet.</Typography></Panel>}
      {data?.plans.map(plan => <Panel key={plan.id}>
        <Stack spacing={1}>
          <Typography variant="h6">{plan.name}</Typography>
          <Typography>{plan.ticker} · {plan.source || plan.asset_type} · {formatAmount(plan.amount)} {plan.currency} monthly</Typography>
          <Box><Chip label={plan.status} size="small" /></Box>
          <Typography>Next date: {plan.next_date ?? "None"}</Typography>
          {plan.upcoming_dates.length > 0 && <Typography sx={{ color: "var(--muted)" }}>Upcoming: {plan.upcoming_dates.join(", ")}</Typography>}
          {plan.status !== "ended" && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Button disabled={submitting} onClick={() => setEditing(plan)}>Edit</Button>
            <Button disabled={submitting} onClick={() => void change(`${PATH}/${plan.id}/status`, { status: plan.status === "active" ? "paused" : "active" })}>
              {plan.status === "active" ? "Pause" : "Resume"}
            </Button>
            <Button disabled={submitting} onClick={() => setEnding(plan)}>End plan</Button>
          </Box>}
          {plan.status === "paused" && <Typography>Resuming starts at the next date after today; paused dates are not added.</Typography>}
        </Stack>
      </Panel>)}
      <Panel>
        <Typography variant="h6" sx={{ mb: 1 }}>Recorded entries</Typography>
        <Typography sx={{ color: "var(--muted)", mb: 2 }}>Scheduled entries are expected purchases, still unconfirmed. Check your provider, then enter the actual details or skip the entry.</Typography>
        {data?.occurrences.length === 0 && <Typography>No entries are due yet.</Typography>}
        {data?.occurrences.map(item => <Box key={item.id} sx={{ py: 2, borderTop: "1px solid var(--line)" }}>
          <Typography sx={{ fontWeight: 600 }}>{data.plans.find(p => p.id === item.plan_id)?.name} · {item.ticker}</Typography>
          <Typography>{item.scheduled_date} · Expected {formatAmount(item.amount)} {item.currency}</Typography>
          <Typography>{item.status === "scheduled" ? "Scheduled · Unconfirmed" : item.status === "confirmed" ? `Confirmed · Trade #${item.trade_id}` : "Skipped"}</Typography>
          {item.status === "scheduled" && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Button disabled={submitting} onClick={() => setConfirming(item)}>Confirm actual purchase</Button>
            <Button disabled={submitting} onClick={() => void change(`${PATH}/occurrences/${item.id}`, { status: "skipped" })}>Skip</Button>
          </Box>}
          {item.status === "skipped" && <Button disabled={submitting} onClick={() => void change(`${PATH}/occurrences/${item.id}`, { status: "scheduled" })}>Reopen</Button>}
          {item.status === "confirmed" && <Typography sx={{ color: "var(--muted)" }}>To correct holdings after a logging mistake, edit shares and average cost on Holdings. This trade remains in the log.</Typography>}
        </Box>)}
      </Panel>
    </Stack>
    <Dialog open={editing !== undefined} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Edit recurring investment" : "Add recurring investment"}</DialogTitle>
      <DialogContent>{editing !== undefined && <PlanForm key={editing?.id ?? "new"} plan={editing} onSaved={refresh} onClose={() => setEditing(undefined)} />}</DialogContent>
    </Dialog>
    <Dialog open={!!ending} maxWidth="sm" fullWidth>
      <DialogTitle>End {ending?.name}?</DialogTitle>
      <DialogContent>
        <Typography>This permanently stops future entries. Entries already due are kept. Your external provider&apos;s plan is unaffected.</Typography>
        <Button disabled={submitting} onClick={() => void run(async () => {
          await apiFetch(`${PATH}/${ending?.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "ended" }) });
          setEnding(null); await mutate();
        })}>End plan</Button>
        <Button disabled={submitting} onClick={() => setEnding(null)}>Cancel</Button>
        {actionError && <Alert severity="error">{actionError}</Alert>}
      </DialogContent>
    </Dialog>
    {confirming && <TradeSheet open onClose={() => setConfirming(null)} holdings={[{ ticker: confirming.ticker, name: confirming.ticker }]}
      prefill={{ ticker: confirming.ticker, action: "BUY" }} recurringOccurrence={{ id: confirming.id, currency: confirming.currency }}
      onLogged={() => { refresh(); void mutateGlobal(key => typeof key === "string" && key.startsWith("/portfolio/")); }} />}
  </>;
}
