"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { Check, ChevronDown, ChevronUp, Circle, CircleCheck, Copy } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { formatAmount } from "@/lib/format";
import { copyAllText, placedFill, ticketText, unplacedLines } from "@/lib/orders";
import { planDay as placedDay, type Plan, type PlanLine } from "@/lib/plans";
import { IsinRow } from "./IsinRow";
import { LeftOutList, LineWeight, PlanNotes, PlanResult, muted, shares, weightScale } from "./PlanResult";

const COPY_FAILED = "Could not copy. Select the ticket text and copy it by hand.";
const COPY_ALL_FAILED = "Could not copy. Open each line and copy its ticket by hand.";
// Ticker | why | weight | amount | mark | chevron. A phone stacks it as the approved ledger row does.
const COLUMNS = { xs: "minmax(0, 1fr) auto 24px", md: "170px minmax(0, 1fr) 220px 150px 24px 20px" };
const gridSx = { display: "grid", gridTemplateColumns: COLUMNS, gap: { xs: "6px 12px", md: 2 }, alignItems: "center", px: { xs: 2, md: 2.5 } } as const;
const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
const bigButton = { minHeight: 48, flex: 1 } as const;
// The Orders tab's plan heading sticks to the top of the page (which scrolls) while the plan's lines
// pass under it, edge to edge across the main padding.
const stickySx = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  display: "flex",
  justifyContent: "space-between",
  alignItems: { xs: "flex-start", sm: "center" },
  gap: { xs: 1.25, sm: 2 },
  mx: { xs: -2, md: -3 },
  px: { xs: 2, md: 3 },
  py: 1.25,
  bgcolor: "var(--bg)",
} as const;

/** About the sticky heading's height: a focused card scrolls clear of it instead of under it. */
const STICKY_HEADING_HEIGHT = 72;

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
   * A polite status line under the header ("EIMI.L recorded as placed. Next: ..."). Pass it (an empty
   * string when there is nothing to say yet) to keep the live region mounted, so a change is announced.
   */
  status?: string;
  /** The card whose button takes the focus (by ticker), e.g. the one that just opened after Placed. */
  focusTicker?: string | null;
  /**
   * The Orders tab's plan heading. Given, it replaces the placed count, sticks to the top while the
   * plan's lines scroll, and the total, the left-out list, the plan notes and the hint row are left
   * out (the tab has one hint for every plan).
   */
  heading?: ReactNode;
  /** Under the heading and the status line, above the cards: the Orders tab's old-plan note. */
  notice?: ReactNode;
}

