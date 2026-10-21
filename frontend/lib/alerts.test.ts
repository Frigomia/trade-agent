import { describe, expect, it } from "vitest";
import type { PortfolioAlerts } from "@/lib/api/alert-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { alertPill, alertRows, missingNote } from "./alerts";

const rec = (over: Partial<RecommendationOut>) => ({ id: 1, ticker: "AAPL", action: "TRIM", ...over }) as RecommendationOut;

describe("alertRows", () => {
  it("uses the pending calls as rows while the typed alerts have not loaded", () => {
    const rows = alertRows(undefined, [rec({ name: "Apple Inc." })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: "AAPL", name: "Apple Inc.", kind: "new_recommendation", href: "/today/1", text: "New AI recommendation: TRIM" });
  });

  it("uses the typed alerts once loaded, and takes an automatic call's source from the pending list", () => {
    const typed: PortfolioAlerts = {
      alerts: [{ ticker: "AAPL", name: null, kind: "new_recommendation", text: "New AI recommendation: TRIM", when: null, direction: null, recommendation_id: 1 }],
      missing: [],
    };

    const rows = alertRows(typed, [rec({ source: "scheduled" })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("scheduled");
  });

  it("adds a pending call the typed alerts do not list, in front, so a waiting decision is never hidden", () => {
    const typed: PortfolioAlerts = {
      alerts: [{ ticker: "AURL", name: null, kind: "earnings_upcoming", text: "Earnings today", when: "2026-10-21", direction: null, recommendation_id: null }],
      missing: [],
    };

    const rows = alertRows(typed, [rec({ id: 5, ticker: "NEW" })]);

    expect(rows.map((r) => [r.kind, r.ticker])).toEqual([["new_recommendation", "NEW"], ["earnings_upcoming", "AURL"]]);
  });

  it("gives every typed alert its own key, even two for the same ticker", () => {
    const one = { ticker: "AAPL", name: null, kind: "earnings_upcoming" as const, text: "Earnings today", when: "2026-10-21", direction: null, recommendation_id: null };
    const rows = alertRows({ alerts: [one, { ...one, kind: "move_since_purchase", direction: "up" }], missing: [] }, []);

    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("alertPill", () => {
  it("says the kind in words, with a tone that is colour only for a move", () => {
    expect(alertPill({ kind: "new_recommendation", direction: null })).toEqual({ label: "New insight", tone: "outline" });
    expect(alertPill({ kind: "earnings_upcoming", direction: null })).toEqual({ label: "Up next", tone: "muted" });
    expect(alertPill({ kind: "move_since_purchase", direction: "up" })).toEqual({ label: "Positive move", tone: "up" });
    expect(alertPill({ kind: "move_since_purchase", direction: "down" })).toEqual({ label: "Negative move", tone: "down" });
    expect(alertPill({ kind: "move_since_purchase", direction: null })).toEqual({ label: "Moved", tone: "outline" });
  });
});

describe("missingNote", () => {
  it("is null when everything was checked, and names what was not", () => {
    expect(missingNote([])).toBeNull();
    expect(missingNote(["earnings"])).toBe("Could not check earnings dates, so alerts of that kind may be missing.");
    expect(missingNote(["earnings", "prices"])).toBe("Could not check earnings dates or some prices, so alerts of that kind may be missing.");
  });
});
