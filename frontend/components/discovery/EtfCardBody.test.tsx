import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { etfRec } from "@/components/workbench/testData";
import type { DiscoveryRecommendation, IdeaOut } from "@/lib/api/discovery-types";
import { OpportunityCard } from "./OpportunityCard";
import { TopOpportunity } from "./TopOpportunity";

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(), ApiError: class extends Error {} }));

const NAME = "iShares Core MSCI EM IMI UCITS ETF (Acc)";
const FILTER = "Quality filter passed: cost 0.18%, size EUR 5.6B, no overlap with your ETFs";

function sample(over: Partial<IdeaOut> = {}): DiscoveryRecommendation {
  const base = etfRec({ name: NAME, ticker: "IS3N.DE", headline: "Adds emerging markets your portfolio barely holds.", ...over });
  return { ...base, ticker: "IS3N.DE" };
}

describe.each([
  ["OpportunityCard", (rec: DiscoveryRecommendation) => <OpportunityCard rec={rec} />],
  ["TopOpportunity", (rec: DiscoveryRecommendation) => <TopOpportunity rec={rec} />],
])("%s for an ETF", (_name, mount) => {
  it("shows the short name, ticker line, gap score, confidence, category, AI label and filter line", () => {
    render(mount(sample()));
    expect(screen.getByRole("heading", { level: 3, name: "iShares Core MSCI EM IMI" })).toBeInTheDocument();
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("IS3N.DE · ETF · UCITS · Acc");
    expect(card).toHaveTextContent("Gap score 54");
    expect(card).toHaveTextContent("High confidence");
    expect(card).toHaveTextContent("Diversified Emerging Mkts");
    expect(card).toHaveTextContent("AI headline");
    expect(card).toHaveTextContent("Adds emerging markets your portfolio barely holds.");
    expect(card).toHaveTextContent(FILTER);
    expect(card).toHaveTextContent("EUR 31.42");
    expect(card).not.toHaveTextContent("Expense ratio");
  });

  it("says the size is unknown when the scan did not save it", () => {
    const rec = sample();
    rec.idea!.snapshot = { ...rec.idea!.snapshot!, fundamentals: { expenseRatio: 0.0018 } };
    render(mount(rec));
    expect(screen.getByRole("article")).toHaveTextContent("Quality filter: 5 passed, size unknown");
  });

  it("wraps a 90-character name instead of cutting it", () => {
    const long = "Amundi Global Diversified Sustainable Equity Opportunities Index Fund ".repeat(2).slice(0, 90);
    render(mount(sample({ name: long })));
    const title = screen.getByRole("heading", { level: 3 });
    expect(title).toHaveTextContent(long.trim());
    expect(title).toHaveStyle({ overflowWrap: "break-word" });
    expect(title).not.toHaveStyle({ textOverflow: "ellipsis" });
  });

  it("renders no gap chip and no NaN without a fit score", () => {
    render(mount(sample({ scores: [] })));
    const card = screen.getByRole("article");
    expect(card).not.toHaveTextContent("Gap score");
    expect(card).not.toHaveTextContent("NaN");
    expect(card).toHaveTextContent("High confidence");
  });
});
