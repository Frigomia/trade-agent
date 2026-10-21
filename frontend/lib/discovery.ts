import type {
  DiscoveryRecommendation,
  IdeaOut,
  Level,
  RiskLevel,
  ScanRun,
} from "@/lib/api/discovery-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatAmount, toTime } from "@/lib/format";

/** Discovery ideas and holdings recommendations share one table; only the source tells them apart. */
export function isDiscovery(rec: Pick<RecommendationOut, "source">): boolean {
  return rec.source === "discovery";
}

/** The recommendations about holdings: everything the discovery scan did not write. */
export function holdingsOnly<T extends Pick<RecommendationOut, "source">>(recs: T[]): T[] {
  return recs.filter((rec) => !isDiscovery(rec));
}

export const OTHER_OPPORTUNITIES_SHOWN = 3;

/**
 * The feed arrives ranked (overall, risk, fit, ticker), so the first idea with its saved detail is
 * the top opportunity and the next three are the others; `more` is how many are left to view.
 */
export function splitIdeas(recs: DiscoveryRecommendation[]): {
  top: DiscoveryRecommendation | null;
  others: DiscoveryRecommendation[];
  more: number;
} {
  const ideas = recs.filter((rec) => rec.idea !== null);
  return {
    top: ideas[0] ?? null,
    others: ideas.slice(1, 1 + OTHER_OPPORTUNITIES_SHOWN),
    more: Math.max(0, ideas.length - 1 - OTHER_OPPORTUNITIES_SHOWN),
  };
}

/** How many of the three meter segments are filled. Unknown risk fills none and says so in words. */
export function meterFill(level: Level | RiskLevel): number {
  return { low: 1, medium: 2, high: 3, unknown: 0 }[level];
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export const confidenceLabel = (level: Level) => `${cap(level)} confidence`;
export const riskLabel = (level: RiskLevel) => (level === "unknown" ? "Risk unknown" : `${cap(level)} risk`);

/** Two letters for the round logo: first letters of the first two words, or the first two letters. */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // Spreading splits by code point, so a character outside the basic plane is not cut in half.
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join("");
  return letters.toUpperCase();
}

/** "USD 184.20" from the saved snapshot, or null when the scan stored no price. */
export function priceText(idea: IdeaOut): string | null {
  const snap = idea.snapshot;
  if (!snap || snap.price === null) return null;
  return `${snap.currency ?? ""} ${formatAmount(snap.price)}`.trim();
}

/** The listing line: "HLDN · NASDAQ", or the ticker alone when the exchange is unknown. */
export function listingText(idea: IdeaOut): string {
  return [idea.ticker, idea.snapshot?.exchange].filter(Boolean).join(" · ");
}

/** "Software · Infrastructure"; sector alone when there is no industry. */
export function sectorText(idea: IdeaOut): string | null {
  const snap = idea.snapshot;
  if (!snap?.sector) return null;
  return snap.industry ? `${snap.sector} · ${snap.industry}` : snap.sector;
}

/** "today 06:12" for a time on the current day, otherwise "Mon 06:12". */
export function whenText(iso: string, now: number): string {
  const date = new Date(toTime(iso));
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return `today ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** "20 Oct 2026, 06:12": an absolute date and time for a record that should not read as relative. */
export function dateTimeText(iso: string): string {
  const date = new Date(toTime(iso));
  const day = date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  return `${day}, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** The scan bar's count words, from the saved counts only; empty parts when a legacy scan lacks them. */
export function scanCounts(scan: ScanRun): string[] {
  if (scan.opportunities === null) return [];
  const n = scan.opportunities;
  const parts = [`${n} opportunit${n === 1 ? "y" : "ies"}`];
  if (scan.set_aside !== null && scan.set_aside > 0) parts.push(`${scan.set_aside} set aside`);
  return parts;
}

/** Cuts a block of text to `lines` lines with an ellipsis, in CSS, so no sentence is guessed at. */
export const clampLines = (lines: number) =>
  ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }) as const;

/** No scan runs left this month. A limit of zero means no runs at all: the server refuses the first. */
export function runsExhausted(usage: { used: number; limit: number } | undefined): boolean {
  return !!usage && usage.used >= usage.limit;
}

/** The stages the discovery job reports, in order (backend/app/discovery/jobs.py and runner.py). */
export const SCAN_STAGES = [
  { key: "screening", label: "Screening companies" },
  { key: "admitting", label: "Checking companies from research" },
  { key: "researching", label: "Researching candidates" },
  { key: "evaluating", label: "Scoring and ranking" },
  { key: "writing", label: "Saving results" },
] as const;

/** Where a job's stage sits in SCAN_STAGES; an unknown or missing stage counts as the first. */
export function stageIndex(stage: string | undefined): number {
  return Math.max(0, SCAN_STAGES.findIndex((s) => s.key === stage));
}

/** The error the job stores when Anthropic rejected the user's key (jobs.py). */
export const KEY_REJECTED_MESSAGE = "Your Claude key needs attention.";

/**
 * "Mon 19 Oct" when every idea shown has a saved quote from that same day, otherwise null: the
 * feed spans scans, so quotes can differ or be missing, and one shared caption would make the
 * older or undated ones look as fresh as the newest. Each card carries its own date regardless.
 */
export function commonQuoteDay(recs: DiscoveryRecommendation[]): string | null {
  const days = recs.map((rec) => {
    const asOf = rec.idea?.snapshot?.price_as_of;
    const ms = asOf ? toTime(asOf) : Number.NaN;
    return Number.isNaN(ms) ? null : formatDay(ms);
  });
  const first = days[0];
  return first && days.every((day) => day === first) ? first : null;
}

const formatDay = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/**
 * What the saved price is, always dated: "Scan quote · Mon 19 Oct". A scan that stored no quote
 * date says so, and a date the research flagged as uncertain is marked as such. The price is never
 * refreshed on read, so an older pending idea shows its own date.
 */
export function quoteLabel(idea: IdeaOut): string {
  const asOf = idea.snapshot?.price_as_of;
  const ms = asOf ? toTime(asOf) : Number.NaN;
  const known = !Number.isNaN(ms);
  const day = known ? formatDay(ms) : "date unknown";
  const uncertain = idea.data_notes.some((note) => note.toLowerCase().startsWith("price date uncertain"));
  return `Scan quote · ${day}${uncertain && known ? " (date uncertain)" : ""}`;
}

/**
 * True for an idea saved by a scan before the latest one: pending ideas stay on Today across
 * scans (the feed spans them), so the latest scan's own result must not be mistaken for them.
 * Ideas written by one scan share its timestamp (both are set by the database in one transaction).
 */
export function isEarlier(rec: Pick<DiscoveryRecommendation, "created_at">, scan: Pick<ScanRun, "created_at"> | null): boolean {
  return scan !== null && toTime(rec.created_at) < toTime(scan.created_at);
}

/** The portfolio-fit score (0 to 100), or null when fit does not apply (no holdings to compare). */
export function fitScore(idea: IdeaOut): number | null {
  return idea.scores.find((s) => s.name === "fit")?.score ?? null;
}
