"use client";

import { useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Alert, Box, Button, Checkbox, Drawer, FormControlLabel, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecurringData, RecurringInput, RecurringOccurrence, RecurringPlan, RecurringPreview } from "@/lib/api/recurring-types";
import type { AssetType } from "@/lib/api/portfolio-types";
import type { SymbolMatch } from "@/lib/tickerSearch";
import { formatAmount } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { TickerPicker } from "@/components/ui/TickerPicker";
import { Panel } from "@/components/ui/Panel";

export const RECURRING_PATH = "/portfolio/recurring";
const DISCLAIMER = "Purchases are estimated from market prices. No orders are placed or verified.";
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "HKD", "CNY", "INR", "KRW", "TWD", "SGD", "BRL", "MXN", "ZAR", "NZD", "CZK", "HUF", "TRY", "ILS", "SAR", "AED", "THB", "IDR", "MYR", "CLP", "COP", "QAR", "KWD", "PHP", "EGP"];
const FREQUENCIES = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", custom: "Custom" };
const select = { select: { native: true }, inputLabel: { shrink: true } } as const;

export function recurringLabel(plan: RecurringPlan): string {
  const cadence = plan.frequency === "custom" ? `every ${plan.interval_count} ${plan.interval_unit}` : FREQUENCIES[plan.frequency].toLowerCase();
  return `${formatAmount(Number(plan.amount))} ${plan.currency} · ${cadence}`;
}

