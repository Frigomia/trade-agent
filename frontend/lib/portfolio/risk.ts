import type { AnalyticsPosition, PortfolioAnalytics } from "@/lib/api/analytics-types";

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** The valued positions, largest first (ties by ticker), so every list and table reads in one order. */
export function orderedPositions(analytics: PortfolioAnalytics): AnalyticsPosition[] {
  return [...analytics.positions].sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker));
}

export interface CorrelationPair {
  a: string;
  b: string;
  value: number;
}

/** Every pair of holdings once, with a correlation the backend could estimate (not null, finite). */
export function correlationPairs(analytics: PortfolioAnalytics): CorrelationPair[] {
  const tickers = orderedPositions(analytics).map((p) => p.ticker);
  const pairs: CorrelationPair[] = [];
  tickers.forEach((a, i) => {
    for (const b of tickers.slice(i + 1)) {
      const value = analytics.correlation[a]?.[b];
      if (finite(value)) pairs.push({ a, b, value });
    }
  });
  return pairs;
}

export interface RiskFacts {
  volatility: number | null;
  largest: { ticker: string; name: string; weight: number } | null;
  /** Needs three holdings: for fewer, "the top three together" is simply everything. */
  topThree: { weight: number; tickers: string[] } | null;
  effectiveHoldings: number | null;
  averageCorrelation: number | null;
  highestPair: CorrelationPair | null;
}

/** The measured facts the Risk and analytics section shows. None is a score; a missing one stays null. */
export function riskFacts(analytics: PortfolioAnalytics): RiskFacts {
  const positions = orderedPositions(analytics);
  const pairs = correlationPairs(analytics);
  const top3 = positions.slice(0, 3);
  return {
    volatility: finite(analytics.volatility_annualized) ? analytics.volatility_annualized : null,
    largest: positions[0] ? { ticker: positions[0].ticker, name: positions[0].name, weight: positions[0].weight } : null,
    topThree: positions.length >= 3 ? { weight: top3.reduce((sum, p) => sum + p.weight, 0), tickers: top3.map((p) => p.ticker) } : null,
    effectiveHoldings: finite(analytics.effective_n) ? analytics.effective_n : null,
    averageCorrelation: pairs.length > 0 ? pairs.reduce((sum, p) => sum + p.value, 0) / pairs.length : null,
    highestPair: pairs.reduce<CorrelationPair | null>((best, p) => (best === null || p.value > best.value ? p : best), null),
  };
}

export interface Spread {
  sectors: number;
  countries: number;
  currencies: number;
  largestSector: { label: string; weight: number } | null;
  /** The share of the money in holdings whose sector is not known, which is not a sector of its own. */
  unclassifiedSector: number | null;
}

/** The backend's label for a holding it could not classify. */
export const UNCLASSIFIED = "Unclassified";

/**
 * How widely the money is spread: counts of sectors, countries and currencies, and the biggest
 * sector. "Unclassified" is not counted as a sector, country or currency, and is never the largest
 * sector: it is a gap in the data, reported separately.
 */
export function spread(analytics: PortfolioAnalytics): Spread {
  const known = (list: { label: string; weight: number }[]) => list.filter((e) => e.label !== UNCLASSIFIED);
  const sectors = known(analytics.by_sector);
  const largest = [...sectors].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))[0];
  const unclassified = analytics.by_sector.find((e) => e.label === UNCLASSIFIED);
  return {
    sectors: sectors.length,
    countries: known(analytics.by_country).length,
    currencies: known(analytics.by_currency).length,
    largestSector: largest ? { label: largest.label, weight: largest.weight } : null,
    unclassifiedSector: unclassified ? unclassified.weight : null,
  };
}
