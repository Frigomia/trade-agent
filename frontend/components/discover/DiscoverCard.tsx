import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Check, CircleDashed, Eye, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Change } from "@/components/ui/Change";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { DiscoverItem } from "@/lib/api/discover-types";
import { addedText, isAnalyzed, metaText, nameOf, priceText, targetsText } from "@/lib/discoverList";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;

/** Status as shape plus word, never colour alone: a check for researched, a dashed circle for not. */
export function StatusPill({ analyzed }: { analyzed: boolean }) {
  const Icon = analyzed ? Check : CircleDashed;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.25,
        minHeight: 26,
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: analyzed ? "var(--accent)" : "var(--text2)",
        bgcolor: analyzed ? "var(--accent-wash)" : "transparent",
        border: analyzed ? "1px solid transparent" : "1px dashed var(--line2)",
      }}
    >
      <Icon size={13} aria-hidden />
      {analyzed ? "AI analyzed" : "Not analyzed"}
    </Box>
  );
}

function PriceBlock({ item }: { item: DiscoverItem }) {
  const price = priceText(item);
  if (price === null) {
    return (
      <Box sx={{ display: "grid", gap: 0.25, gridColumn: { xs: "1 / -1", md: "auto" }, textAlign: { md: "right" } }}>
        <Typography component="b" sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text2)" }}>
          Price unavailable
        </Typography>
        <Typography component="small" sx={muted}>
          We could not get a quote. Try again later.
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        display: "grid",
        // A phone reads it as one line: price, change, and the quote date at the right.
        gridColumn: { xs: "1 / -1", md: "auto" },
        gridTemplateColumns: { xs: "auto auto minmax(0, 1fr)", md: "minmax(0, 1fr)" },
        alignItems: "baseline",
        columnGap: 1.25,
        rowGap: 0.25,
        textAlign: { md: "right" },
        fontSize: "0.8125rem",
      }}
    >
      <Typography component="b" sx={{ fontWeight: 650, fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums" }}>
        {price}
      </Typography>
      {item.change_pct !== null && (
        <Box sx={{ display: "flex", justifyContent: { md: "flex-end" } }}>
          <Change pct={item.change_pct} />
        </Box>
      )}
      <Typography component="small" sx={{ ...muted, justifySelf: { xs: "end", md: "auto" }, gridColumn: { xs: 3, md: "auto" }, textAlign: "right", color: item.stale ? "var(--warn)" : "var(--muted)" }}>
        {item.price_as_of ? `${item.stale ? "Stale quote · " : "As of "}${item.price_as_of}` : item.stale ? "Quote date unavailable" : ""}
      </Typography>
    </Box>
  );
}

/**
 * One company in the Discover list: who it is, whether a scan researched it (with the one-line
 * reading when it did, shown as text), its price and daily change, and what can be done: open the
 * report when there is one, edit its target and price range, or remove it from the list (which only
 * leaves the list).
 */
export function DiscoverCard({ item, now, onRemove, onEdit }: { item: DiscoverItem; now: number; onRemove: () => void; onEdit: () => void }) {
  const name = nameOf(item);
  const targets = targetsText(item);
  const analyzed = isAnalyzed(item);
  // The first action takes the width on a phone: View for a researched company, Edit target for the rest.
  const wideEdit = !analyzed;
  const report = `/today/${item.report_id}`;
  return (
    <Panel
      component="li"
      sx={{
        listStyle: "none",
        p: { xs: "16px", md: "16px 20px" },
        display: "grid",
        // A phone stacks three rows: who it is, the price on one line, the actions. From md they sit side by side.
        gridTemplateColumns: { xs: "auto minmax(0, 1fr)", md: "auto minmax(0, 1fr) 150px auto" },
        columnGap: { xs: "14px", md: 2 },
        rowGap: { xs: 1.5, md: 0 },
        alignItems: { xs: "start", md: "center" },
      }}
    >
      <Box sx={{ alignSelf: "start" }}>
        <Logo name={name} size={48} />
      </Box>
      <Box sx={{ minWidth: 0, display: "grid", gap: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          {analyzed ? (
            <Box component={Link} href={report} aria-label={`Open the investment report for ${name}`} sx={{ fontWeight: 650, fontSize: "1rem", color: "var(--text)", textDecoration: "none", overflowWrap: "anywhere", "&:hover": { textDecoration: "underline" } }}>
              {name}
            </Box>
          ) : (
            <Typography component="span" sx={{ fontWeight: 650, fontSize: "1rem", overflowWrap: "anywhere" }}>
              {name}
            </Typography>
          )}
          <StatusPill analyzed={analyzed} />
        </Box>
        <Typography sx={muted}>{[metaText(item), addedText(item, now)].filter(Boolean).join(" · ")}</Typography>
        {analyzed && item.insight && (
          <Box component="p" sx={{ m: 0, display: "flex", gap: 0.75, alignItems: "flex-start", fontSize: "0.8125rem", color: "var(--text2)" }}>
            <Sparkles size={13} aria-hidden style={{ flex: "none", marginTop: 3 }} />
            <span>{item.insight}</span>
          </Box>
        )}
        {targets && <Typography sx={{ ...muted, color: "var(--text2)" }}>{targets}</Typography>}
      </Box>
      <PriceBlock item={item} />
      {/* The first action takes the width on a phone: View for a researched company, Edit target for the
          rest (the person's own numbers). The square buttons beside it are 44px touch targets. */}
      <Box sx={{ display: "flex", gap: 1, gridColumn: { xs: "1 / -1", md: "auto" }, justifyContent: { md: "flex-end" } }}>
        {analyzed && (
          <Button component={Link} href={report} variant="outlined" size="small" startIcon={<Eye size={15} aria-hidden />} aria-label={`View the report for ${name}`} sx={{ flex: { xs: 1, md: "none" }, minHeight: { xs: 44, md: 36 } }}>
            View
          </Button>
        )}
        <Button
          variant="outlined"
          size="small"
          onClick={onEdit}
          aria-label={`Edit target for ${name}`}
          title="Edit target and price range"
          sx={{ flex: { xs: wideEdit ? 1 : "none", md: "none" }, minHeight: { xs: 44, md: 36 }, minWidth: 44, px: wideEdit ? { xs: 2, md: 0 } : 0, gap: 1, color: "var(--text2)" }}
        >
          <Pencil size={16} aria-hidden />
          {wideEdit && <Box component="span" sx={{ display: { xs: "inline", md: "none" }, fontSize: "0.875rem", fontWeight: 600 }}>Edit target</Box>}
        </Button>
        <Button variant="outlined" size="small" onClick={onRemove} aria-label={`Remove ${name} from Discover`} title="Remove from Discover" sx={{ minHeight: { xs: 44, md: 36 }, minWidth: 44, px: 0, color: "var(--text2)" }}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </Box>
    </Panel>
  );
}
