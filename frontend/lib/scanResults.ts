import type {
  ExclusionReason,
  Level,
  MentionOrigin,
  MentionRejection,
  RejectedMention,
  ScanRun,
} from "@/lib/api/discovery-types";

/** The words for each stored reason (docs/design/scan-results/SPEC.md). */
export const EXCLUSION_WORDS: Record<ExclusionReason, string> = {
  thesis_invalidated: "Thesis no longer holds",
  unreliable_price: "Price not reliable",
  ambiguous_identity: "Company not clearly identified",
  currency_unsupported: "Currency not supported",
  insufficient_data: "Not enough data",
};

export const REJECTION_WORDS: Record<MentionRejection, string> = {
  ambiguous: "Name matches several companies",
  unresolved: "No listed company found",
  no_price: "No price available",
  currency_unsupported: "Currency not supported",
  insufficient_data: "Not enough data",
  cap_reached: "Over this scan's limit",
  duplicate: "Already in the scan or your holdings",
};

export const ORIGIN_WORDS: Record<MentionOrigin, string> = {
  tavily: "Web search",
  reddit: "Reddit",
  industry_research: "Industry research",
};

export type LedgerGroup = "set" | "not" | "men";
export type LedgerFilter = "all" | LedgerGroup;

/** What a row shows when it is opened. Every text and url in it is untrusted. */
export type LedgerDetail =
  | { kind: "thesis"; explanation: string; evidence: string[] }
  | { kind: "bar"; overall: number | null; confidence: Level }
  | { kind: "note"; text: string }
  | { kind: "mention"; sentence: string; origin: MentionOrigin; url: string | null };

export interface LedgerRow {
  key: string;
  group: LedgerGroup;
  name: string;
  ticker: string;
  /** "Where it fell out". */
  stage: string;
  /** The reason chip's words; `thesis` makes the chip amber with an icon. */
  reason: string;
  thesis: boolean;
  detail: LedgerDetail;
}

/** The words for a stored reason; an unknown one (a newer backend) shows as stored, never blank. */
const word = <K extends string>(words: Record<K, string>, key: K): string => words[key] ?? key;

/** Upper-cases the first letter and ends with a full stop unless the text already ends in one. */
export function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function mentionRow(item: RejectedMention, index: number): LedgerRow {
  const m = item.mention;
  return {
    key: `m:${index}:${m.name}`,
    group: "men",
    name: m.name,
    ticker: m.ticker_hint ?? "",
    stage: `Mention · ${word(ORIGIN_WORDS, m.origin)}`,
    reason: word(REJECTION_WORDS, item.reason),
    thesis: false,
    detail: { kind: "mention", sentence: sentence(m.reason), origin: m.origin, url: m.url },
  };
}

/**
 * Every company the scan left out as one list, in this order: set aside after research (thesis
 * removals, then the researched ideas that missed the bar), not researched, mentions not admitted.
 */
export function ledgerRows(scan: ScanRun): LedgerRow[] {
  const thesis = scan.excluded.filter((e) => e.reason === "thesis_invalidated");
  const before = scan.excluded.filter((e) => e.reason !== "thesis_invalidated");
  const set: LedgerRow[] = [
    ...thesis.map((e, i): LedgerRow => ({
      key: `s:${i}:${e.ticker}`,
      group: "set",
      name: e.name,
      ticker: e.ticker,
      stage: "Set aside after research",
      reason: word(EXCLUSION_WORDS, e.reason),
      thesis: true,
      detail: { kind: "thesis", explanation: e.explanation, evidence: e.evidence },
    })),
    // Scans saved before set_aside_ideas have only the three nearest misses, and only when nothing qualified.
    ...(scan.coverage_summary.set_aside_ideas ?? scan.coverage_summary.nearest_misses ?? []).map((idea, i): LedgerRow => ({
      key: `b:${i}:${idea.ticker}`,
      group: "set",
      name: idea.name || idea.ticker,
      ticker: idea.ticker,
      stage: "Set aside after research",
      reason: "Below the bar",
      thesis: false,
      detail: { kind: "bar", overall: idea.overall, confidence: idea.confidence },
    })),
  ];
  const not = before.map((e, i): LedgerRow => ({
    key: `n:${i}:${e.ticker}`,
    group: "not",
    name: e.name,
    ticker: e.ticker,
    stage: "Not researched",
    reason: word(EXCLUSION_WORDS, e.reason),
    thesis: false,
    detail: { kind: "note", text: sentence(e.explanation) },
  }));
  return [...set, ...not, ...scan.rejected_mentions.map(mentionRow)];
}

