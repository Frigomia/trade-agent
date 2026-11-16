import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CandidateFit, IdeaOut, Level } from "@/lib/api/discovery-types";
import { EtfHero } from "./EtfHero";
import { etfIdea } from "./testData";

// Parts: correlation 55, volatility 53, concentration 54; their mean is the saved gap score of 54.
const FIT: CandidateFit = {
  ticker: "VWCE",
  applicable: true,
  avg_correlation_to_portfolio: -0.1,
  portfolio_vol_before: 0.151,
  portfolio_vol_after: 0.142,
  hhi_before: 0.2065,
  hhi_after: 0.19,
  sector_weight_before: null,
  sector_weight_after: null,
  hypothetical_weight: 0.05,
  notes: [],
};

function idea(over: { gap?: number; confidence?: Level; fit?: CandidateFit | null } = {}): IdeaOut {
  const { gap = 54, confidence = "high", fit = FIT } = over;
  return etfIdea({ scores: [{ name: "fit", score: gap, reasons: [] }], overall: gap, confidence, fit });
}

const headline = () => screen.getByText("Gap score").parentElement!;

describe("EtfHero", () => {
  it("shows the gap score, the three strips and the part scores", () => {
    render(<EtfHero idea={idea()} />);

    expect(screen.getByRole("heading", { name: "If you add 5% of this fund" })).toBeInTheDocument();
    expect(within(headline()).getByText("54")).toBeInTheDocument();
    expect(within(headline()).getByText("of 100")).toBeInTheDocument();
    expect(within(headline()).getByText("Qualifies")).toBeInTheDocument();

    expect(screen.getByRole("img", { name: /^Portfolio volatility: now 15\.1%, with 5% 14\.2%/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Spread of your money: now 4\.8, with 5% 5\.3/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Moves with your holdings/ })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);

    expect(screen.getByText("0.9 points lower")).toBeInTheDocument();
    expect(screen.getByText("0.5 more effective positions")).toBeInTheDocument();
    expect(screen.getByText("Effective positions · HHI 0.21 to 0.19")).toBeInTheDocument();
    expect(screen.getByText("Moves mostly on its own")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("5.3")).toBeInTheDocument();
    expect(screen.getByText("13%")).toBeInTheDocument();
    expect(screen.getByText("16%")).toBeInTheDocument();

    expect(screen.getAllByText("of 100")).toHaveLength(4);
    expect(screen.getByText(/mean of the three part scores \(53, 54 and 55\)/)).toBeInTheDocument();
    expect(screen.getByText(/qualifies at 50 or more with medium or high confidence/)).toBeInTheDocument();
    expect(screen.getByText("With 5% of VWCE")).toBeInTheDocument();
    expect(screen.getByText(/Your portfolio now against the same portfolio/)).toBeInTheDocument();
  });

  it("says a negative correlation moves against the holdings", () => {
    render(<EtfHero idea={idea({ fit: { ...FIT, avg_correlation_to_portfolio: -0.4 } })} />);
    expect(screen.getByText("Tends to move against your holdings")).toBeInTheDocument();
    expect(screen.queryByText("Moves mostly on its own")).toBeNull();
  });

  it("with no saved fit shows the score and no strips, and never NaN", () => {
    const { container } = render(<EtfHero idea={idea({ fit: null })} />);

    expect(within(headline()).getByText("54")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
    expect(screen.getAllByText("of 100")).toHaveLength(1);
    expect(screen.queryByText(/part scores/)).not.toBeInTheDocument();
  });

  it("draws two strips when the volatility before is missing", () => {
    const { container } = render(<EtfHero idea={idea({ fit: { ...FIT, portfolio_vol_before: null } })} />);

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByRole("img", { name: /volatility/i })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|undefined/);
    // The parts no longer add up to the saved score, so none is shown.
    expect(screen.getAllByText("of 100")).toHaveLength(1);
  });

  it("hides every part score when they do not add up to the saved score", () => {
    render(<EtfHero idea={idea({ gap: 80 })} />);

    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getAllByText("of 100")).toHaveLength(1);
    expect(screen.queryByText(/mean of the three part scores/)).not.toBeInTheDocument();
    expect(screen.getByText(/qualifies at 50 or more/)).toBeInTheDocument();
  });

  // The correlation strip has a fixed 0 to 1 scale: below 0 the dot is pinned at the left and the words say so,
  // and an axis end is not printed where the label under the dot is anchored to it. The right end is never printed.
  it.each([
    { corr: -1, shown: "-1.00, below the scale", left: false },
    { corr: -0.5, shown: "-0.50, below the scale", left: false },
    { corr: -0.1, shown: "-0.10, below the scale", left: false },
    { corr: 0, shown: "0.00", left: false },
    { corr: 0.5, shown: "0.50", left: true },
    { corr: 0.98, shown: "0.98", left: true },
    { corr: 1, shown: "1.00", left: true },
  ])("labels the correlation strip at $corr", ({ corr, shown, left }) => {
    render(<EtfHero idea={idea({ fit: { ...FIT, avg_correlation_to_portfolio: corr } })} />);

    const strip = screen.getByRole("img", { name: /^Moves with your holdings/ });
    expect(strip).toHaveAttribute("aria-label", `Moves with your holdings: this fund ${shown}, where 1.00 would move exactly with your holdings`);
    expect(within(strip).getByText("This fund")).toBeInTheDocument();
    expect(within(strip).getAllByText(shown).length).toBeGreaterThan(0);
    expect(within(strip).getByText("Moves exactly with you")).toBeInTheDocument();
    expect(within(strip).queryByText("0") !== null).toBe(left);
    expect(within(strip).queryByText("1")).not.toBeInTheDocument();
    expect(shown.includes("below the scale")).toBe(corr < 0);
  });

  it("does not say Qualifies at low confidence", () => {
    render(<EtfHero idea={idea({ confidence: "low" })} />);
    expect(screen.queryByText("Qualifies")).not.toBeInTheDocument();
  });

  it("qualifies at a gap score of 50 and not at 49", () => {
    const { unmount } = render(<EtfHero idea={idea({ gap: 49, confidence: "medium" })} />);
    expect(screen.queryByText("Qualifies")).not.toBeInTheDocument();
    unmount();

    render(<EtfHero idea={idea({ gap: 50, confidence: "medium" })} />);
    expect(screen.getByText("Qualifies")).toBeInTheDocument();
  });
});
