import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { dayText } from "@/lib/discovery";

/**
 * How far the price has moved since the idea was issued, in percent to one decimal. Null when either
 * price is missing, not finite or not positive (a zero quote is missing, not a -100% fall). The caller must only pass a pair
 * quoted in one unit. For a discovery idea the backend gives both in the major unit (it converts the live
 * quote, and sends none when the unit is unknown), so the pair is comparable.
 */
export function moveSinceRecommended(rec: Pick<RecommendationOut, "price_at_recommendation" | "current_price">): number | null {
  const { price_at_recommendation: then, current_price: now } = rec;
  if (then === null || now === null || !Number.isFinite(then) || !Number.isFinite(now) || then <= 0 || now <= 0) return null;
  const pct = (now / then - 1) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 + 0 : null;
}

/** The day the person decided, in their own time zone ("20 Oct 2026"); null when the idea was never reviewed. */
export function decisionStamp(rec: Pick<RecommendationOut, "reviewed_at">): string | null {
  return rec.reviewed_at ? dayText(rec.reviewed_at) : null;
}
