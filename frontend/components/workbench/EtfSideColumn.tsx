import { Box, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { etfFacts } from "@/lib/discovery";
import { filterRows, filterSummary, fundTags, type FilterState } from "@/lib/etfIdea";

const NOT_SAVED = "Not saved with this idea";

const heading = {
  display: "flex",
  alignItems: "baseline",
  gap: "8px",
  fontSize: "1.0625rem",
  fontWeight: 650,
  letterSpacing: "-0.01em",
} as const;

/** The state of a filter row: a filled circle with a tick, or a dashed empty circle, each with its word. */
function State({ state }: { state: FilterState }) {
  const pass = state === "pass";
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", fontWeight: 650, whiteSpace: "nowrap", color: pass ? "var(--text)" : "var(--text2)" }}
    >
      <Box
        component="i"
        aria-hidden
        sx={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          flex: "none",
          ...(pass ? { bgcolor: "var(--text2)", color: "var(--panel)" } : { border: "1.5px dashed var(--text2)" }),
        }}
      >
        {pass && <Check size={10} strokeWidth={3} />}
      </Box>
      {pass ? "Pass" : "Unknown"}
    </Box>
  );
}

/** The fund facts and the quality filter, as the two panels beside the decision on an ETF idea. */
export function EtfSideColumn({ idea }: { idea: IdeaOut }) {
  const [cost, size, category] = etfFacts(idea);
  const structure = fundTags(idea).filter((tag) => tag !== "ETF").join(" · ");
  const listing = [idea.snapshot?.exchange, idea.snapshot?.currency].filter(Boolean).join(" · ");
  // The saved snapshot has no ISIN, so there is no ISIN row until the scan stores one.
  const facts: [string, string | null][] = [
    ["Expense ratio", cost.value ? `${cost.value} a year` : null],
    ["Fund size", size.value],
    ["Category", category.value],
    ["Structure", structure || null],
    ["Listing", listing || null],
  ];
  const rows = filterRows(idea);

  return (
    <>
      <Panel component="section" aria-labelledby="etf-facts" sx={{ p: { xs: "16px", md: "18px 20px" } }}>
        <Typography component="h2" id="etf-facts" sx={heading}>
          Fund facts
        </Typography>
        <Box component="dl" sx={{ m: "10px 0 0", display: "grid" }}>
          {facts.map(([label, value]) => (
            <Box key={label} sx={{ display: "flex", justifyContent: "space-between", gap: "12px", py: "8px", fontSize: "0.875rem", "&:not(:first-of-type)": { borderTop: "1px solid var(--line)" } }}>
              <Box component="dt" sx={{ color: "var(--text2)" }}>
                {label}
              </Box>
              <Box component="dd" sx={{ m: 0, textAlign: "right", overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums", ...(value ? { fontWeight: 650 } : { fontWeight: 400, color: "var(--muted)" }) }}>
                {value ?? NOT_SAVED}
              </Box>
            </Box>
          ))}
        </Box>
      </Panel>

      <Panel component="section" aria-labelledby="etf-filter" sx={{ p: { xs: "16px", md: "18px 20px" } }}>
        <Typography component="h2" id="etf-filter" sx={heading}>
          Quality filter
          <Typography component="small" sx={{ ml: "auto", fontSize: "0.75rem", fontWeight: 400, color: "var(--muted)" }}>
            {filterSummary(rows)}
          </Typography>
        </Typography>
        <Box component="ul" sx={{ listStyle: "none", m: "10px 0 0", p: 0, display: "grid" }}>
          {rows.map((row) => (
            <Box
              component="li"
              key={row.key}
              sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "2px 10px", py: "9px", "&:not(:first-of-type)": { borderTop: "1px solid var(--line)" } }}
            >
              <Typography component="b" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text)" }}>
                {row.label}
              </Typography>
              <Typography component="small" sx={{ gridColumn: 1, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.4 }}>
                {row.detail}
              </Typography>
              <Box sx={{ gridRow: "1 / 3", gridColumn: 2, alignSelf: "center" }}>
                <State state={row.state} />
              </Box>
            </Box>
          ))}
        </Box>
      </Panel>
    </>
  );
}
