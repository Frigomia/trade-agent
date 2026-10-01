import { formatPct } from "@/lib/format";

export interface SignalStats {
  count: number;
  avg_forward_return_pct: number;
  hit_rate: number;
}

export interface EquityCurve {
  strategy: number[];
  buy_and_hold: number[];
}

export interface BacktestListItem {
  id: number;
  created_at: string;
  ticker: string;
  start_date: string;
  end_date: string;
  final_value: number;
  buy_and_hold_value: number;
  excess_return_pct: number;
  hit_rate_by_signal: Record<string, SignalStats>;
  status: string;
}

export interface BacktestResult extends BacktestListItem {
  equity_curve: EquityCurve | null;
}

export interface JobStatus {
  status: "RUNNING" | "DONE" | "FAILED";
  backtest_result_id: number | null;
}

export interface RunInput {
  ticker: string;
  start: string;
  end: string;
}

export const STARTING_VALUE = 10_000;
export const MAX_RANGE_DAYS = 10_950;
const TICKER_PATTERN = /^[A-Za-z0-9.\-^]{1,20}$/;

export function defaultRange(now: Date): { start: string; end: string } {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export function validateRun({ ticker, start, end }: RunInput): string | null {
  if (!TICKER_PATTERN.test(ticker.trim())) {
    return "Enter a ticker: letters, digits, . - or ^, up to 20 characters.";
  }
  if (!start || !end) return "Choose a start and an end date.";
  if (start > end) return "The start date must not be after the end date.";
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > MAX_RANGE_DAYS) {
    return "The range can be at most 30 years.";
  }
  return null;
}

export function excessLabel(fraction: number): string {
  const pct = fraction * 100;
  if (Math.abs(pct) < 0.05) return "Level with buy-and-hold";
  return `${pct > 0 ? "Ahead of" : "Behind"} buy-and-hold by ${formatPct(pct)}`;
}

export interface SignalRow {
  key: string;
  label: string;
  count: number;
  avgMovePct: number;
  risePct: number;
  small: boolean;
}

const SIGNAL_LABELS: Record<string, string> = {
  OVERSOLD: "Oversold",
  STRONG_UPTREND: "Strong uptrend",
  WEAK_DOWNTREND: "Weak downtrend",
  NEUTRAL: "Neutral",
};

// A signal the UI has no label for yet: OVERBOUGHT -> "Overbought", WEAK_UPTREND -> "Weak uptrend".
function humanize(key: string): string {
  const words = key.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function signalRows(stats: Record<string, SignalStats>): SignalRow[] {
  return Object.entries(stats)
    .map(([key, s]) => {
      const count = Math.round(s.count);
      return {
        key,
        label: SIGNAL_LABELS[key] ?? humanize(key),
        count,
        avgMovePct: s.avg_forward_return_pct * 100,
        risePct: s.hit_rate * 100,
        small: count < 5,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