/** One shared form, embedded in the existing holding/trade drawer or in plan management. */
export function RecurringPlanForm({ plan, prefill, onSaved, onClose, onBusyChange }: {
  plan?: RecurringPlan;
  prefill?: { ticker: string; name?: string; asset_type?: AssetType };
  onSaved: () => void; onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [ticker, setTicker] = useState(plan?.ticker ?? prefill?.ticker ?? "");
  const [picked, setPicked] = useState<SymbolMatch | null>(null);
  const [amount, setAmount] = useState(plan ? String(plan.amount) : "");
  const [currency, setCurrency] = useState(plan?.currency ?? "EUR");
  const [frequency, setFrequency] = useState<RecurringInput["frequency"]>(plan?.frequency ?? "monthly");
  const [count, setCount] = useState(String(plan?.interval_count ?? 1));
  const [unit, setUnit] = useState<"days" | "weeks" | "months">(plan?.interval_unit ?? "months");
  const [start, setStart] = useState(() => plan?.start_date ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  const [end, setEnd] = useState(plan?.end_date ?? "");
  const [approveBackfill, setApproveBackfill] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: RecurringPreview } | null>(null);
  const { mutate } = useSWRConfig();
  const { run, error, submitting, setError } = useAction(onBusyChange);
  const payload: RecurringInput = {
    ticker, name: plan?.name ?? picked?.name ?? prefill?.name ?? ticker, source: plan?.source,
    asset_type: plan?.asset_type ?? picked?.type ?? prefill?.asset_type ?? "STOCK",
    amount, currency, frequency, interval_count: Number(count), interval_unit: unit,
    start_date: start, end_date: end || null,
  };
  const key = JSON.stringify(payload);
  const current = preview?.key === key ? preview.data : null;
  const historical = !plan && (current?.catch_up_count ?? 0) > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan && !prefill?.ticker && (!picked || picked.symbol !== ticker)) {
      setError("Select the actual stock or ETF listing from search results."); return;
    }
    await run(async () => {
      if (!current) {
        const result = await apiFetch<RecurringPreview>(`${RECURRING_PATH}/preview${plan ? "?editing=true" : ""}`, { method: "POST", body: key });
        setApproveBackfill(false); setPreview({ key, data: result }); return;
      }
      if (current.conflict || (historical && !approveBackfill)) {
        setError(current.conflict ?? "Approve the previewed historical estimates before saving."); return;
      }
      await apiFetch(plan ? `${RECURRING_PATH}/${plan.id}` : RECURRING_PATH, {
        method: plan ? "PUT" : "POST", body: JSON.stringify({ ...payload, backfill: historical && approveBackfill }),
      });
      await mutate(RECURRING_PATH);
      onSaved(); onClose();
    });
  }
  const schedule = frequency === "monthly" ? `on day ${Number(start.slice(8))} of each month (month end when shorter)`
    : frequency === "weekly" || frequency === "biweekly" ? `${frequency === "weekly" ? "every" : "every other"} ${new Date(`${start}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" })}`
    : `every ${count} ${unit}, anchored to ${start}`;
  return <Box component="form" onSubmit={submit} sx={{ display: "grid", gap: 2, minWidth: 0 }}>
    <Typography component="h2" variant="h6">{plan ? "Edit recurring plan" : "Recurring investment"}</Typography>
    {plan ? <Typography>{plan.name} · {plan.ticker}</Typography> : <TickerPicker label="Stock / ETF" value={ticker}
      onChange={(value) => { setTicker(value); setPicked(null); }} onPick={(match) => { setPicked(match); setTicker(match.symbol); }} />}
    <TextField label="Contribution amount" value={amount} onChange={(e) => setAmount(e.target.value)} required
      slotProps={{ htmlInput: { inputMode: "decimal", pattern: "[0-9]+([.][0-9]{1,2})?" } }} />
    <TextField select label="Contribution currency" value={currency} onChange={(e) => setCurrency(e.target.value)} slotProps={select}>
      {!CURRENCIES.includes(currency) && <option value={currency} disabled>{currency} (choose a supported currency)</option>}
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </TextField>
    <TextField select label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringInput["frequency"])} slotProps={select}>
      {Object.entries(FREQUENCIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </TextField>
    {frequency === "custom" && <Box sx={{ display: "flex", gap: 1.5, "& > *": { flex: 1, minWidth: 0 } }}>
      <TextField label="Every" type="number" required value={count} onChange={(e) => setCount(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 365 } }} />
      <TextField select label="Interval" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} slotProps={select}>
        {(["days", "weeks", "months"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
      </TextField>
    </Box>}
    <TextField label="Start / anchor date" type="date" required value={start} onChange={(e) => setStart(e.target.value)}
      helperText="This date chooses the weekday or day of month. Schedule dates use Europe/Berlin."
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: "2000-01-01", max: "2100-12-31" } }} />
    <TextField label="End date (optional)" type="date" value={end} onChange={(e) => setEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
    <Typography sx={{ fontSize: "0.8125rem" }}>{amount || "0"} {currency} into {payload.name || "your selected instrument"} {schedule}. LTH will automatically add estimated purchases to your portfolio.</Typography>
    <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{DISCLAIMER} Fractional units are estimated to six decimals; fees are excluded.</Typography>
    {plan && <Typography sx={{ fontSize: "0.8125rem" }}>Edits apply after today. Existing history stays intact.</Typography>}
    {plan && !plan.tracking_enabled && <Alert severity="warning">Saving enables future estimates and skips unconfirmed legacy entries. Record past purchases before saving.</Alert>}
    {current && <Alert severity={current.conflict ? "warning" : "info"}>
      Next dates: {current.upcoming_dates.join(", ") || "None before the end date"}.
      {historical && ` ${current.catch_up_count} historical estimates, ${current.first_date} to ${current.last_date}.`}
      {current.conflict}
    </Alert>}
    {current && historical && !current.conflict && <FormControlLabel control={<Checkbox checked={approveBackfill} onChange={(e) => setApproveBackfill(e.target.checked)} />} label="Add these historical estimates to my portfolio" />}
    {error && <Alert severity="error">{error}</Alert>}
    <Button type="submit" variant="contained" disabled={submitting || !!current?.conflict}>{current ? "Save recurring plan" : "Preview schedule"}</Button>
    <Button onClick={onClose} disabled={submitting}>Cancel</Button>
  </Box>;
}

