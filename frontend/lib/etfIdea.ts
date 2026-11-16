import type { CandidateFit, IdeaOut } from "@/lib/api/discovery-types";
import { etfFacts } from "@/lib/discovery";

/** An ETF idea qualifies at a gap score of 50; stocks stay at 60. Mirrors ETF_NO_OPPORTUNITY_MIN_OVERALL in backend/app/analysis/discovery_score.py. */
export const ETF_GATE = 50;

export const isEtf = (idea: IdeaOut): boolean => idea.asset_type === "ETF";

/** "iShares Core MSCI EM IMI UCITS ETF (Acc)" becomes "iShares Core MSCI EM IMI"; falls back to the full name. */
export function shortFundName(name: string): string {
  const short = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+UCITS\s+ETF\b|\s+UCITS\b|\s+ETF\b/g, "")
    .trim();
  return short || name;
}

/** The badges under the fund name, only what the name shows. */
export function fundTags(idea: IdeaOut): string[] {
  const tags = ["ETF"];
  if (/UCITS/i.test(idea.name)) tags.push("UCITS");
  if (/\(Acc\)|Accumulat/i.test(idea.name)) tags.push("Acc");
  else if (/\(Dist\)|Distribut/i.test(idea.name)) tags.push("Dist");
  return tags;
}

/** The line under the fund name on a Today card: "IS3N.DE · ETF · UCITS · Acc". */
export const etfListing = (idea: IdeaOut): string => [idea.ticker, ...fundTags(idea)].join(" · ");

/** How many equal holdings the portfolio behaves like: 1 / HHI. Null when HHI is unusable. */
export function effectivePositions(hhi: number | null | undefined): number | null {
  return typeof hhi === "number" && Number.isFinite(hhi) && hhi > 0 ? 1 / hhi : null;
}

export type Scale = { min: number; max: number };

/** A strip's axis: the values padded by their span (at least half a step), widened to whole steps. */
export function stripScale(values: number[], step: number): Scale {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(hi - lo, step / 2);
  // Rounding the quotient first keeps 0.16 / 0.01 from landing a hair above 16 and ceiling to 17.
  const steps = (n: number) => Number((n / step).toPrecision(12));
  return { min: Math.floor(steps(lo - pad)) * step, max: Math.ceil(steps(hi + pad)) * step };
}

export type GapParts = { volatility: number | null; concentration: number | null; correlation: number | null };

const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const part = (value: number) => Math.round(Math.min(100, Math.max(0, value)));

/** The three parts of the saved gap score, the same formulas as fit_dimension in backend/app/analysis/discovery_score.py. */
export function gapParts(fit: CandidateFit | null | undefined): GapParts {
  const corr = fit?.avg_correlation_to_portfolio;
  const [volBefore, volAfter] = [fit?.portfolio_vol_before, fit?.portfolio_vol_after];
  const [hhiBefore, hhiAfter] = [fit?.hhi_before, fit?.hhi_after];
  return {
    correlation: isNum(corr) ? part((100 * (1 - corr)) / 2) : null,
    volatility: isNum(volBefore) && isNum(volAfter) && volBefore > 0 ? part(50 + 50 * (1 - volAfter / volBefore)) : null,
    concentration: isNum(hhiBefore) && isNum(hhiAfter) && hhiBefore > 0 ? part(50 + 50 * (1 - hhiAfter / hhiBefore)) : null,
  };
}

/** True when the three parts exist and their rounded mean is within 1 of the saved score. */
export function partsAgree(parts: GapParts, saved: number | null): boolean {
  const { volatility, concentration, correlation } = parts;
  if (saved === null || volatility === null || concentration === null || correlation === null) return false;
  return Math.abs(Math.round((volatility + concentration + correlation) / 3) - saved) <= 1;
}

export function correlationWords(c: number): string {
  if (c < -0.1) return "Tends to move against your holdings";
  if (c < 0.3) return "Moves mostly on its own";
  if (c <= 0.7) return "Moves about half in step";
  return "Moves mostly with your holdings";
}

/** What a suggested position means: the backend suggests the saved maximum (15%) from a gap score of 80, else half of it. Null for any other size. */
export function positionNote(pct: number): { fill: number; text: string; label: string } | null {
  const tenths = Math.round(pct * 1000);
  if (tenths === 75) return { fill: 0.5, label: "half of the 15% maximum", text: "Half of the 15% maximum; the full maximum is suggested at a gap score of 80 or more." };
  if (tenths === 150) return { fill: 1, label: "the 15% maximum", text: "The full maximum, suggested at a gap score of 80 or more." };
  return null;
}

export type FilterState = "pass" | "unknown";
export type FilterRow = { key: string; label: string; detail: string; state: FilterState };

/** The quality filter as six rows. A saved idea already passed it, so only a fund size the scan did not save is unknown. */
export function filterRows(idea: IdeaOut): FilterRow[] {
  const [cost, size] = etfFacts(idea);
  return [
    { key: "cost", label: "Cost", detail: `Expense ratio ${cost.value ?? "not saved"} · at most 0.50%`, state: "pass" },
    size.value
      ? { key: "size", label: "Size", detail: `Fund size ${size.value} · at least EUR 100M`, state: "pass" }
      : { key: "size", label: "Size", detail: "Fund size not saved · at least EUR 100M", state: "unknown" },
    { key: "history", label: "History", detail: "At least 200 daily closes", state: "pass" },
    { key: "plain", label: "Plain fund", detail: "Not leveraged, inverse or a trading fund", state: "pass" },
    { key: "near-copy", label: "Cheapest of its kind", detail: "Not a near-copy of a cheaper fund in its category", state: "pass" },
    { key: "overlap", label: "No overlap with your ETFs", detail: "Not a near-copy of an ETF you hold (same category, correlation 0.95 or more)", state: "pass" },
  ];
}

export function filterSummary(rows: FilterRow[]): string {
  const unknown = rows.filter((r) => r.state === "unknown").length;
  return unknown === 0 ? `${rows.length} of ${rows.length} pass` : `${rows.length - unknown} pass · ${unknown} unknown`;
}

/** The one line on a Today card. */
export function cardFilterLine(idea: IdeaOut): string {
  const [cost, size] = etfFacts(idea);
  if (!size.value) return `Quality filter: ${filterRows(idea).length - 1} passed, size unknown`;
  return `Quality filter passed: cost ${cost.value ?? "not saved"}, size ${size.value}, no overlap with your ETFs`;
}
