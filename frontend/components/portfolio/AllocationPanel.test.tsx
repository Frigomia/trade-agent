import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { HoldingSummary } from "@/lib/api/portfolio-types";
import { allocate, largestPositions, type AllocationDim } from "@/lib/portfolio/allocation";
import { AllocationPanel } from "./AllocationPanel";

const holding = (ticker: string, value: number | null, over: Partial<HoldingSummary> = {}): HoldingSummary => ({
  ticker,
  name: `${ticker} Corp`,
  asset_type: "STOCK",
  shares: 10,
  cost_basis: 1,
  first_purchase_date: null,
  sector: "Technology",
  target_weight: null,
  current_price: 1,
  market_value: value,
  unrealized_pl: null,
  unrealized_pl_pct: null,
  weight: null,
  country: "United States",
  currency: "USD",
  ...over,
});

const LIST = [
  holding("HLDN", 600),
  holding("NVKC", 100),
  holding("MRLW", 300, { sector: "Utilities", country: "United Kingdom", currency: "GBP" }),
];

function show(over: { dim?: AllocationDim; selected?: string | null; list?: HoldingSummary[] } = {}) {
  const list = over.list ?? LIST;
  const dim = over.dim ?? "sector";
  const onDim = vi.fn();
  const onSelect = vi.fn();
  render(<AllocationPanel allocation={allocate(list, dim)} dim={dim} onDim={onDim} selected={over.selected ?? null} onSelect={onSelect} positions={largestPositions(list)} />);
  return { onDim, onSelect };
}

describe("AllocationPanel", () => {
  it("names every group with its share and value, and the chart says the same in words", () => {
    show();

    const technology = screen.getByRole("button", { name: /Technology/ });
    expect(technology).toHaveTextContent("70.0%");
    expect(technology).toHaveTextContent("700.00");
    expect(screen.getByRole("button", { name: /Utilities/ })).toHaveTextContent("30.0%");
    expect(screen.getByRole("img", { name: "Allocation by sector: Technology 70.0%, Utilities 30.0%" })).toBeInTheDocument();
  });

  it("switches the grouping with the tabs", () => {
    const { onDim } = show({ dim: "country" });

    expect(screen.getByRole("button", { name: "Country" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /^Allocation by country: United States 70\.0%/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Currency" }));
    expect(onDim).toHaveBeenCalledWith("currency");
  });

  it("selects a group from its legend row and clears it when the same row is pressed again", () => {
    const { onSelect } = show();
    fireEvent.click(screen.getByRole("button", { name: /Utilities/ }));
    expect(onSelect).toHaveBeenLastCalledWith("Utilities");

    onSelect.mockClear();
    const again = show({ selected: "Utilities" });
    fireEvent.click(screen.getAllByRole("button", { name: /Utilities/ })[1]);
    expect(again.onSelect).toHaveBeenCalledWith(null);
    expect(screen.getAllByRole("button", { name: /Utilities/ })[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("lists the largest positions with their share", () => {
    show();

    const top = screen.getByRole("heading", { name: "Largest positions" }).parentElement!;
    const items = within(top).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("HLDN");
    expect(items[0]).toHaveTextContent("60.0%");
    expect(items[1]).toHaveTextContent("MRLW");
  });

  it("says when holdings without a live price are left out, and that amounts are not converted", () => {
    show({ list: [...LIST, holding("NOPRICE", null)] });

    expect(screen.getByText(/1 holding has no live price and isn't in this chart/)).toBeInTheDocument();
    expect(screen.getByText(/mixed currencies are not converted/i)).toBeInTheDocument();
  });

  it("explains an empty chart instead of drawing one", () => {
    show({ list: [holding("NOPRICE", null)] });

    expect(screen.getByText(/nothing to chart/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("uses no green or red for the slices", () => {
    show();

    for (const circle of document.querySelectorAll("circle[stroke]")) {
      expect(circle.getAttribute("stroke")).not.toMatch(/--up|--down/);
    }
  });
});
