import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { AlertTriangle } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { formatAmount } from "@/lib/format";
import { formatRate, type Plan, type PlanLine } from "@/lib/plans";

const muted = { fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 } as const;
// Ticker | why | weight | price | amount. A phone keeps two lines per row and drops the price.
const COLUMNS = { xs: "minmax(0, 1fr) auto", md: "150px minmax(0, 1fr) 220px 130px 150px" };
const BEFORE = "color-mix(in oklab, var(--accent-solid) 42%, var(--bg))";

const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

function shares(line: PlanLine, whole: boolean): string {
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

/** Before (lighter) and after (solid) on one track scaled to the largest weight in the plan. */
function WeightBar({ before, after, scale }: { before: number; after: number; scale: number }) {
  const seg = (width: number, bg: string) => (
    <Box sx={{ position: "absolute", inset: "0 auto 0 0", width: `${Math.min(width / scale, 1) * 100}%`, borderRadius: 999, bgcolor: bg }} />
  );
  return (
    <Box aria-hidden sx={{ position: "relative", height: 8, borderRadius: 999, bgcolor: "var(--track)", minWidth: 80 }}>
      {seg(after, "var(--accent-solid)")}
      {seg(before, BEFORE)}
    </Box>
  );
}

function Row({ line, whole, scale }: { line: PlanLine; whole: boolean; scale: number }) {
  const { weight_before: before, weight_after: after } = line;
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
        {before !== null && after !== null ? (
          <>
            <WeightBar before={before} after={after} scale={scale} />
            <Typography sx={{ ...muted, "& b": { color: "var(--text)", fontWeight: 650 } }}>
              Weight <b>{pct(before)}</b> to <b>{pct(after)}</b>
            </Typography>
          </>
        ) : (
          <Typography sx={muted}>No weight yet</Typography>
        )}
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

export function PlanNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Box component="ul" aria-label="Left out of the plan" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 0.75 }}>
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
  const wholeSharesTooSmall = plan.whole_shares && plan.notes.some((n) => n.includes("less than one share"));
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
  const scale = Math.max(0.01, ...plan.lines.flatMap((l) => [l.weight_before ?? 0, l.weight_after ?? 0])) * 1.15;
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
        </Box>
        {footer}
      </Box>
    </Box>
  );
}
