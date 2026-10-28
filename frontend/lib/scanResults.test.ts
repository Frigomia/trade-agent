import { describe, it, expect } from "vitest";
import type { ScanRun } from "@/lib/api/discovery-types";
import { coverageNotes, emptyText, ledgerCounts, ledgerRows, NOT_RESEARCHED_SHOWN, sentence, unlistedSetAside, visibleRows } from "./scanResults";

const SCAN: ScanRun = {
  id: 1,
  created_at: "2026-10-28T06:12:00",
  status: "completed",
  universe_size: 600,
  eligible: 412,
  shortlisted: 8,
  researched: 7,
  outcome: "ideas",
  summary: "",
  opportunities: 4,
  set_aside: 3,
  excluded: [
    { ticker: "ORBF", name: "Orbit Freight", reason: "thesis_invalidated", explanation: "A recall.", evidence: ["https://a.example/x"] },
    { ticker: "QLBT", name: "Quill Biotech", reason: "insufficient_data", explanation: "2 core fundamentals available", evidence: [] },
  ],
  rejected_mentions: [
    { mention: { name: "Orange", ticker_hint: null, exchange_hint: null, origin: "reddit", reason: "A thread", url: null }, reason: "ambiguous" },
  ],
  coverage_summary: { set_aside_ideas: [{ ticker: "HRBF", name: "Harbor Foods", overall: 48, confidence: "medium" }] },
};

describe("sentence", () => {
  it("capitalises and adds a full stop only when there is none", () => {
    expect(sentence("an ETF needs separate criteria")).toBe("An ETF needs separate criteria.");
    expect(sentence("Already ends.")).toBe("Already ends.");
    expect(sentence("Really?")).toBe("Really?");
    expect(sentence("  ")).toBe("");
  });
});

describe("ledgerRows", () => {
  it("lists set aside, then not researched, then mentions, with the stored reasons in words", () => {
    const rows = ledgerRows(SCAN);
    expect(rows.map((r) => [r.group, r.name, r.reason])).toEqual([
      ["set", "Orbit Freight", "Thesis no longer holds"],
      ["set", "Harbor Foods", "Below the bar"],
      ["not", "Quill Biotech", "Not enough data"],
      ["men", "Orange", "Name matches several companies"],
    ]);
    expect(rows[0].thesis).toBe(true);
    expect(rows[2].detail).toEqual({ kind: "note", text: "2 core fundamentals available." });
    expect(ledgerCounts(rows)).toEqual({ all: 4, set: 2, not: 1, men: 1 });
  });

  it("copes with a scan saved before set_aside_ideas existed", () => {
    const old = { ...SCAN, coverage_summary: {} };
    expect(ledgerRows(old).filter((r) => r.group === "set")).toHaveLength(1);
    expect(unlistedSetAside(old, 1)).toBe(2);
    expect(unlistedSetAside(SCAN, 2)).toBe(1);
  });

  it("falls back to the nearest misses on a scan saved before set_aside_ideas", () => {
    const old = { ...SCAN, set_aside: 3, coverage_summary: { nearest_misses: [{ ticker: "AAA", name: "Alpha", overall: 40, confidence: "low" as const }] } };
    const set = ledgerRows(old).filter((r) => r.group === "set");
    expect(set.map((r) => r.name)).toEqual(["Orbit Freight", "Alpha"]);
    expect(unlistedSetAside(old, set.length)).toBe(1);
  });

  it("never reports a negative unlisted count, and none for a scan without counts", () => {
    expect(unlistedSetAside({ ...SCAN, set_aside: 0 }, 2)).toBe(0);
    expect(unlistedSetAside({ ...SCAN, set_aside: null, opportunities: null }, 0)).toBe(0);
  });
});

describe("visibleRows", () => {
  const many = {
    ...SCAN,
    excluded: Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}`, name: `N${i}`, reason: "insufficient_data" as const, explanation: "x", evidence: [] })),
    coverage_summary: {},
  };
  it("cuts only the long Not researched group until expanded", () => {
    const rows = ledgerRows(many);
    const closed = visibleRows(rows, "all", false);
    expect(closed.shown.filter((r) => r.group === "not")).toHaveLength(NOT_RESEARCHED_SHOWN);
    expect(closed.hidden).toBe(12 - NOT_RESEARCHED_SHOWN);
    expect(closed.shown.some((r) => r.group === "men")).toBe(true);
    expect(visibleRows(rows, "all", true).hidden).toBe(0);
  });
  it("a filter keeps one group", () => {
    expect(visibleRows(ledgerRows(SCAN), "men", false).shown.map((r) => r.name)).toEqual(["Orange"]);
    expect(visibleRows(ledgerRows(SCAN), "set", false).hidden).toBe(0);
  });
});

describe("emptyText", () => {
  const known = { ...SCAN, set_aside: 0, opportunities: 7 };
  it("states a zero only when the scan recorded one", () => {
    expect(emptyText("set", known, 0)).toBe("Nothing was set aside. Every researched company was put forward.");
    expect(emptyText("all", known, 0)).toBe("Nothing was left out by this scan.");
  });
  it("says the companies were not saved when the count says some were set aside", () => {
    expect(emptyText("set", { ...SCAN, set_aside: 2 }, 0)).toBe("The companies this scan set aside were not saved, so they cannot be listed.");
    expect(emptyText("all", { ...SCAN, set_aside: 2 }, 0)).toBe("The companies this scan set aside were not saved, so they cannot be listed.");
  });
  it("does not assert a zero for a scan without counts", () => {
    const unknown = { ...SCAN, set_aside: null, opportunities: null };
    expect(emptyText("set", unknown, 0)).toBe("This scan did not record what it set aside.");
    expect(emptyText("all", unknown, 0)).toBe("Nothing is listed for this scan.");
  });
  it("keeps the safeguard and mention copy, which the scan always records", () => {
    expect(emptyText("not", SCAN, 0)).toBe("Nothing failed a safeguard.");
    expect(emptyText("men", SCAN, 0)).toBe("No mentions were rejected.");
  });
});

describe("coverageNotes", () => {
  it("says only what the scan recorded, with singular and plural words", () => {
    expect(coverageNotes(SCAN)).toEqual([]);
    expect(
      coverageNotes({ ...SCAN, coverage_summary: { missing_snapshot_symbols: ["A"], stale_symbols: ["B", "C"], uncertain_price_symbols: ["D"], candidate_failures: ["E"], mentions_available: false } }),
    ).toEqual([
      "1 company had no market data.",
      "2 prices are out of date.",
      "1 price could not be confirmed and is shown as saved.",
      "1 candidate could not be evaluated and is not in the counts above.",
      "Research mentions were not available for this scan.",
    ]);
  });
});