/**
 * The orders of a saved plan (direction D): a header with the placed count and Copy all lines, then
 * one card per line in the saved order. A closed card is the ledger row with a status mark; the whole
 * card is a button that opens it to show Copy, Placed, the ticket text and the ISIN. A placed line has
 * no buttons but still opens to show its ticket. Previews never come here.
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
      <Box sx={heading ? stickySx : { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        {heading ?? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
          {allPlaced ? (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, fontWeight: 650, color: "var(--up)" }}>
              <CircleCheck size={18} aria-hidden />
              All lines placed
            </Box>
          ) : (
            <Box component="span" sx={{ fontWeight: 650 }}>
              Orders
            </Box>
          )}
          <Box component="span" sx={{ ...muted, fontVariantNumeric: "tabular-nums" }}>
            {placedCount} of {plan.lines.length} placed
          </Box>
          <Box component="span" aria-hidden data-testid="progress" sx={{ display: "inline-flex", gap: 0.5 }}>
            {plan.lines.map((l) => (
              <Box
                component="i"
                key={l.ticker}
                data-placed={l.placed_at !== null}
                sx={{ width: 18, height: 5, borderRadius: 999, bgcolor: l.placed_at !== null ? "var(--accent-solid)" : "var(--track)" }}
              />
            ))}
          </Box>
        </Box>
        )}
        <Button
          variant="outlined"
          size="small"
          disabled={allPlaced}
          startIcon={copied === "*" ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => void copy("*", copyAllText(plan))}
          sx={heading ? { minHeight: 44, flex: "none" } : { minHeight: 44, width: { xs: "100%", sm: "auto" } }}
        >
          {copied === "*" ? "Copied" : "Copy all lines"}
        </Button>
      </Box>
      {failed === "*" && (
        <Typography role="alert" sx={{ fontSize: 13, color: "var(--down)" }}>
          {COPY_ALL_FAILED}
        </Typography>
      )}
      {status !== undefined && (
        <Box
          role="status"
          aria-live="polite"
          sx={status ? { display: "flex", alignItems: "flex-start", gap: 1, fontSize: 14, color: "var(--text2)" } : hidden}
        >
          {status && (
            <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--up)", pt: "2px" }}>
              <Check size={16} />
            </Box>
          )}
          {status}
        </Box>
      )}
      {notice}

      <Panel sx={{ pt: { md: 0.75 }, overflow: "hidden" }}>
        <Box aria-hidden sx={{ ...gridSx, display: { xs: "none", md: "grid" }, py: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          <span>Ticker</span>
          <span>Why</span>
          <span>Weight, before to after</span>
          <Box component="span" sx={{ textAlign: "right" }}>
            Amount, EUR
          </Box>
        </Box>
        <Box
          component="ul"
          aria-label="Orders"
          sx={{
            m: 0,
            p: 0,
            listStyle: "none",
            ...(heading && { "& li, & li *": { scrollMarginTop: `${STICKY_HEADING_HEIGHT}px` } }),
          }}
        >
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
        <Box sx={{ ...gridSx, py: 1.5, borderTop: "1px solid var(--line)", fontWeight: 650, bgcolor: "var(--tab-bg)" }}>
          <Box sx={{ gridRow: 1 }}>Total</Box>
          <Box sx={{ ...muted, gridColumn: { xs: "1 / -1", md: "2 / 4" }, gridRow: { xs: 2, md: 1 } }}>Leftover {formatAmount(plan.leftover_eur)} EUR</Box>
          <Box sx={{ gridRow: 1, gridColumn: { xs: "2 / -1", md: 4 }, textAlign: "right", whiteSpace: "nowrap" }}>{formatAmount(total)} EUR</Box>
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
    <Box component="li" sx={{ borderTop: "1px solid var(--line)", bgcolor: open ? "var(--up-bg)" : undefined }}>
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
          py: 1.75,
          border: 0,
          bgcolor: "transparent",
          color: quiet,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          "&:hover": { bgcolor: open ? undefined : "var(--up-bg)" },
          "&:focus-visible": { outline: "2px solid var(--accent-solid)", outlineOffset: -2 },
        }}
      >
        <Box component="span" sx={{ gridColumn: 1, gridRow: 1, minWidth: 0 }}>
          <Box component="span" sx={{ display: "block", fontWeight: 650, fontSize: 14 }}>
            {line.ticker}
          </Box>
          <Box component="span" sx={{ ...muted, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {line.name}
          </Box>
        </Box>
        <Box component="span" sx={{ gridColumn: { xs: "1 / -1", md: 2 }, gridRow: { xs: 2, md: 1 }, fontSize: 13, color: "var(--text2)" }}>
          {line.reason_text}
        </Box>
        <Box component="span" sx={{ gridColumn: { xs: "1 / 3", md: 3 }, gridRow: { xs: 3, md: 1 }, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {line.placed_at !== null ? (
            <Box component="span" sx={muted}>
              Placed {placedDay(line.placed_at)}
              {fill && ` · ${fill}`}
            </Box>
          ) : (
            <LineWeight line={line} scale={scale} />
          )}
        </Box>
        <Box component="span" sx={{ gridColumn: { xs: 2, md: 4 }, gridRow: 1, textAlign: "right" }}>
          <Box component="span" sx={{ display: "block", fontWeight: 650, fontSize: 15, whiteSpace: "nowrap" }}>
            {formatAmount(line.amount_eur)} EUR
          </Box>
          <Box component="span" sx={{ ...muted, display: "block" }}>
            {shares(line, plan.whole_shares)}
          </Box>
        </Box>
        <Box component="span" aria-hidden sx={{ gridColumn: { xs: 3, md: 5 }, gridRow: 1, alignSelf: { xs: "start", md: "center" }, display: "flex", color: placed ? "var(--up)" : "var(--muted)" }}>
          {placed ? <CircleCheck size={22} data-testid="mark-placed" /> : <Circle size={22} data-testid="mark-open" />}
        </Box>
        <Box component="span" aria-hidden sx={{ gridColumn: { xs: 3, md: 6 }, gridRow: { xs: 3, md: 1 }, alignSelf: { xs: "end", md: "center" }, display: "flex", color: "var(--muted)" }}>
          <Chevron size={18} />
        </Box>
      </Box>

      {open && (
        <Box
          id={panelId}
          sx={{
            px: { xs: 2, md: 2.5 },
            pb: 2,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 340px" },
            gap: { xs: 1.5, md: 2.5 },
            alignItems: "start",
          }}
        >
          {!placed && (
            <Box sx={{ gridColumn: { md: 2 }, gridRow: { md: 1 }, display: "flex", flexDirection: "column", gap: 0.75 }}>
              <Box sx={{ display: "flex", gap: 1.25 }}>
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
                <Typography role="alert" sx={{ fontSize: 13, color: "var(--down)" }}>
                  {COPY_FAILED}
                </Typography>
              )}
            </Box>
          )}
          <Box sx={{ gridColumn: { md: 1 }, gridRow: { md: placed ? "auto" : "1 / span 2" }, p: 1.75, borderRadius: "14px", border: "1px solid var(--line)", bgcolor: "var(--tab-bg)" }}>
            <Typography sx={{ ...muted, mb: 0.75 }}>Ticket, the text Copy copies</Typography>
            <Typography sx={{ fontSize: 14.5, lineHeight: 1.6, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
              {ticketText(line, plan.whole_shares)}
            </Typography>
          </Box>
          <Box sx={{ gridColumn: { md: placed ? 1 : 2 } }}>
            <IsinRow line={line} onChanged={onChanged} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
