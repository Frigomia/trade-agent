import { describe, expect, it } from "vitest";
import type { DiscoveryRecommendation, IdeaOut, ScanRun } from "@/lib/api/discovery-types";
import {
  calendarDateText,
  dateTimeText,
  holdingsOnly,
  listingText,
  meterFill,
  monogram,
  priceText,
  commonQuoteDay,
  quoteLabel,
  riskLabel,
  scanCounts,
  sectorText,
  splitIdeas,
  stageIndex,
  whenText,
} from "./discovery";

function idea(over: Partial<IdeaOut> = {}): IdeaOut {
  return {
    ticker: "HLDN",
    name: "Halden Systems",
    asset_type: "STOCK",
    scores: [],
    overall: 80,
    confidence: "high",
    risk: {
      market_cap_eur: null,
      avg_daily_value_eur: null,
      size_bucket: "large",
      volatility_annualized: null,
      max_drawdown_1y: null,
      risk_flags: [],
      risk_level: "medium",
    },
    thesis: "t",
    catalysts: [],
    outlook: "o",
    bear_case: "b",
    conclusion: "c",
    negative_developments: [],
    fit_summary: null,
    community_note: null,
    sources: [],
    data_notes: [],
    snapshot: {
      exchange: "NASDAQ",
      country: "United States",
      sector: "Software",
      industry: "Infrastructure",
      currency: "USD",
      price: 184.2,
      price_as_of: "2026-10-19T20:00:00",
    },
    ...over,
  };
}

function rec(id: number, source: string, withIdea = true, asOf?: string | null): DiscoveryRecommendation {
  const base = idea({ ticker: `T${id}` });
  const withDate = asOf === undefined ? base : { ...base, snapshot: { ...base.snapshot!, price_as_of: asOf } };
  return { id, source, idea: withIdea ? withDate : null } as unknown as DiscoveryRecommendation;
}

describe("holdingsOnly", () => {
  it("drops discovery rows and keeps manual, scheduled and untagged ones", () => {
    const rows = [{ source: "discovery" }, { source: "manual" }, { source: "scheduled" }, {}] as { source?: "manual" }[];
    expect(holdingsOnly(rows)).toHaveLength(3);
  });
});

describe("splitIdeas", () => {
  it("takes the first idea as the top one, the next three as the others, and counts the rest", () => {
    const { top, others, more } = splitIdeas([1, 2, 3, 4, 5, 6, 7].map((i) => rec(i, "discovery")));
    expect(top?.id).toBe(1);
    expect(others.map((r) => r.id)).toEqual([2, 3, 4]);
    expect(more).toBe(3);
  });

  it("skips rows with no saved idea and handles an empty feed", () => {
    expect(splitIdeas([rec(1, "discovery", false), rec(2, "discovery")]).top?.id).toBe(2);
    expect(splitIdeas([])).toEqual({ top: null, others: [], more: 0 });
  });
});

describe("meterFill and labels", () => {
  it("fills one, two or three segments and none for unknown risk", () => {
    expect([meterFill("low"), meterFill("medium"), meterFill("high"), meterFill("unknown")]).toEqual([1, 2, 3, 0]);
  });

  it("says unknown risk in words", () => {
    expect(riskLabel("unknown")).toBe("Risk unknown");
    expect(riskLabel("low")).toBe("Low risk");
  });
});

describe("monogram", () => {
  it("uses two initials, or two letters of a single word", () => {
    expect(monogram("Halden Systems")).toBe("HS");
    expect(monogram("Nvidia")).toBe("NV");
    expect(monogram("  ")).toBe("?");
    expect(monogram("𝔸lpha Beta")).toBe("𝔸B"); // not half a surrogate pair
  });
});

describe("snapshot text", () => {
  it("formats price with its currency code and hides it when absent", () => {
    expect(priceText(idea())).toBe("USD 184.20");
    expect(priceText(idea({ snapshot: null }))).toBeNull();
    expect(priceText(idea({ snapshot: { ...idea().snapshot!, price: null } }))).toBeNull();
  });

  it("joins ticker and exchange, and sector with industry", () => {
    expect(listingText(idea())).toBe("HLDN · NASDAQ");
    expect(listingText(idea({ snapshot: null }))).toBe("HLDN");
    expect(sectorText(idea())).toBe("Software · Infrastructure");
    expect(sectorText(idea({ snapshot: null }))).toBeNull();
  });
});

