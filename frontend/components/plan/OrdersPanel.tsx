"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { Check, ChevronDown, ChevronUp, Circle, CircleCheck, Copy } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { formatAmount } from "@/lib/format";
import { copyAllText, placedFill, ticketText, unplacedLines } from "@/lib/orders";
import { planDay as placedDay, type Plan, type PlanLine } from "@/lib/plans";
import { IsinRow } from "./IsinRow";
import { PlacedProgress } from "./PlacedProgress";
import { LeftOutList, LineWeight, PlanNotes, PlanResult, muted, shares, weightScale } from "./PlanResult";

const COPY_FAILED = "Could not copy. Select the ticket text and copy it by hand.";
const COPY_ALL_FAILED = "Could not copy. Open each line and copy its ticket by hand.";
// Company | amount | status mark | chevron. A closed line is short: the why and the weight open with it.
const COLUMNS = "minmax(0, 1fr) auto 20px 20px";
const gridSx = { display: "grid", gridTemplateColumns: COLUMNS, gap: { xs: "6px 10px", md: 2 }, alignItems: "center", px: { xs: 2, md: 2.5 } } as const;
const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
const bigButton = { minHeight: 48, flex: 1 } as const;

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface OrdersPanelProps {
  /** A saved plan (`id !== null`) with at least one line; a plan with none renders PlanResult's empty state. */
  plan: Plan;
  /** Reloads the plan (after an ISIN is saved); the parent replaces `plan` with the fresh one. */
  onChanged: () => Promise<unknown>;
  /** The Placed button; shown only when given and the line has an `id`. */
  onPlace?: (line: PlanLine) => void;
  /**
   * Which line is open, by ticker (null: none). Leave both undefined and the panel keeps it itself;
   * pass them to control it, e.g. to open the next unplaced line after Placed.
   */
  openTicker?: string | null;
  onOpenTickerChange?: (ticker: string | null) => void;
  /** Under the lines, beside nothing else: the "Saved ..." note on This month. */
  footer?: ReactNode;
  /**
   * A polite status line above the panel ("EIMI.L recorded as placed. Next: ..."). Pass it (an empty
   * string when there is nothing to say yet) to keep the live region mounted, so a change is announced.
   */
  status?: string;
  /** The card whose button takes the focus (by ticker), e.g. the one that just opened after Placed. */
  focusTicker?: string | null;
  /**
   * The Orders tab's plan heading. Given, it replaces the placed count in the panel's header, and the
   * total, the plan notes and the hint row are left out (the tab has one hint for every plan); the
   * left-out tickers are named in one line at the foot of the panel.
   */
  heading?: ReactNode;
  /** Under the header, above the lines: the Orders tab's old-plan note. */
  notice?: ReactNode;
}

/**
 * The orders of a saved plan, as one Soft panel: a header with the placed count (or the Orders tab's
 * heading) and Copy all lines, then one row per line in the saved order. A closed row is the company,
 * the amount and a status mark; the whole row is a button that opens it to show why, the weight, Copy,
 * Placed, the ticket text and the ISIN. A placed line has no buttons but still opens to show its
 * ticket. Previews never come here.
 */
