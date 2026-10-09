import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { AlertTriangle } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { formatAmount } from "@/lib/format";
import { formatRate, type LeftOut, type Plan, type PlanLine } from "@/lib/plans";

export const muted = { fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 } as const;
// Ticker | why | weight | price | amount. A phone keeps two lines per row and drops the price.
const COLUMNS = { xs: "minmax(0, 1fr) auto", md: "150px minmax(0, 1fr) 220px 130px 150px" };
const BEFORE = "color-mix(in oklab, var(--accent-solid) 42%, var(--bg))";

const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/** The bar scale shared by every line of a plan: the largest weight or target plus some headroom, so a target tick is always inside the track. */
export const weightScale = (plan: Plan) =>
  Math.max(0.01, ...plan.lines.flatMap((l) => [l.weight_before ?? 0, l.weight_after ?? 0, l.target_weight ?? 0])) * 1.15;

export function shares(line: PlanLine, whole: boolean): string {
  if (whole) return `${line.shares} sh`;
  return `about ${line.shares.toLocaleString("en-US", { maximumFractionDigits: 3 })} sh`;
}

const rowSx = {
  display: "grid",
  gridTemplateColumns: COLUMNS,
  gap: { xs: "6px 12px", md: 2 },
  alignItems: "center",
  px: { xs: 2, md: 2.5 },
  py: 1.5,
  borderTop: "1px solid var(--line)",
} as const;
// On a phone: amount beside the ticker, the rest full width below, no price.
const wide = { gridColumn: { xs: "1 / -1", md: "auto" } } as const;
const amountCell = { gridRow: { xs: 1, md: "auto" }, gridColumn: { xs: 2, md: "auto" }, textAlign: "right" } as const;
const priceCell = { display: { xs: "none", md: "block" }, textAlign: "right" } as const;

const TICK = { width: 2, borderRadius: 2, bgcolor: "var(--text)" } as const;

/**
 * Before (lighter) and after (solid) on one track scaled to the largest weight or target in the plan,
 * and the plan-time target as a tick when the line has one. Spans, so it fits in a button.
 */
function WeightBar({ before, after, target, scale }: { before: number; after: number; target: number | null; scale: number }) {
  const at = (value: number) => `${Math.min(value / scale, 1) * 100}%`;
  const seg = (width: number, bg: string) => (
    <Box component="span" sx={{ position: "absolute", inset: "0 auto 0 0", width: at(width), borderRadius: 999, bgcolor: bg }} />
  );
  return (
    <Box component="span" aria-hidden sx={{ display: "block", position: "relative", height: 8, borderRadius: 999, bgcolor: "var(--track)", minWidth: 80 }}>
      {seg(after, "var(--accent-solid)")}
      {seg(before, BEFORE)}
      {target !== null && (
        <Box component="span" data-testid="target-tick" style={{ left: at(target) }} sx={{ ...TICK, position: "absolute", top: -4, bottom: -4, ml: "-1px" }} />
      )}
    </Box>
  );
}

/** The bar and "Weight 17.9% to 18.4% · target 19.0%" (no target on plans saved before), or "No weight yet". */
export function LineWeight({ line, scale }: { line: PlanLine; scale: number }) {
  const { weight_before: before, weight_after: after, target_weight: target } = line;
  if (before === null || after === null) return <Typography component="span" sx={{ ...muted, display: "block" }}>No weight yet</Typography>;
  return (
    <>
      <WeightBar before={before} after={after} target={target} scale={scale} />
      <Typography component="span" sx={{ ...muted, display: "block", "& b": { color: "var(--text)", fontWeight: 650 } }}>
        Weight <b>{pct(before)}</b> to <b>{pct(after)}</b>
        {target !== null && ` · target ${pct(target)}`}
      </Typography>
    </>
  );
}

function Row({ line, whole, scale }: { line: PlanLine; whole: boolean; scale: number }) {
  return (
    <Box role="row" sx={rowSx}>
      <Box role="cell" sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 14 }}>{line.ticker}</Typography>
        <Typography sx={{ ...muted, overflowWrap: "anywhere" }}>{line.name}</Typography>
      </Box>
      <Box role="cell" sx={{ ...wide, fontSize: 13, color: "var(--text2)" }}>
        {line.reason_text}
      </Box>
      <Box role="cell" sx={{ ...wide, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <LineWeight line={line} scale={scale} />
      </Box>
      <Box role="cell" sx={{ ...priceCell, ...muted }}>
        {formatAmount(line.price_eur)} EUR
        {line.currency !== "EUR" && (
          <>
            <br />
            {formatRate(line.currency, line.rate)}
          </>
        )}
      </Box>
      <Box role="cell" sx={amountCell}>
        <Typography sx={{ fontWeight: 650, fontSize: 15, whiteSpace: "nowrap" }}>
          Add {formatAmount(line.amount_eur)} EUR
        </Typography>
        <Typography sx={muted}>{shares(line, whole)}</Typography>
      </Box>
    </Box>
  );
}