function CorrectionForm({ item, onDone, onBusyChange }: { item: RecurringOccurrence; onDone: () => void; onBusyChange: (busy: boolean) => void }) {
  const legacy = item.status === "scheduled";
  const [shares, setShares] = useState(item.shares ?? "");
  const [price, setPrice] = useState(item.price ?? "");
  const [date, setDate] = useState(item.trade_date ?? item.effective_date ?? item.scheduled_date);
  const [voiding, setVoiding] = useState(false);
  const { run, submitting, error } = useAction(onBusyChange);
  const save = () => run(async () => {
    await apiFetch(`${RECURRING_PATH}/occurrences/${item.id}/${legacy ? "confirm" : "estimate"}`, { method: legacy ? "POST" : "PUT", body: JSON.stringify({ date, shares: Number(shares), price: Number(price) }) }); onDone();
  });
  return <Box component="form" onSubmit={(e) => { e.preventDefault(); void save(); }} sx={{ display: "grid", gap: 2 }}>
    <Typography variant="h6">{legacy ? "Record actual purchase" : "Correct estimate"} · {item.ticker}</Typography>
    <Typography>{legacy ? "Enter details of a purchase that already happened." : "Enter actual details to reconcile this purchase. Corrections stay unchanged on future runs."}</Typography>
    <TextField label="Shares" required type="number" value={shares} onChange={(e) => setShares(e.target.value)} slotProps={{ htmlInput: { min: 0.000001, step: "any" } }} />
    <TextField label={`Price (${item.quote_currency ?? "quote unit"})`} required type="number" value={price} onChange={(e) => setPrice(e.target.value)} slotProps={{ htmlInput: { min: 0.000001, step: "any" } }} />
    <TextField label="Purchase date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
    {error && <Alert severity="error">{error}</Alert>}
    <Button variant="contained" type="submit" disabled={submitting}>Save actual details</Button>
    {!legacy && (voiding ? <>
      <Typography>Remove this estimate from your position? Its audit record will remain and the job will never recreate it.</Typography>
      <Button color="error" disabled={submitting} onClick={() => void run(async () => { await apiFetch(`${RECURRING_PATH}/occurrences/${item.id}/estimate`, { method: "DELETE" }); onDone(); })}>Confirm void estimate</Button>
    </> : <Button disabled={submitting} onClick={() => setVoiding(true)}>Void estimate</Button>)}
    <Button disabled={submitting} onClick={onDone}>Back to plans</Button>
  </Box>;
}