export function ledgerCounts(rows: LedgerRow[]): Record<LedgerFilter, number> {
  const count = (g: LedgerGroup) => rows.filter((r) => r.group === g).length;
  return { all: rows.length, set: count("set"), not: count("not"), men: count("men") };
}

/** How many "Not researched" rows show before "Show more": the list can run to hundreds. */
export const NOT_RESEARCHED_SHOWN = 6;

/** The rows for a filter, with the long "Not researched" group cut until it is expanded. */
export function visibleRows(rows: LedgerRow[], filter: LedgerFilter, expanded: boolean): { shown: LedgerRow[]; hidden: number } {
  const chosen = filter === "all" ? rows : rows.filter((r) => r.group === filter);
  if (expanded) return { shown: chosen, hidden: 0 };
  let seen = 0;
  const shown = chosen.filter((r) => r.group !== "not" || ++seen <= NOT_RESEARCHED_SHOWN);
  return { shown, hidden: chosen.length - shown.length };
}

/**
 * Researched companies that count in "set aside" but have no row, because the scan was saved
 * before `set_aside_ideas` was kept. `listed` is the number of set-aside rows. Never negative.
 */
export function unlistedSetAside(scan: ScanRun, listed: number): number {
  if (typeof scan.set_aside !== "number") return 0;
  return Math.max(0, scan.set_aside - listed);
}

/**
 * What an empty ledger says. A zero is stated only when the scan recorded one: a scan saved before
 * the below-the-bar records, or without counts, has no list, which is not the same as nothing set aside.
 * `listed` is the number of set-aside rows the ledger has.
 */
export function emptyText(filter: LedgerFilter, scan: ScanRun, listed: number): string {
  if (filter === "not") return "Nothing failed a safeguard.";
  if (filter === "men") return "No mentions were rejected.";
  if (typeof scan.set_aside !== "number") return filter === "set" ? "This scan did not record what it set aside." : "Nothing is listed for this scan.";
  if (unlistedSetAside(scan, listed) > 0) return "The companies this scan set aside were not saved, so they cannot be listed.";
  return filter === "set" ? "Nothing was set aside. Every researched company was put forward." : "Nothing was left out by this scan.";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The coverage notes: only what the scan recorded, in plain words. */
export function coverageNotes(scan: ScanRun): string[] {
  const c = scan.coverage_summary;
  const notes: string[] = [];
  const missing = c.missing_snapshot_symbols?.length ?? 0;
  if (missing) notes.push(`${plural(missing, "company", "companies")} had no market data.`);
  const stale = c.stale_symbols?.length ?? 0;
  if (stale) notes.push(`${plural(stale, "price is", "prices are")} out of date.`);
  const uncertain = c.uncertain_price_symbols?.length ?? 0;
  if (uncertain) notes.push(`${plural(uncertain, "price", "prices")} could not be confirmed and ${uncertain === 1 ? "is" : "are"} shown as saved.`);
  const failed = c.candidate_failures?.length ?? 0;
  if (failed) notes.push(`${plural(failed, "candidate", "candidates")} could not be evaluated and ${failed === 1 ? "is" : "are"} not in the counts above.`);
  if (c.mentions_available === true) notes.push("Research mentions were available for this scan.");
  if (c.mentions_available === false) notes.push("Research mentions were not available for this scan.");
  return notes;
}
