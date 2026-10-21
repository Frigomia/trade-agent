import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Claim, IdeaOut } from "@/lib/api/discovery-types";
import { IdeaEvidence, safeHref } from "./IdeaEvidence";

const claim = (over: Partial<Claim> = {}): Claim => ({
  text: "Revenue grew 12% in the quarter.",
  kind: "fact",
  stance: "bull",
  materiality: "high",
  source_tier: "official",
  url: "https://www.example.com/q3",
  published_at: "2026-10-01",
  ...over,
});

const LONG_BEAR = "Top three customers are 38% of revenue. ".repeat(12) + "The final sentence of the risk.";

function idea(over: Partial<IdeaOut> = {}): IdeaOut {
  return {
    ticker: "HLDN",
    name: "Halden Systems",
    asset_type: "STOCK",
    scores: [],
    overall: 80,
    confidence: "high",
    risk: { market_cap_eur: null, avg_daily_value_eur: null, size_bucket: "large", volatility_annualized: null, max_drawdown_1y: null, risk_flags: [], risk_level: "medium" },
    thesis: "Recurring revenue and widening margins.",
    catalysts: ["Q3 results on 6 Nov."],
    outlook: "Margins should keep widening.",
    bear_case: LONG_BEAR,
    negative_developments: [
      { summary: "A key customer paused renewals.", occurred_on: "2026-09-12", evidence: [], thesis_impact: "Revenue growth could slow.", status: "disputed", invalidates_thesis: false },
    ],
    fit_summary: "It would add software exposure you do not have.",
    community_note: "Forum posts are positive.",
    conclusion: "c",
    sources: [claim(), claim({ url: "javascript:alert(1)", text: "Odd link.", source_tier: "forum" })],
    data_notes: ["Price date uncertain: the exchange did not report one."],
    ...over,
  };
}

describe("IdeaEvidence", () => {
  it("shows the whole bear case, not a clamped line", () => {
    render(<IdeaEvidence idea={idea()} />);

    const risk = screen.getByRole("heading", { name: "Risk to the thesis" }).parentElement!;
    expect(risk).toHaveTextContent("The final sentence of the risk.");
  });

  it("shows the thesis with its cited-source count, the catalysts and the limitations", () => {
    render(<IdeaEvidence idea={idea()} />);

    expect(screen.getByText("Recurring revenue and widening margins.")).toBeInTheDocument();
    expect(screen.getByText("AI research summary · 2 cited sources")).toBeInTheDocument();
    expect(screen.getByText("Q3 results on 6 Nov.")).toBeInTheDocument();
    expect(screen.getByText(/price date uncertain/i)).toBeInTheDocument();
  });

  it("shows each negative development with its status in words, its date and its effect", () => {
    render(<IdeaEvidence idea={idea()} />);

    const item = screen.getByText("A key customer paused renewals.").closest("li")!;
    expect(item).toHaveTextContent("Disputed");
    expect(item).toHaveTextContent("2026-09-12");
    expect(item).toHaveTextContent("Effect on the thesis: Revenue growth could slow.");
  });

  it("links only http(s) sources, opening them safely, and shows the source tier", () => {
    render(<IdeaEvidence idea={idea()} />);

    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("href", "https://www.example.com/q3");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link")).toHaveLength(1); // the javascript: url is plain text
    expect(screen.getByText("· Forum, unverified")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Sources" }).parentElement!).getByText("Odd link.")).toBeInTheDocument();
  });

  it("leaves out sections with nothing to show, and says so when no bear case was saved", () => {
    render(<IdeaEvidence idea={idea({ negative_developments: [], sources: [], data_notes: [], catalysts: [], fit_summary: null, community_note: null, bear_case: " " })} />);

    expect(screen.queryByRole("heading", { name: "Sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What has gone wrong" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Why now" })).not.toBeInTheDocument();
    expect(screen.getByText("No bear case was saved for this idea.")).toBeInTheDocument();
  });
});

describe("safeHref", () => {
  it("accepts http and https and rejects everything else", () => {
    expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHref("http://a.example/")).toBe("http://a.example/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
});