describe("scanCounts", () => {
  const scan = (opportunities: number | null, set_aside: number | null) =>
    ({ opportunities, set_aside }) as ScanRun;

  it("words the saved counts and leaves out set aside when it is zero", () => {
    expect(scanCounts(scan(5, 3))).toEqual(["5 opportunities", "3 set aside"]);
    expect(scanCounts(scan(1, 0))).toEqual(["1 opportunity"]);
  });

  it("shows nothing for a scan saved before the count existed", () => {
    expect(scanCounts(scan(null, null))).toEqual([]);
  });
});

describe("whenText", () => {
  it("says today for the same day and a weekday otherwise", () => {
    const now = Date.parse("2026-10-21T12:01:00Z");
    expect(whenText("2026-10-21T12:00:00Z", now)).toMatch(/^today /);
    expect(whenText("2026-10-19T12:00:00Z", now)).not.toMatch(/^today /);
  });
});


describe("stageIndex", () => {
  it("places each reported stage, and starts at the first for an unknown or missing one", () => {
    expect(["screening", "admitting", "researching", "evaluating", "writing"].map(stageIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(stageIndex("failed")).toBe(0);
    expect(stageIndex(undefined)).toBe(0);
  });
});

describe("commonQuoteDay", () => {
  const at = (asOf: string | null) => rec(1, "discovery", true, asOf);
  const day = (iso: string) => new Date(Date.parse(iso)).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

  it("names the day when every idea shown was quoted on it", () => {
    expect(commonQuoteDay([at("2026-10-20T20:00:00Z"), at("2026-10-20T20:00:00Z")])).toBe(day("2026-10-20T20:00:00Z"));
  });

  it("gives no shared day when the quotes differ, so an older one is not passed off as fresh", () => {
    expect(commonQuoteDay([at("2026-10-09T20:00:00Z"), at("2026-10-21T20:00:00Z")])).toBeNull();
  });

  it("gives no shared day when any quote date is missing or unusable, or there is nothing to show", () => {
    expect(commonQuoteDay([at("2026-10-21T20:00:00Z"), at(null)])).toBeNull();
    expect(commonQuoteDay([at("2026-10-21T20:00:00Z"), at("not a date")])).toBeNull();
    expect(commonQuoteDay([])).toBeNull();
  });
});

describe("quoteLabel", () => {
  const day = (iso: string) => new Date(Date.parse(iso)).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const withDate = (asOf: string | null, notes: string[] = []) => idea({ snapshot: { ...idea().snapshot!, price_as_of: asOf }, data_notes: notes });

  it("dates the saved quote", () => {
    expect(quoteLabel(withDate("2026-10-09T20:00:00Z"))).toBe(`Scan quote · ${day("2026-10-09T20:00:00Z")}`);
  });

  it("says when the scan saved no quote date, and when the research flagged the date as uncertain", () => {
    expect(quoteLabel(withDate(null))).toBe("Scan quote · date unknown");
    expect(quoteLabel(withDate("2026-10-09T20:00:00Z", ["Price date uncertain: no timestamp from the exchange"]))).toMatch(/\(date uncertain\)$/);
    expect(quoteLabel(idea({ snapshot: null }))).toBe("Scan quote · date unknown");
  });
});

describe("quoteLabel with an unusable date", () => {
  it("says the date is unknown rather than printing Invalid Date", () => {
    const bad = idea({ snapshot: { ...idea().snapshot!, price_as_of: "not a date" } });
    expect(quoteLabel(bad)).toBe("Scan quote · date unknown");
  });
});

describe("dateTimeText", () => {
  it("gives the day with its year and the time, not a relative word", () => {
    const text = dateTimeText("2026-10-20T06:12:00Z");
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/today/i);
  });
});

describe("calendarDateText", () => {
  it("shows a readable calendar day with its year, without shifting to the previous day", () => {
    const text = calendarDateText("2026-11-06");
    expect(text).toContain("Nov");
    expect(text).toContain("2026");
    expect(text).toMatch(/\b6\b/);
    expect(text).not.toMatch(/\b5\b/);
    expect(text).not.toBe("2026-11-06");
  });
});
