"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import { toTime } from "@/components/portfolio/PortfolioChart";

export interface PlanRequest {
  amount: number;
  whole_shares: boolean;
}

export interface PlanLine {
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

/** The backend's bounds: more than 0, at most 1,000,000, two decimals at most. null when invalid. */
export function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(",", "."); // some decimal keypads show a comma
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 && n <= 1_000_000 ? n : null;
}

// The backend stores naive UTC timestamps; toTime reads them as UTC, as the portfolio chart does.
/** "October 2026", in the viewer's time zone. */
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
    preview: previewPlan,
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
