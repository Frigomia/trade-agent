export interface RecurringInput {
  name: string;
  ticker: string;
  asset_type: "STOCK" | "ETF";
  source: string | null;
  amount: number;
  currency: string;
  frequency: "monthly";
  start_date: string;
}

export interface RecurringPlan extends RecurringInput {
  id: number;
  status: "active" | "paused" | "ended";
  next_date: string | null;
  upcoming_dates: string[];
}

export interface RecurringOccurrence {
  id: number;
  plan_id: number;
  scheduled_date: string;
  ticker: string;
  asset_type: "STOCK" | "ETF";
  amount: number;
  currency: string;
  status: "scheduled" | "skipped" | "confirmed";
  trade_id: number | null;
}

export interface RecurringData {
  plans: RecurringPlan[];
  occurrences: RecurringOccurrence[];
}

export interface RecurringPreview {
  upcoming_dates: string[];
  catch_up_count: number;
}