/** A ticker the plan left out, muted after the funded lines: its reason and 0.00, no weight, not in the total. */
function LeftOutRow({ entry }: { entry: LeftOut }) {
  return (
    <Box role="row" sx={{ ...rowSx, color: "var(--muted)" }}>
      <Box role="cell" sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 14 }}>{entry.ticker}</Typography>
        <Typography sx={{ ...muted, overflowWrap: "anywhere" }}>{entry.name}</Typography>
      </Box>
      <Box role="cell" sx={{ ...wide, fontSize: 13 }}>
        {entry.reason}
      </Box>
      <Box role="cell" sx={{ display: { xs: "none", md: "block" } }} />
      <Box role="cell" sx={priceCell} />
      <Box role="cell" sx={{ ...amountCell, fontSize: 15 }}>
        0.00
      </Box>
    </Box>
  );
}

/** The tickers the plan left out, as a plain list: ticker, name, then the reason. */
export function LeftOutList({ entries, title }: { entries: LeftOut[]; title?: string }) {
  if (entries.length === 0) return null;
  const label = title ?? "Left out of the plan";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {title && (
        <Typography aria-hidden sx={{ fontSize: 13, fontWeight: 650, color: "var(--text2)" }}>
          {title}
        </Typography>
      )}
      <Box component="ul" aria-label={label} sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.75 }}>
        {entries.map((e) => (
          <Box component="li" key={e.ticker} sx={{ ...muted, fontSize: 13 }}>
            <Box component="span" sx={{ fontWeight: 650, color: "var(--text2)" }}>
              {e.ticker}
            </Box>{" "}
            {e.name}
            <Box component="span" sx={{ display: "block" }}>
              {e.reason}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function PlanNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Box component="ul" aria-label="Plan notes" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.75 }}>
      {notes.map((note) => (
        <Box component="li" key={note} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
          <Box component="span" sx={{ color: "var(--warn)", mt: "2px", display: "flex" }}>
            <AlertTriangle size={15} aria-hidden />
          </Box>
          <span>{note}</span>
        </Box>
      ))}
    </Box>
  );
}

function NothingToFund({ plan }: { plan: Plan }) {
  const wholeSharesTooSmall = plan.left_out.some((e) => e.kind === "too_small");
  return (
    <Panel sx={{ p: { xs: "20px 16px", md: "28px" }, display: "flex", flexDirection: "column", gap: 1.5, maxWidth: 620 }}>
      <Typography component="h2" sx={{ fontSize: 18, fontWeight: 650 }}>
        Nothing to fund this month
      </Typography>
      <Typography sx={{ color: "var(--text2)" }}>
        {wholeSharesTooSmall
          ? "This amount is not enough for one whole share of the tickers with a target. Turn off Whole shares only or raise the amount."
          : "Every ticker with a target is left out, so the plan proposes nothing."}{" "}
        Your {formatAmount(plan.amount_eur)} EUR stays with you.
      </Typography>
      <LeftOutList entries={plan.left_out} />
      {/* Plans saved before carry their ticker sentences here, with an empty left_out. */}
      <PlanNotes notes={plan.notes} />
      <Typography sx={muted}>
        A plan comes back when a pending call changes or a price is available again. You can also set a target on
        another ticker.
      </Typography>
    </Panel>
  );
}

/** The ledger: one row per line, a total row, the notes, and `footer` (Save plan or a saved note). */
export function PlanResult({ plan, footer }: { plan: Plan; footer?: ReactNode }) {
  if (plan.lines.length === 0) return <NothingToFund plan={plan} />;
  const total = plan.lines.reduce((sum, l) => sum + l.amount_eur, 0);
  const scale = weightScale(plan);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
      <Panel role="table" aria-label="Plan lines" sx={{ pt: 0.75, overflow: "hidden" }}>
        <Box role="row" sx={{ ...rowSx, display: { xs: "none", md: "grid" }, borderTop: 0, py: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          <span role="columnheader">Ticker</span>
          <span role="columnheader">Why</span>
          <span role="columnheader">Weight, before to after</span>
          <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>
            Price in EUR
          </Box>
          <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>
            Amount
          </Box>
        </Box>
        {plan.lines.map((line) => (
          <Row key={line.ticker} line={line} whole={plan.whole_shares} scale={scale} />
        ))}
        {plan.left_out.map((entry) => (
          <LeftOutRow key={entry.ticker} entry={entry} />
        ))}
        <Box role="row" sx={{ ...rowSx, fontWeight: 650, bgcolor: "var(--tab-bg)" }}>
          <Box role="cell">Total</Box>
          <Box role="cell" sx={{ ...wide, ...muted, gridRow: { xs: 2, md: "auto" } }}>
            Leftover {formatAmount(plan.leftover_eur)} EUR
          </Box>
          <Box role="cell" sx={{ display: { xs: "none", md: "block" } }} />
          <Box role="cell" sx={priceCell} />
          <Box role="cell" sx={{ ...amountCell, whiteSpace: "nowrap" }}>
            {formatAmount(total)} EUR
          </Box>
        </Box>
      </Panel>
      <PlanNotes notes={plan.notes} />
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1.75, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
          {[
            ["weight before", BEFORE],
            ["after this plan", "var(--accent-solid)"],
          ].map(([label, bg]) => (
            <Box component="span" key={label} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              <Box component="i" sx={{ width: 14, height: 8, borderRadius: 999, bgcolor: bg }} />
              {label}
            </Box>
          ))}
          {plan.lines.some((l) => l.target_weight !== null) && (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              <Box component="i" aria-hidden sx={{ ...TICK, height: 12 }} />
              target (within this plan)
            </Box>
          )}
        </Box>
        {footer}
      </Box>
    </Box>
  );
}
