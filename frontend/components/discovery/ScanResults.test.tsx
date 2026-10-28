import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanResults } from "./ScanResults";
import type { ScanRun } from "@/lib/api/discovery-types";

const now = Date.parse("2026-10-28T12:00:00Z");
const scan: ScanRun = {
  id: 1, created_at: "2026-10-28T06:00:00Z", status: "completed",
  universe_size: 600, eligible: 40, shortlisted: 3, researched: 3,
  outcome: "ideas", summary: "One opportunity.", opportunities: 1, set_aside: 2,
  excluded: [
    { ticker: "FAIL", name: "Failed Issuer", reason: "thesis_invalidated", explanation: "Licence revoked.", evidence: ["https://example.com/regulator"] },
    { ticker: "OLD", name: "Old Quote", reason: "unreliable_price", explanation: "Quote is stale.", evidence: [] },
  ],
  rejected_mentions: [{ mention: { name: "<script>unsafe()</script>", ticker_hint: null, exchange_hint: null, origin: "reddit", reason: "Unverified discussion", url: "javascript:alert(1)" }, reason: "ambiguous" }],
  coverage_summary: {
    non_opportunities: [{ ticker: "LOW", name: "Low Scorer", overall: 50, confidence: "medium", explanation: "Valuation is demanding.", evidence: [], data_notes: ["Limited peer data"] }],
    snapshot_symbols: 580, missing_snapshot_symbols: ["MISS"], candidate_failures: ["ERR"],
    stale_symbols: [], uncertain_price_symbols: [], mentions_available: false,
  },
};

describe("saved scan results", () => {
  it("separates researched results from screening and mentions, with evidence and coverage", () => {
    const { container } = render(<ScanResults scan={scan} now={now} />);
    expect(screen.getByRole("heading", { name: "Set aside after research · 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Excluded before research · 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rejected mentions · 1" })).toBeInTheDocument();
    expect(screen.getByText("Licence revoked.")).toBeInTheDocument();
    expect(screen.getByText("Valuation is demanding.")).toBeInTheDocument();
    expect(screen.getByText("Limited peer data")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.com" })).toHaveAttribute("href", "https://example.com/regulator");
    expect(screen.getByText("<script>unsafe()</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("Daily mentions unavailable")).toBeInTheDocument();
    expect(screen.getByText("Research failures · 1")).toBeInTheDocument();
    expect(screen.queryByText(/Full researched-result details/)).not.toBeInTheDocument();
  });

  it("shows no scan and no set-aside results explicitly", () => {
    const { rerender } = render(<ScanResults scan={null} now={now} />);
    expect(screen.getByRole("heading", { name: "No scan yet" })).toBeInTheDocument();
    rerender(<ScanResults scan={{ ...scan, set_aside: 0, opportunities: 3, excluded: [], rejected_mentions: [], coverage_summary: { non_opportunities: [] } }} now={now} />);
    expect(screen.getByText("Nothing set aside after research.")).toBeInTheDocument();
    expect(screen.getByText("No rejected mentions saved.")).toBeInTheDocument();
  });

  it("dates an old scan and acknowledges unavailable legacy details", () => {
    render(<ScanResults scan={{ ...scan, created_at: "2026-10-19T06:00:00Z", coverage_summary: {} }} now={now} />);
    expect(screen.getByText(/Older scan/)).toBeInTheDocument();
    expect(screen.getByText(/Saved .*2026/)).toHaveTextContent("19");
    expect(screen.getByText(/Full researched-result details/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set aside after research · 2" })).toBeInTheDocument();
  });
});
