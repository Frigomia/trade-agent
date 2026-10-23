import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { HoldingSummary } from "@/lib/api/portfolio-types";
import { ClosedPositions } from "./ClosedPositions";

const OLD: HoldingSummary = {
  ticker: "OLD",
  name: "Sold Out Co",
  asset_type: "STOCK",
  shares: 0,
  cost_basis: 10,
  first_purchase_date: "2024-01-01",
  sector: null,
  target_weight: null,
  current_price: null,
  market_value: null,
  unrealized_pl: null,
  unrealized_pl_pct: null,
  weight: null,
};

describe("ClosedPositions", () => {
  it("renders nothing when no position is closed", () => {
    const { container } = render(<ClosedPositions holdings={[]} onLogTrade={vi.fn()} onRemove={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("is a disclosure that starts closed and counts the closed positions", () => {
    render(<ClosedPositions holdings={[OLD, { ...OLD, ticker: "ZZZ", name: "Other Co" }]} onLogTrade={vi.fn()} onRemove={vi.fn()} />);

    const section = screen.getByRole("region", { name: "Closed positions" });
    expect(section.querySelector("details")).not.toHaveAttribute("open");
    expect(within(section).getByText("Closed positions")).toBeInTheDocument();
    expect(within(section).getByText("(2)")).toBeInTheDocument();
  });

  it("names each closed position and hands it to Log a trade and Remove", () => {
    const onLogTrade = vi.fn();
    const onRemove = vi.fn();
    render(<ClosedPositions holdings={[OLD]} onLogTrade={onLogTrade} onRemove={onRemove} />);

    expect(screen.getByText("Sold Out Co · Closed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log a trade for OLD" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove OLD" }));

    // jsdom shows the contents of a closed <details>, so say where the buttons live: inside the disclosure.
    expect(screen.getByRole("button", { name: "Log a trade for OLD" }).closest("details")).not.toHaveAttribute("open");
    expect(onLogTrade).toHaveBeenCalledWith(OLD);
    expect(onRemove).toHaveBeenCalledWith(OLD);
  });
});
