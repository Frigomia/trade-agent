import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EtfOverview } from "./EtfOverview";
import { claim, etfRec } from "./testData";

const idea = (over = {}) => etfRec(over).idea!;

describe("EtfOverview", () => {
  it("stacks the hero, the role, catalysts, bear case, conclusion and sources in the mock's order", () => {
    render(<EtfOverview idea={idea({ sources: [claim(), claim({ stance: "bear", url: "https://b.example/x" })] })} />);

    const names = ["If you add 5% of this fund", "The role it plays", "Catalysts", "Bear case", "Conclusion", "Sources and research transparency"];
    const heads = names.map((n) => screen.getByRole("heading", { name: n }));
    heads.slice(1).forEach((h, i) => expect(heads[i].compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Catalysts" }).closest("section")).toHaveTextContent("Dated events only");
    expect(screen.getByText("Fills the emerging-markets gap at a low cost.")).toBeInTheDocument();
    expect(screen.getByText("A low-cost diversifier, not a short-term trade.")).toBeInTheDocument();
  });

  it("puts the AI text in dashed boxes marked Written by AI, with the cited source count on the role and bear case", () => {
    render(<EtfOverview idea={idea({ sources: [claim(), claim({ stance: "bear", url: "https://b.example/x" })] })} />);

    const role = screen.getByRole("heading", { name: "The role it plays" }).closest("section")!;
    expect(within(role).getByText("Written by AI · 2 cited sources")).toBeInTheDocument();
    expect(within(role).getByText("Fills the emerging-markets gap at a low cost.").closest("div")).toHaveStyle({ borderStyle: "dashed" });
    const bear = screen.getByRole("heading", { name: "Bear case" }).closest("section")!;
    expect(within(bear).getByText("Written by AI · 1 cited source")).toBeInTheDocument();
    expect(within(bear).getByText("Emerging markets often fall further in sell-offs.")).toBeInTheDocument();
    expect(screen.getAllByText(/^Written by AI/)).toHaveLength(4);
  });

  it("leaves the catalysts panel out when none were saved", () => {
    render(<EtfOverview idea={idea({ catalysts: [] })} />);

    expect(screen.queryByRole("heading", { name: "Catalysts" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bear case" })).toBeInTheDocument();
  });

  it("dates a catalyst only when it has a date", () => {
    render(<EtfOverview idea={idea({ catalysts: ["A legacy text catalyst"] })} />);

    expect(screen.getByText("A legacy text catalyst")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Catalysts" }).closest("section")!.querySelector("time")).toBeNull();
  });

  it("shows the fund facts and quality filter only on a phone, before the sources", () => {
    const { rerender } = render(<EtfOverview idea={idea()} />);
    expect(screen.queryByRole("heading", { name: "Fund facts" })).not.toBeInTheDocument();

    rerender(<EtfOverview idea={idea()} withSide />);
    const facts = screen.getByRole("heading", { name: "Fund facts" });
    const sources = screen.getByRole("heading", { name: "Sources and research transparency" });
    expect(screen.getByRole("heading", { name: /Quality filter/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conclusion" }).compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(facts.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets a long unbroken AI text wrap instead of overflowing its box", () => {
    const long = "x".repeat(300);
    render(<EtfOverview idea={idea({ thesis: long, bear_case: long, conclusion: long })} />);

    for (const el of screen.getAllByText(long)) expect(el).toHaveStyle({ overflowWrap: "anywhere" });
    expect(screen.getAllByText(long)).toHaveLength(3);
  });

  it("has no peers, valuation or quality-score text", () => {
    const { container } = render(<EtfOverview idea={idea()} withSide />);

    expect(container.textContent).not.toMatch(/peers|valuation|quality score/i);
  });
});