export function OrdersPanel({ plan, onChanged, onPlace, openTicker, onOpenTickerChange, footer, status, focusTicker, heading, notice }: OrdersPanelProps) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null); // a ticker, or "*" for Copy all lines
  const [failed, setFailed] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const baseId = useId();

  // A copy's "Copied" timer must not fire after the panel is gone.
  useEffect(() => () => clearTimeout(timer.current), []);

  if (plan.lines.length === 0) return <PlanResult plan={plan} footer={footer} />;

  const open = openTicker !== undefined ? openTicker : ownOpen;
  const setOpen = (ticker: string | null) => {
    setOwnOpen(ticker);
    onOpenTickerChange?.(ticker);
  };

  async function copy(key: string, text: string) {
    clearTimeout(timer.current);
    if (await writeClipboard(text)) {
      setFailed(null);
      setCopied(key);
      setAnnounce(key === "*" ? "Copied all unplaced lines" : `Copied the ${key} ticket`);
      // Clearing the announcement too lets a second copy of the same ticket be announced again.
      timer.current = setTimeout(() => {
        setCopied(null);
        setAnnounce("");
      }, 2000);
    } else {
      setCopied(null);
      setFailed(key);
    }
  }

  const placedCount = plan.lines.length - unplacedLines(plan).length;
  const allPlaced = placedCount === plan.lines.length;
  const total = plan.lines.reduce((sum, l) => sum + l.amount_eur, 0);
  const scale = weightScale(plan);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
      {status !== undefined && (
        <Box
          role="status"
          aria-live="polite"
          sx={status ? { display: "flex", alignItems: "flex-start", gap: 1, fontSize: "0.8125rem", color: "var(--text2)" } : hidden}
        >
          {status && (
            <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--accent)", pt: "2px" }}>
              <Check size={16} />
            </Box>
          )}
          {status}
        </Box>
      )}

      <Panel sx={{ overflow: "hidden" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" }, gap: 1.5, flexWrap: "wrap", px: { xs: 2, md: 2.5 }, py: 1.75 }}>
          {heading ?? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
              {allPlaced ? (
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, fontWeight: 650, color: "var(--accent)" }}>
                  <CircleCheck size={18} aria-hidden />
                  All lines placed
                </Box>
              ) : (
                <Box component="span" sx={{ fontWeight: 650, fontSize: "0.9375rem" }}>
                  Orders
                </Box>
              )}
              <Box component="span" sx={{ ...muted, fontVariantNumeric: "tabular-nums" }}>
                {placedCount} of {plan.lines.length} placed
              </Box>
              <PlacedProgress placed={plan.lines.map((l) => l.placed_at !== null)} />
            </Box>
          )}
          <Button
            variant="outlined"
            size="small"
            disabled={allPlaced}
            startIcon={copied === "*" ? <Check size={14} /> : <Copy size={14} />}
            onClick={() => void copy("*", copyAllText(plan))}
            sx={{ minHeight: 44, width: { xs: "100%", sm: "auto" }, flex: "none" }}
          >
            {copied === "*" ? "Copied" : "Copy all lines"}
          </Button>
        </Box>
        {failed === "*" && (
          <Typography role="alert" sx={{ fontSize: "0.8125rem", color: "var(--down)", px: { xs: 2, md: 2.5 }, pb: 1.5 }}>
            {COPY_ALL_FAILED}
          </Typography>
        )}
        {notice && <Box sx={{ px: { xs: 2, md: 2.5 }, pb: 1.75 }}>{notice}</Box>}

        <Box component="ul" aria-label="Orders" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {plan.lines.map((line, i) => (
            <OrderCard
              key={line.ticker}
              line={line}
              plan={plan}
              scale={scale}
              panelId={`${baseId}-${i}`}
              open={open === line.ticker}
              onToggle={() => setOpen(open === line.ticker ? null : line.ticker)}
              copied={copied === line.ticker}
              copyFailed={failed === line.ticker}
              onCopy={() => void copy(line.ticker, ticketText(line, plan.whole_shares))}
              onPlace={onPlace}
              onChanged={onChanged}
              focus={focusTicker === line.ticker}
            />
          ))}
        </Box>
        {!heading && (
          <Box sx={{ ...gridSx, gridTemplateColumns: "minmax(0, 1fr) auto", py: 1.5, borderTop: "1px solid var(--line)", fontWeight: 650, bgcolor: "var(--track)" }}>
            <Box sx={{ gridRow: 1, fontSize: "0.8125rem" }}>Total</Box>
            <Box sx={{ gridRow: 1, gridColumn: 2, textAlign: "right", whiteSpace: "nowrap", fontSize: "0.9375rem" }}>{formatAmount(total)} EUR</Box>
            <Box sx={{ ...muted, fontWeight: 400, gridColumn: "1 / -1", gridRow: 2 }}>Leftover {formatAmount(plan.leftover_eur)} EUR</Box>
          </Box>
        )}
        {heading && plan.left_out.length > 0 && (
          <Box sx={{ px: { xs: 2, md: 2.5 }, py: 1.5, borderTop: "1px solid var(--line)", ...muted }}>
            Left out of this plan: {plan.left_out.map((e) => e.ticker).join(", ")}.
          </Box>
        )}
      </Panel>
      {!heading && (
        <>
          <LeftOutList entries={plan.left_out} title="Left out of this plan" />
          <PlanNotes notes={plan.notes} />
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1.75, flexWrap: "wrap" }}>
            <Typography sx={muted}>Tap a line to open its order.</Typography>
            {footer}
          </Box>
        </>
      )}
      <Box role="status" aria-live="polite" sx={hidden}>
        {announce}
      </Box>
    </Box>
  );
}

