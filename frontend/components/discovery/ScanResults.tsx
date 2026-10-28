"use client";

import { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { Check, Info } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { ScanRun } from "@/lib/api/discovery-types";
import { coverageNotes, ledgerCounts, ledgerRows, unlistedSetAside, visibleRows, type LedgerFilter } from "@/lib/scanResults";
import { ScanLedger } from "./ScanLedger";

const EMPTY: Record<LedgerFilter, string> = {
  all: "Nothing was left out by this scan.",
  set: "Nothing was set aside. Every researched company was put forward.",
  not: "Nothing failed a safeguard.",
  men: "No mentions were rejected.",
};

function Count({ value, label, accent }: { value: number | null; label: string; accent?: boolean }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.75, whiteSpace: "nowrap" }}>
      <Typography component="b" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: accent ? "var(--accent)" : "var(--text)" }}>
        {value ?? "—"}
      </Typography>
      {label}
    </Box>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Box role="note" sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", p: "12px 14px", borderRadius: "14px", bgcolor: "var(--accent-wash)", color: "var(--text2)", fontSize: "0.75rem", lineHeight: 1.5 }}>
      <Info size={15} aria-hidden style={{ color: "var(--accent)", marginTop: 1, flex: "none" }} />
      <span>{children}</span>
    </Box>
  );
}

/** What the latest scan looked at and everything it left out, each with its reason. */
export function ScanResults({ scan }: { scan: ScanRun }) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => ledgerRows(scan), [scan]);
  const counts = ledgerCounts(rows);
  const { shown, hidden } = visibleRows(rows, filter, expanded);
  const unlisted = unlistedSetAside(scan, counts.set);
  const legacy = scan.opportunities === null;
  const notes = coverageNotes(scan);
  const segments = [
    { key: "all", label: "All", count: counts.all },
    { key: "set", label: "Set aside", count: counts.set },
    { key: "not", label: "Not researched", count: counts.not },
    { key: "men", label: "Mentions", count: counts.men },
  ] as const;

  return (
    <Box sx={{ display: "grid", gap: 2, maxWidth: 900, minWidth: 0 }}>
      <Box aria-label="Counts" sx={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", px: 0.5, color: "var(--text2)", fontSize: "0.8125rem" }}>
        <Count value={scan.universe_size} label="in the universe" />
        <Count value={scan.eligible} label="eligible" />
        <Count value={scan.shortlisted} label="shortlisted" />
        <Count value={scan.researched} label="researched" />
        <Count value={scan.opportunities} label={scan.opportunities === 1 ? "opportunity" : "opportunities"} accent />
        <Count value={scan.set_aside} label="set aside" />
      </Box>
      <Typography sx={{ px: 0.5, color: "var(--muted)", fontSize: "0.75rem", lineHeight: 1.5 }}>
        Companies that failed a safeguard are in the list as Not researched. Holdings and sectors you avoid are left out by choice, and eligible companies ranked below the shortlist were not researched. &quot;Set aside&quot; means researched but not recommended; nothing here is a recommendation to sell or avoid.
      </Typography>
      {legacy && <Note>This scan was saved before its counts were kept, so the totals are missing. The list below is what it saved.</Note>}
      <SegmentedControl
        label="Filter the list"
        segments={segments}
        value={filter}
        onChange={(key) => {
          setFilter(key);
          setExpanded(false);
        }}
        fill
      />
      <ScanLedger key={filter} rows={shown} hidden={hidden} onShowMore={() => setExpanded(true)} empty={EMPTY[filter]} />
      {unlisted > 0 && (filter === "all" || filter === "set") && (
        <Note>
          {unlisted} researched {unlisted === 1 ? "company" : "companies"} below the bar {unlisted === 1 ? "was" : "were"} not kept, so {unlisted === 1 ? "it" : "they"} cannot be listed. The count above still includes {unlisted === 1 ? "it" : "them"}.
        </Note>
      )}
      <Panel component="section" aria-labelledby="scan-coverage" sx={{ p: "16px 20px", display: "grid", gap: 1.25 }}>
        <Typography component="h2" id="scan-coverage" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Coverage notes
        </Typography>
        {notes.length > 0 ? (
          <Box component="ul" sx={{ display: "grid", gap: 1, m: 0, p: 0, listStyle: "none" }}>
            {notes.map((text) => (
              <Box component="li" key={text} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", color: "var(--text2)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                <Info size={15} aria-hidden style={{ color: "var(--muted)", marginTop: 2, flex: "none" }} />
                {text}
              </Box>
            ))}
          </Box>
        ) : (
          <Typography sx={{ display: "flex", gap: 1.25, alignItems: "center", color: "var(--muted)", fontSize: "0.8125rem" }}>
            <Check size={15} aria-hidden />
            Nothing to report.
          </Typography>
        )}
      </Panel>
    </Box>
  );
}
