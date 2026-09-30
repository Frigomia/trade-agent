export interface UsageDetail {
  used: number;
  limit: number;
}
export interface Usage {
  analysis_runs: UsageDetail;
  chat_messages: UsageDetail;
}

/** First of next month, UTC, "YYYY-MM-DD" (Date.UTC rolls month 12 into next year). */
export function nextResetDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export function usageFraction({ used, limit }: UsageDetail): number {
  return limit <= 0 ? 0 : Math.min(1, used / limit);
}

export function usageLevel({ used, limit }: UsageDetail): "ok" | "warn" | "limit" {
  if (limit <= 0) return "ok";
  if (used >= limit) return "limit";
  return used / limit > 0.9 ? "warn" : "ok";
}
