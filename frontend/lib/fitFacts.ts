import type { CandidateFit } from "@/lib/api/discovery-types";
import { formatShare } from "@/lib/format";

export interface FitFact {
  label: string;
  value: string;
  detail: string;
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

const percent = (n: number, extra: boolean) => formatShare(n, extra ? 1 : 0);
const index = (n: number, extra: boolean) => n.toFixed(extra ? 3 : 2);

/** "3% → 7%": two figures, with one more decimal when the plain rounding would make them look equal. */
function beforeAfter(before: number | null, after: number | null, show: (n: number, extra: boolean) => string): string | null {
  if (!finite(before) || !finite(after)) return null;
  const extra = show(before, false) === show(after, false) && before !== after;
  return `${show(before, extra)} → ${show(after, extra)}`;
}

// Rounded first, then made positive-zero, so a tiny negative never reads "-0.00".
const correlation = (n: number) => (Math.round(n * 100) / 100 + 0).toFixed(2);

const fact = (label: string, value: string | null, detail: string): FitFact | null => (value === null ? null : { label, value, detail });

/**
 * The numbers behind the fit score as plain facts, each as a before and after (or one figure), with
 * neutral wording: none is marked good or bad. A figure the scan could not compute is left out.
 */
export function fitFacts(fit: CandidateFit, sector: string | null | undefined): FitFact[] {
  return [
    fact(
      sector ? `${sector} weight` : "Sector weight",
      beforeAfter(fit.sector_weight_before, fit.sector_weight_after, percent),
      "The share of your portfolio in this sector, before and after.",
    ),
    fact(
      "Concentration",
      beforeAfter(fit.hhi_before, fit.hhi_after, index),
      "How concentrated your holdings are: 1 would be everything in one holding, lower is more spread out.",
    ),
    fact(
      "Portfolio volatility",
      beforeAfter(fit.portfolio_vol_before, fit.portfolio_vol_after, percent),
      "Annualised, measured from past prices.",
    ),
    fact(
      "Correlation with your holdings",
      finite(fit.avg_correlation_to_portfolio) ? correlation(fit.avg_correlation_to_portfolio) : null,
      "Averaged over your holdings by their weight: 1 moves together, 0 is unrelated, below 0 moves oppositely.",
    ),
  ].filter((f): f is FitFact => f !== null);
}

/** The sentence that says what the figures assume. */
export function fitAssumption(fit: CandidateFit): string {
  const context = "They are context for your own review, not a recommendation.";
  if (!finite(fit.hypothetical_weight)) return `These figures assume a small position in this company. ${context}`;
  const whole = Number.isInteger(Number((fit.hypothetical_weight * 100).toFixed(1))); // "5%", not "5.0%"
  const weight = formatShare(fit.hypothetical_weight, whole ? 0 : 1);
  return `These figures assume this company at ${weight} of your portfolio. ${context}`;
}
