import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DiscoveryIdeas, DiscoveryRecommendation, IdeaOut, ScanRun } from "@/lib/api/discovery-types";
import { DiscoveryFeed } from "./DiscoveryFeed";

function idea(name: string, over: Partial<IdeaOut> = {}): IdeaOut {
  return {
    ticker: name.slice(0, 4).toUpperCase(),
    name,
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
    thesis: "A long thesis sentence. A second one.",
    catalysts: ["Q3 results on 6 Nov follow two quarters of margin expansion."],
    outlook: "o",
    bear_case: "Top customers are 38% of revenue. Other text.",
    conclusion: "c",
    sources: [{ url: "https://a.example" }, { url: "https://b.example" }],
    data_notes: [],
    headline: "Recurring revenue priced below peers.",
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

function rec(id: number, name: string, over: Partial<IdeaOut> = {}, change: number | null = 2.1): DiscoveryRecommendation {
  return {
    id,
    user_id: "u",
    created_at: "2026-10-20T06:00:00",
    ticker: name.slice(0, 4).toUpperCase(),
    asset_type: "STOCK",
    action: "WATCH",
    source: "discovery",
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: change,
    idea: idea(name, over),
  };
}

const SCAN: ScanRun = {
  id: 1,
  created_at: "2026-10-20T06:12:00",
  status: "DONE",
  universe_size: 600,
  eligible: 300,
  shortlisted: 20,
  researched: 8,
  outcome: "ideas",
  summary: "",
  coverage_summary: {},
  opportunities: 5,
  set_aside: 3,
};

function renderFeed(ideas: DiscoveryIdeas | undefined, over: Partial<Parameters<typeof DiscoveryFeed>[0]> = {}) {
  const onRun = vi.fn();
  render(
    <DiscoveryFeed
      ideas={ideas}
      loadError={undefined}
      job={undefined}
      running={false}
      startError={null}
      usage={{ used: 23, limit: 100 }}
      locked={false}
      now={Date.parse("2026-10-20T12:00:00Z")}
      onRun={onRun}
      {...over}
    />,
  );
  return { onRun };
}

describe("DiscoveryFeed", () => {
  it("shows the top opportunity with its reasoning, risk, meters and saved price", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems"), rec(2, "Brevik Medical")] });

    const top = screen.getByRole("article", { name: "Top opportunity: Halden Systems" });
    expect(top).toHaveTextContent("USD 184.20");
    expect(top).toHaveTextContent("+2.1%");
    expect(top).toHaveTextContent("Recurring revenue priced below peers.");
    expect(top).toHaveTextContent("Why now. Q3 results on 6 Nov");
    expect(top).toHaveTextContent("Risk to the thesis. Top customers are 38% of revenue.");
    expect(top).toHaveTextContent("AI research summary · 2 cited sources");
    expect(top).toHaveTextContent("High confidence");
    expect(top).toHaveTextContent("Medium risk");
    expect(top).toHaveTextContent("United States");
    expect(screen.getByRole("link", { name: "Open the full analysis of Halden Systems" })).toHaveAttribute("href", "/today/1");
    expect(screen.getByRole("article", { name: "Brevik Medical" })).toBeInTheDocument();
    expect(screen.queryByText("Run your first scan")).not.toBeInTheDocument();
  });

  it("shows the saved price without a change when the live quote did not load", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems", {}, null)] });

    const top = screen.getByRole("article", { name: "Top opportunity: Halden Systems" });
    expect(top).toHaveTextContent("USD 184.20");
    expect(top).not.toHaveTextContent(/[+-]\d+\.\d%/);
  });

  it("describes the latest scan from the saved counts and the runs used", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] });

    expect(screen.getByRole("status")).toHaveTextContent(/Latest AI scan · Updated .* · 5 opportunities · 3 set aside/);
    expect(screen.getByRole("button", { name: /refresh scan, 23 of 100 runs used this month\. costs 1 run/i })).toBeEnabled();
  });

  it("shows Save to Discover disabled until Discover exists", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] });

    expect(screen.getByRole("button", { name: /save to discover halden systems: coming soon/i })).toBeDisabled();
  });

  it("shows only the three other ideas and reveals the rest on request", () => {
    const recs = [1, 2, 3, 4, 5, 6].map((n) => rec(n, `Company${n} Ltd`));
    renderFeed({ latest_scan: SCAN, recommendations: recs });

    expect(screen.getAllByRole("article")).toHaveLength(4); // top + three
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
  });

  it("leaves out price and meta for an idea saved before the display fields existed", () => {
    const old = rec(1, "Legacy Corp", { snapshot: null, headline: null }, null);
    renderFeed({ latest_scan: SCAN, recommendations: [old] });

    const top = screen.getByRole("article", { name: "Top opportunity: Legacy Corp" });
    expect(top).not.toHaveTextContent("USD");
    expect(top).toHaveTextContent("A long thesis sentence."); // the thesis excerpt stands in for the headline
    expect(top).not.toHaveTextContent("NaN");
  });

  it("lists the five scan stages with the finished ones checked and the current one counted", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { running: true, job: { status: "RUNNING", stage: "researching", total: 8, done: 3, error: null } },
    );

    const steps = screen.getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual([
      "Screening 600 companies",
      "Checking companies from research",
      "Researching candidates · 3 of 8",
      "Scoring and ranking",
      "Saving results",
    ]);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).not.toHaveAttribute("aria-current");
    // two stages are done, plus 3 of 8 candidates: (2 + 3/8) / 5
    expect(screen.getByRole("progressbar", { name: "Scan progress" })).toHaveAttribute("aria-valuenow", "48");
    expect(screen.getByText("The scan keeps running if you leave this page.")).toBeInTheDocument();
  });

  it("starts at the first stage when the job has not reported one yet", () => {
    renderFeed(
      { latest_scan: null, recommendations: [] },
      { running: true, job: undefined },
    );

    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Screening companies")).toBeInTheDocument(); // size unknown before a first scan
  });

  it("offers a Reconnect Claude link, not Try again, when the key was rejected", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Your Claude key needs attention." } },
    );

    expect(screen.getByRole("heading", { name: "Your Claude key needs attention." })).toBeInTheDocument();
    expect(screen.getByText(/claude did not accept your key, so the scan stopped. nothing was saved./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reconnect claude/i })).toHaveAttribute("href", "/more/connect-claude?step=5");
    expect(screen.queryByRole("button", { name: /^try again$/i })).not.toBeInTheDocument();
  });

  it("puts a Try again button in a failed state and keeps it off without a usable key", () => {
    const { onRun } = renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Discovery scan failed. Please try again." } },
    );

    fireEvent.click(screen.getByRole("button", { name: /^try again$/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("disables the Try again button when Claude is not connected", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { locked: true, job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Discovery scan failed." } },
    );

    expect(screen.getByRole("button", { name: /^try again$/i })).toBeDisabled();
  });

  it("says a quiet scan is a result and names the nearest misses", () => {
    const quiet: ScanRun = {
      ...SCAN,
      outcome: "none",
      opportunities: 0,
      set_aside: 8,
      coverage_summary: { nearest_misses: [{ ticker: "NRSK", name: "Norsk Verk", overall: 58, confidence: "medium" }] },
    };
    renderFeed({ latest_scan: quiet, recommendations: [] });

    expect(screen.getByText("No compelling opportunity today")).toBeInTheDocument();
    const chip = screen.getByText("NRSK · 58");
    expect(chip).toHaveAttribute("title", "Norsk Verk, medium confidence"); // the company name is on the chip
  });

  it("invites a first scan when none has ever run", () => {
    renderFeed({ latest_scan: null, recommendations: [] });

    expect(screen.getByText("Run your first scan")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No scan yet");
  });

  it("shows progress while running, keeps saved ideas and turns the button off", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] },
      { running: true, job: { status: "RUNNING", stage: "researching", total: 8, done: 3, error: null } },
    );

    expect(screen.getByRole("status")).toHaveTextContent("Scanning now · researching 3 of 8");
    expect(screen.getByRole("progressbar", { name: "Scan progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /running/i })).toBeDisabled();
    expect(screen.getByRole("article", { name: "Top opportunity: Halden Systems" })).toBeInTheDocument();
  });

  it("says a failed scan saved nothing, offers to try again and keeps the last ideas", () => {
    const { onRun } = renderFeed(
      { latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] },
      { job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Scan interrupted. Please try again." } },
    );

    expect(screen.getByText("The scan did not finish")).toBeInTheDocument();
    expect(screen.getByText(/Scan interrupted\. Please try again\. Nothing was saved\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try the scan again/i }));
    expect(onRun).toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "Top opportunity: Halden Systems" })).toBeInTheDocument();
  });

  it("turns the refresh button off once the monthly runs are used up", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [] }, { usage: { used: 100, limit: 100 } });

    expect(screen.getByRole("button", { name: /refresh scan, 100 of 100 runs/i })).toBeDisabled();
  });

  it("ends a failed-scan message with a full stop before saying nothing was saved", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Claude request timed out" } },
    );

    expect(screen.getByText("Claude request timed out. Nothing was saved.")).toBeInTheDocument();
  });

  it("skips a blank catalyst and an empty bear case instead of showing bare labels", () => {
    const blank = rec(1, "Halden Systems", { catalysts: ["  "], bear_case: "  ", headline: "" });
    renderFeed({ latest_scan: SCAN, recommendations: [blank] });

    const top = screen.getByRole("article", { name: "Top opportunity: Halden Systems" });
    expect(top).not.toHaveTextContent("Why now.");
    expect(top).not.toHaveTextContent("Risk to the thesis.");
    expect(top).toHaveTextContent("A long thesis sentence."); // an empty headline falls back to the thesis
  });

  it("disables the refresh button without a usable Claude key", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [] }, { locked: true });

    expect(screen.getByRole("button", { name: /refresh scan/i })).toBeDisabled();
  });
});
