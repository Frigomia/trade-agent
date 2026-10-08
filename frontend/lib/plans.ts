"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import { parseDecimal, toTime } from "@/lib/format";

export interface PlanRequest {
  amount: number;
  whole_shares: boolean;
}

export interface PlanLine {
  id: number | null; // null on a preview, which is not stored
  isin: string | null;
  placed_at: string | null;
  placed_trade_id: number | null;
  ticker: string;
  name: string;
  amount_eur: number;
  shares: number;
  price_eur: number;
  currency: string;
  rate: number;
  weight_before: number | null;
  weight_after: number | null;
  reason: string;
  reason_text: string;
}

export interface Plan {
  id: number | null;
  created_at: string | null;
  amount_eur: number;
  whole_shares: boolean;
  total_before_eur: number;
  leftover_eur: number;
  lines: PlanLine[];
  notes: string[];
  disclaimer: string;
}

export interface PlanSummary {
  id: number;
  created_at: string;
  amount_eur: number;
  line_count: number;
}

export interface DriftItem {
  ticker: string;
  name: string;
  weight: number; // fraction of the targeted open holdings
  target: number;
  points: number; // weight minus target, in percentage points
}

export const DISCLAIMER = "Advisory only. Nothing is sent to a broker.";
export const AMOUNT_ERROR = "Enter an amount from 0.01 to 1,000,000, two decimals at most.";

/** The backend's bounds: at least 0.01, at most 1,000,000, two decimals at most. null when invalid. */
export function parseAmount(raw: string): number | null {
  return parseDecimal(raw, 2, 0.01, 1_000_000);
}

/** "1 USD = 0.9259 EUR" (four significant digits); pence are "1 penny = 0.0118 EUR". */
export function formatRate(currency: string, rate: number): string {
  const value = rate.toLocaleString("en-US", { maximumSignificantDigits: 4, maximumFractionDigits: 20 });
  const unit = currency === "GBp" || currency === "GBX" ? "penny" : currency;
  return `1 ${unit} = ${value} EUR`;
}

/** True when the saved plan has other tickers or other amounts than the one that was previewed. */
export function plansDiffer(a: Plan, b: Plan): boolean {
  const key = (p: Plan) =>
    p.lines
      .map((l) => `${l.ticker}:${l.amount_eur}`)
      .sort()
      .join("|");
  return key(a) !== key(b);
}

/**
 * "October 2026", in the viewer's time zone. The backend stores naive UTC timestamps; toTime reads
 * them as UTC, as the portfolio chart does.
 */
export function planMonth(iso: string): string {
  return new Date(toTime(iso)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** "8 Oct 2026, 09:14", in the viewer's time zone. */
export function planSavedAt(iso: string): string {
  return new Date(toTime(iso)).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PATH = "/plans";
const post = (path: string, req: PlanRequest) => apiFetch<Plan>(path, { method: "POST", body: JSON.stringify(req) });

/** Not stored anywhere: the caller keeps the result in its own state. Throws the ApiError. */
export function previewPlan(req: PlanRequest): Promise<Plan> {
  return post(`${PATH}/preview`, req);
}

/** Saved plans. `save`, `remove` and `load` throw the ApiError (run them inside `useAction`). */
export function usePlans() {
  const { data, error, isLoading, mutate } = useSWR<PlanSummary[]>(PATH, apiFetch);

  async function save(req: PlanRequest): Promise<Plan> {
    const plan = await post(PATH, req);
    await mutate();
    return plan;
  }

  async function remove(id: number): Promise<void> {
    await apiFetch<void>(`${PATH}/${id}`, { method: "DELETE" });
    await mutate();
  }

  const load = (id: number) => apiFetch<Plan>(`${PATH}/${id}`);

  return {
    plans: data,
    error,
    isLoading,
    save,
    remove,
    load,
  };
}

/** One fetch per page view; a failure shows up in `error`, never as a throw. */
export function useDrift() {
  const { data, error, isLoading } = useSWR<DriftItem[]>(`${PATH}/drift`, apiFetch, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    shouldRetryOnError: false,
  });
  return { drift: data, error, isLoading };
}