/** Compact management entry; no new Portfolio destination and no fake zero-share holding. */
export function RecurringInvestments({ ticker, onChanged }: { ticker?: string; onChanged?: () => void }) {
  const { data, error, mutate } = useSWR<RecurringData>(RECURRING_PATH, apiFetch);
  const { mutate: globalMutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringPlan | null>(null);
  const [correcting, setCorrecting] = useState<RecurringOccurrence | null>(null);
  const [ending, setEnding] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const isPhone = useMediaQuery(useTheme().breakpoints.down("md"));
  const { run, submitting, error: actionError } = useAction(setBusy);
  const plans = (data?.plans ?? []).filter((p) => !ticker || p.ticker === ticker);
  if (ticker && plans.length === 0) return null;
  async function refresh() { await mutate(); await globalMutate("/portfolio/summary"); onChanged?.(); }
  function close() { setOpen(false); setEditing(null); setCorrecting(null); setEnding(null); }
  const change = (id: number, status: string) => run(async () => {
    await apiFetch(`${RECURRING_PATH}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setEnding(null); await refresh();
  });
  return <>
    <Button onClick={() => setOpen(true)} size="small" sx={{ minHeight: 44, fontSize: "0.75rem", color: "var(--muted)", textAlign: "left", whiteSpace: "normal" }}>
      {ticker ? `↻ ${plans.map((p) => `${recurringLabel(p)} · ${p.status === "ended" ? "stopped" : p.status}`).join("; ")}` : "Manage recurring plans"}
    </Button>
    <Drawer anchor={isPhone ? "bottom" : "right"} open={open} onClose={busy ? undefined : close} slotProps={{ paper: { role: "dialog", "aria-modal": true, "aria-label": "Recurring plans", "aria-busy": busy } }}>
      <Box sx={{ width: { xs: "auto", md: 440 }, maxWidth: "100vw", p: 3, pb: "max(24px, env(safe-area-inset-bottom))", display: "grid", gap: 2 }}>
        {editing ? <RecurringPlanForm plan={editing} onSaved={() => void refresh()} onClose={() => setEditing(null)} onBusyChange={setBusy} />
        : correcting ? <CorrectionForm item={correcting} onBusyChange={setBusy} onDone={() => { setCorrecting(null); void refresh(); }} />
        : <>
          <Typography component="h2" variant="h6">Recurring plans{ticker ? ` · ${ticker}` : ""}</Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{DISCLAIMER}</Typography>
          {(data?.occurrences.length ?? 0) >= 500 && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Showing the latest 500 entries. Export your data for the full history.</Typography>}
          {error && <Alert severity="error">Could not load recurring plans.</Alert>}
          {data && plans.length === 0 && <Typography>No recurring plans. Create one from Add holding or Log a trade.</Typography>}
          {plans.map((p) => <Panel key={p.id} sx={{ p: 2, display: "grid", gap: 1, overflowWrap: "anywhere" }}>
            <Typography sx={{ fontWeight: 600 }}>{p.name} · {p.ticker}</Typography>
            <Typography>{recurringLabel(p)} · {p.status === "ended" ? "Stopped" : p.status}</Typography>
            <Typography sx={{ fontSize: "0.75rem" }}>Next scheduled: {p.next_date ?? "None"}</Typography>
            {!p.tracking_enabled && p.status !== "ended" && <Alert severity="info">Saved legacy plan. Review and save settings to start future automatic estimates. Prior records are preserved.</Alert>}
            {p.status !== "ended" && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              <Button disabled={submitting} onClick={() => setEditing(p)}>Edit</Button>
              {p.tracking_enabled && <Button disabled={submitting} onClick={() => void change(p.id, p.status === "paused" ? "active" : "paused")}>{p.status === "paused" ? "Resume" : "Pause"}</Button>}
              <Button disabled={submitting} onClick={() => setEnding(p.id)}>Stop</Button>
            </Box>}
            {ending === p.id && <>
              <Typography>Stop future estimates? Purchases already due will still be processed. Posted purchases and holdings stay intact.</Typography>
              <Button disabled={submitting} onClick={() => void change(p.id, "ended")}>Confirm stop</Button>
              <Button disabled={submitting} onClick={() => setEnding(null)}>Keep plan</Button>
            </>}
            {(data?.occurrences ?? []).filter((o) => o.plan_id === p.id).map((o) => <Box key={o.id} sx={{ py: 1, borderTop: "1px solid var(--line)" }}>
              <Typography sx={{ fontSize: "0.8125rem" }}>{o.scheduled_date} · {o.status === "posted" ? "Estimated" : o.status === "scheduled" ? p.tracking_enabled ? "Pending estimate" : "Awaiting purchase details" : o.status} · {formatAmount(Number(o.amount))} {o.currency}</Typography>
              {o.shares && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{o.shares} units · {o.price} {o.quote_currency} · {o.trade_date}. {o.status === "posted" ? "Estimated purchase" : o.status === "voided" ? "Voided estimate (excluded from position)" : "Recorded purchase"} · Plan #{p.id}</Typography>}
              {o.reference_price && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{o.pricing_source}. Reference {o.reference_price} {o.quote_currency} on {o.effective_date}; FX {o.fx_rate} on {o.fx_date}.</Typography>}
              {o.error && <Typography role="status" sx={{ fontSize: "0.75rem", color: "var(--warn)" }}>{o.error}</Typography>}
              {(o.status === "posted" || o.status === "reconciled") && <Button size="small" sx={{ minHeight: { xs: 44, md: 36 } }} onClick={() => setCorrecting(o)}>Correct estimate</Button>}
              {!p.tracking_enabled && o.status === "scheduled" && <Button size="small" onClick={() => setCorrecting(o)}>Record actual purchase</Button>}
              {!p.tracking_enabled && o.status === "skipped" && <Button size="small" disabled={submitting} onClick={() => void run(async () => { await apiFetch(`${RECURRING_PATH}/occurrences/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled" }) }); await refresh(); })}>Reopen purchase</Button>}
              {o.status === "scheduled" && <Button size="small" sx={{ minHeight: { xs: 44, md: 36 } }} disabled={submitting} onClick={() => void run(async () => { await apiFetch(`${RECURRING_PATH}/occurrences/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "skipped" }) }); await refresh(); })}>Skip estimate</Button>}
            </Box>)}
          </Panel>)}
          {actionError && <Alert severity="error">{actionError}</Alert>}
          <Button disabled={busy} onClick={close}>Close</Button>
        </>}
      </Box>
    </Drawer>
  </>;
}
