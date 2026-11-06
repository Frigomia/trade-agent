export interface RecurringInput {
  name: string;
  ticker: string;
  asset_type: "STOCK" | "ETF";
  source?: string | null;
  amount: string | number;
  currency: string;
  frequency: "weekly" | "biweekly" | "monthly" | "custom";
  interval_count?: number;
  interval_unit?: "days" | "weeks" | "months";
  start_date: string;
  end_date?: string | null;
  backfill?: boolean;
}
export interface RecurringPlan extends RecurringInput {
  id: number;
  status: "active" | "paused" | "ended";
  tracking_enabled?: boolean;
  next_date: string | null;
  upcoming_dates: string[];
}
export interface RecurringOccurrence {
  id: number;
  plan_id: number;
  scheduled_date: string;
  ticker: string;
  asset_type: "STOCK" | "ETF";
  amount: string | number;
  currency: string;
  status: "scheduled" | "skipped" | "confirmed" | "posted" | "reconciled" | "voided";
  trade_id: number | null;
  effective_date?: string | null;
  quote_currency?: string | null;
  reference_price?: string | null;
  fx_rate?: string | null;
  fx_date?: string | null;
  pricing_source?: string | null;
  error?: string | null;
  shares?: string | null;
  price?: string | null;
  trade_date?: string | null;
}
export interface RecurringData { plans: RecurringPlan[]; occurrences: RecurringOccurrence[]; }
export interface RecurringPreview {
  upcoming_dates: string[];
  catch_up_count: number;
  first_date?: string | null;
  last_date?: string | null;
  conflict?: string | null;
}
