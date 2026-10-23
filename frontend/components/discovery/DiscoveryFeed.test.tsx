import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Claim, DiscoveryIdeas, DiscoveryRecommendation, IdeaOut, ScanRun } from "@/lib/api/discovery-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));
beforeEach(() => apiFetch.mockReset());

const claim = (url: string): Claim => ({ text: "A cited claim.", kind: "fact", stance: "bull", materiality: "high", source_tier: "official", url, published_at: null });
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
    negative_developments: [],
    fit_summary: null,
    community_note: null,
    conclusion: "c",
    sources: [claim("https://a.example"), claim("https://b.example")],
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
    created_at: "2026-10-20T06:12:00", // the same instant as SCAN: written by it
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
  it("uses the sector icon even when the label includes an industry", () => {
    const snapshot = { ...idea("Halden").snapshot!, sector: "Consumer Defensive", industry: "Farm Products" };
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden", { snapshot })] });

    const label = screen.getByText("Consumer Defensive · Farm Products");
    expect(label.querySelector("svg.lucide-shopping-basket")).toHaveAttribute("aria-hidden", "true");
  });

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

  it("names a shared quote day only when every other idea has it, not the newest date for all", () => {
    const older = rec(3, "Tanaka Precision", { snapshot: { ...idea("x").snapshot!, price_as_of: "2026-10-09T20:00:00" } });
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems"), rec(2, "Brevik Medical"), older] });

    expect(screen.queryByText(/^Prices as of /)).not.toBeInTheDocument();
  });

  it("says when the other ideas' prices were saved, and offers no link when everything is shown", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems"), rec(2, "Brevik Medical")] });

    const day = new Date(Date.parse("2026-10-19T20:00:00Z")).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    expect(screen.getByText(`Prices as of ${day}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("dates every saved price, so an older idea does not look current", () => {
    const old = rec(2, "Brevik Medical", { snapshot: { ...idea("x").snapshot!, price_as_of: "2026-10-09T20:00:00" } });
    const none = rec(3, "Tanaka Precision", { snapshot: { ...idea("x").snapshot!, price_as_of: null } });
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems"), old, none] });

    const day = (iso: string) => new Date(Date.parse(iso + "Z")).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    expect(screen.getByRole("article", { name: "Top opportunity: Halden Systems" })).toHaveTextContent(`Scan quote · ${day("2026-10-19T20:00:00")}`);
    expect(screen.getByRole("article", { name: "Brevik Medical" })).toHaveTextContent(`Scan quote · ${day("2026-10-09T20:00:00")}`);
    expect(screen.getByRole("article", { name: "Tanaka Precision" })).toHaveTextContent("Scan quote · date unknown");
  });

  it("describes the latest scan from the saved counts and the runs used", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] });

    expect(screen.getByRole("status")).toHaveTextContent(/Latest AI scan · Updated .* · 5 opportunities · 3 set aside/);
    expect(screen.getByRole("button", { name: /refresh scan, 23 of 100 runs used this month\. costs 1 run/i })).toBeEnabled();
  });

  it("saves a company to Discover from Today, then offers the way to the list", async () => {
    apiFetch.mockResolvedValue({});
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems"), rec(2, "Brevik Medical")] });

    fireEvent.click(screen.getByRole("button", { name: "Save to Discover Halden Systems" }));

    expect(await screen.findByRole("link", { name: "View in Discover" })).toHaveAttribute("href", "/discover");
    expect(screen.getByRole("button", { name: "Halden Systems saved to Discover" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Halden Systems saved to Discover" }));
    expect(apiFetch).toHaveBeenCalledTimes(1); // pressing the saved button again sends nothing
    expect(apiFetch).toHaveBeenCalledWith("/discover", { method: "POST", body: JSON.stringify({ ticker: "HALD", asset_type: "STOCK", source: "today" }) });
    expect(screen.getByRole("button", { name: "Save Brevik Medical" })).toBeEnabled(); // only that company was saved
  });

  it("says why a save failed and lets the person try again", async () => {
    apiFetch.mockRejectedValueOnce(new FakeApiError(409, "Discover is full (100 companies)."));
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] });

    fireEvent.click(screen.getByRole("button", { name: "Save to Discover Halden Systems" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Discover is full (100 companies).");
    apiFetch.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Save to Discover Halden Systems" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "View in Discover" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows only the three other ideas and reveals the rest on request", () => {
    const recs = [1, 2, 3, 4, 5, 6].map((n) => rec(n, `Company${n} Ltd`));
    renderFeed({ latest_scan: SCAN, recommendations: recs });

    expect(screen.getAllByRole("article")).toHaveLength(4); // top + three
    fireEvent.click(screen.getByRole("button", { name: "View all 5" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
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

  it("keeps Try again off in a failed state when the monthly runs are used up, and says why", () => {
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { usage: { used: 100, limit: 100 }, job: { status: "FAILED", stage: "failed", total: 0, done: 0, error: "Discovery scan failed." } },
    );

    expect(screen.getByRole("button", { name: /^try again$/i })).toBeDisabled();
    expect(screen.getByText(/used all your scan runs for this month/i)).toBeInTheDocument();
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
    // The name, score and confidence are visible text, not a hover title, so a phone and a keyboard see them.
    const chip = screen.getByText("Norsk Verk").closest("li")!;
    expect(chip).toHaveTextContent("Norsk Verk NRSK · 58 · medium confidence");
  });

  it("shows a quiet latest scan and its nearest misses even while an older idea is still pending, and labels that idea", () => {
    const quiet: ScanRun = { ...SCAN, outcome: "none", opportunities: 0, set_aside: 8, created_at: "2026-10-21T06:12:00", coverage_summary: { nearest_misses: [{ ticker: "NRSK", name: "Norsk Verk", overall: 58, confidence: "medium" }] } };
    renderFeed({ latest_scan: quiet, recommendations: [rec(1, "Halden Systems")] });

    expect(screen.getByText("No compelling opportunity today")).toBeInTheDocument();
    expect(screen.getAllByText(/NRSK|Norsk Verk/).length).toBeGreaterThan(0); // the nearest miss is named
    expect(screen.getByRole("article", { name: "Top opportunity: Halden Systems" })).toHaveTextContent("From an earlier scan");
  });

  it("does not call an idea written by the latest scan earlier", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [rec(1, "Halden Systems")] });

    expect(screen.getByRole("article", { name: "Top opportunity: Halden Systems" })).not.toHaveTextContent("earlier scan");
  });

  it("says the progress can't be read, offers Check now, and does not claim the scan failed or enable another", () => {
    const onRecheck = vi.fn();
    renderFeed(
      { latest_scan: SCAN, recommendations: [] },
      { running: true, progressUnavailable: true, onRecheck, job: { status: "RUNNING", stage: "researching", total: 8, done: 3, error: null } },
    );

    expect(screen.getByText(/progress can't be read right now/i)).toBeInTheDocument();
    expect(screen.queryByText("The scan did not finish")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /running/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(onRecheck).toHaveBeenCalled();
  });

  it("says plainly that a scan's progress is no longer available, without calling it failed", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [] }, { lost: true });

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByText("The scan did not finish")).not.toBeInTheDocument();
  });

  it("treats a zero run allowance as used up", () => {
    renderFeed({ latest_scan: SCAN, recommendations: [] }, { usage: { used: 0, limit: 0 } });

    expect(screen.getByRole("button", { name: /refresh scan, 0 of 0 runs/i })).toBeDisabled();
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
