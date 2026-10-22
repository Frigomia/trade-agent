import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DiscoverItem } from "@/lib/api/discover-types";
import { DiscoverCard } from "./DiscoverCard";

const NOW = Date.parse("2026-10-22T09:00:00Z");

const item = (over: Partial<DiscoverItem> = {}): DiscoverItem => ({
  ticker: "HLDN",
  asset_type: "STOCK",
  name: "Halden Systems",
  exchange: "NASDAQ",
  currency: "USD",
  source: "today",
  added_at: "2026-10-20T08:00:00",
  note: null,
  target_weight: null,
  target_price_low: null,
  target_price_high: null,
  price: 184.2,
  change_pct: 2.1,
  price_as_of: "2026-10-21",
  stale: false,
  status: "analyzed",
  insight: "Recurring software revenue and widening margins.",
  report_id: 42,
  owned: false,
  ...over,
});

const show = (over: Partial<DiscoverItem> = {}) => {
  const onRemove = vi.fn();
  const onEdit = vi.fn();
  render(
    <ul>
      <DiscoverCard item={item(over)} now={NOW} onRemove={onRemove} onEdit={onEdit} />
    </ul>,
  );
  return { onRemove, onEdit };
};

describe("DiscoverCard", () => {
  it("shows an analyzed company: name opening its report, status in words, the reading, price and change", () => {
    show();

    const card = screen.getByRole("listitem");
    expect(screen.getByRole("link", { name: "Open the investment report for Halden Systems" })).toHaveAttribute("href", "/today/42");
    expect(card).toHaveTextContent("AI analyzed");
    expect(card).toHaveTextContent("Recurring software revenue and widening margins.");
    expect(card).toHaveTextContent("HLDN · NASDAQ · USD");
    expect(card).toHaveTextContent("USD 184.20");
    expect(card).toHaveTextContent("+2.1%");
    expect(card).toHaveTextContent("As of 2026-10-21");
    expect(card).toHaveTextContent("Added 2 days ago · saved from Today");
    expect(screen.getByRole("link", { name: "View the report for Halden Systems" })).toHaveAttribute("href", "/today/42");
  });

  it("shows a company no scan has researched without a report link, a reading or a View button", () => {
    show({ status: "none", insight: null, report_id: null });

    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("Not analyzed");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recurring software/)).not.toBeInTheDocument();
  });

  it("renders the reading as plain text, never as markup", () => {
    show({ insight: "<b>Bold</b> <img src=x onerror=alert(1)>" });

    expect(screen.getByText("<b>Bold</b> <img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says a price is unavailable, and how to proceed, instead of a made-up zero", () => {
    show({ price: null, change_pct: null, price_as_of: null, stale: true });

    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("Price unavailable");
    expect(card).toHaveTextContent("We could not get a quote. Try again later.");
    expect(card).not.toHaveTextContent("0.00");
  });

  it("flags a stale quote with its date", () => {
    show({ stale: true });

    expect(screen.getByText("Stale quote · 2026-10-21")).toBeInTheDocument();
  });

  it("shows a price with no change when only one close exists", () => {
    show({ change_pct: null });

    expect(screen.getByRole("listitem")).toHaveTextContent("USD 184.20");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("falls back to the ticker for a company with no name yet, and to Added earlier with no date", () => {
    show({ name: null, exchange: null, currency: null, added_at: null, source: "manual" });

    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent("HLDN");
    expect(card).toHaveTextContent("Added earlier · by you");
    expect(screen.getByRole("link", { name: "Open the investment report for HLDN" })).toBeInTheDocument();
  });

  it("removes from the list only, named for the company", () => {
    const { onRemove } = show();

    fireEvent.click(screen.getByRole("button", { name: "Remove Halden Systems from Discover" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("says the status in words, with a shape, not by colour alone", () => {
    show({ status: "none", insight: null, report_id: null });

    expect(screen.getByText("Not analyzed").parentElement!.querySelector("svg")).not.toBeNull();
  });

  it("colours only the price move: a fall is red and the status pill is not", () => {
    show({ change_pct: -1.4 });

    expect(screen.getByText("-1.4%")).toHaveStyle({ color: "var(--down)" });
    expect(screen.getByText("AI analyzed")).not.toHaveStyle({ color: "var(--down)" });
    expect(screen.getByText("AI analyzed")).not.toHaveStyle({ color: "var(--up)" });
  });
});

describe("DiscoverCard targets", () => {
  it("says the saved weight target and price range in words, in the card's currency", () => {
    show({ target_weight: 0.05, target_price_low: 90, target_price_high: 110.5 });

    expect(screen.getByRole("listitem")).toHaveTextContent("Target 5% · Range USD 90.00 to 110.50");
  });

  it("shows nothing about targets when none is set, and leaves the weight out for an owned company", () => {
    const { unmount } = render(<ul><DiscoverCard item={item()} now={NOW} onRemove={vi.fn()} onEdit={vi.fn()} /></ul>);
    expect(screen.getByRole("listitem")).not.toHaveTextContent(/Target|Range/);
    unmount();

    show({ owned: true, target_weight: 0.3, target_price_low: 90, target_price_high: 110 });
    expect(screen.getByRole("listitem")).toHaveTextContent("Range USD 90.00 to 110.00");
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Target");
  });

  it("opens the editor from an Edit button named for the company", () => {
    const { onEdit } = show();

    fireEvent.click(screen.getByRole("button", { name: "Edit target for Halden Systems" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
