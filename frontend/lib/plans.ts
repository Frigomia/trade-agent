"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";

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