interface OrderCardProps {
  line: PlanLine;
  plan: Plan;
  scale: number;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => void;
  onPlace?: (line: PlanLine) => void;
  onChanged: () => Promise<unknown>;
  focus: boolean;
}

function OrderCard({ line, plan, scale, panelId, open, onToggle, copied, copyFailed, onCopy, onPlace, onChanged, focus }: OrderCardProps) {
  const placed = line.placed_at !== null;
  const button = useRef<HTMLButtonElement>(null);
  // Focus again when the line flips to placed: the recorded card (nothing left to open) is focused
  // before the reload, and the sheet's focus return can land after that.
  useEffect(() => {
    if (focus) button.current?.focus();
  }, [focus, placed]);
  const status = line.placed_at !== null ? `placed ${placedDay(line.placed_at)}` : "not placed";
  const name = `${line.ticker}, ${formatAmount(line.amount_eur)} EUR, ${status}, press to ${open ? "close" : "open"}`;
  const fill = placedFill(line);
  const quiet = placed ? "var(--text2)" : "var(--text)";
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <Box component="li" sx={{ borderTop: "1px solid var(--line)", bgcolor: open ? "var(--track)" : undefined }}>
      <Box
        component="button"
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={name}
        onClick={onToggle}
        sx={{
          ...gridSx,
          width: "100%",
          minHeight: 64,
          py: 1.25,
          border: 0,
          bgcolor: "transparent",
          color: quiet,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          "&:hover": { bgcolor: open ? undefined : "var(--track)" },
          "&:focus-visible": { outline: "2px solid var(--accent-solid)", outlineOffset: -2 },
        }}
      >
        <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
          <Logo ticker={line.ticker} name={line.name} size={36} />
          <Box component="span" sx={{ minWidth: 0 }}>
            <Box component="span" sx={{ display: "block", fontWeight: 650, fontSize: "0.8125rem" }}>
              {line.ticker}
            </Box>
            {line.placed_at !== null ? (
              <Box component="span" sx={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "var(--accent)" }}>
                Placed {placedDay(line.placed_at)}
                {fill && ` · ${fill}`}
              </Box>
            ) : (
              <Box component="span" sx={{ ...muted, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {line.name}
              </Box>
            )}
          </Box>
        </Box>
        <Box component="span" sx={{ textAlign: "right" }}>
          <Box component="span" sx={{ display: "block", fontWeight: placed ? 400 : 650, fontSize: placed ? "0.8125rem" : "0.9375rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {formatAmount(line.amount_eur)} EUR
          </Box>
          <Box component="span" sx={{ ...muted, display: "block" }}>
            {shares(line, plan.whole_shares)}
          </Box>
        </Box>
        <Box component="span" aria-hidden sx={{ display: "flex", color: placed ? "var(--accent)" : "var(--muted)" }}>
          {placed ? <CircleCheck size={18} data-testid="mark-placed" /> : <Circle size={18} data-testid="mark-open" />}
        </Box>
        <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--muted)" }}>
          <Chevron size={18} />
        </Box>
      </Box>

      {open && (
        <Box id={panelId} sx={{ px: { xs: 2, md: 2.5 }, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {!placed && (
            <Box sx={{ fontSize: "0.8125rem", color: "var(--text2)", display: "flex", flexDirection: "column", gap: 0.75, maxWidth: 480 }}>
              <span>{line.reason_text}</span>
              <LineWeight line={line} scale={scale} />
            </Box>
          )}
          {!placed && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button variant="outlined" onClick={onCopy} startIcon={copied ? <Check size={16} /> : <Copy size={16} />} sx={bigButton}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                {onPlace && line.id !== null && (
                  <Button variant="contained" onClick={() => onPlace(line)} startIcon={<Circle size={16} />} sx={bigButton}>
                    Placed
                  </Button>
                )}
              </Box>
              {copyFailed && (
                <Typography role="alert" sx={{ fontSize: "0.8125rem", color: "var(--down)" }}>
                  {COPY_FAILED}
                </Typography>
              )}
            </Box>
          )}
          <Box sx={{ p: 1.75, borderRadius: "14px", border: "1px solid var(--line)", bgcolor: "var(--panel)" }}>
            <Typography sx={{ ...muted, mb: 0.75 }}>Ticket, the text Copy copies</Typography>
            <Typography sx={{ fontSize: "0.9375rem", lineHeight: 1.6, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
              {ticketText(line, plan.whole_shares)}
            </Typography>
          </Box>
          <IsinRow line={line} onChanged={onChanged} />
        </Box>
      )}
    </Box>
  );
}
