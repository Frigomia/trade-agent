import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { PortfolioTabs, type PortfolioView } from "./PortfolioTabs";

function renderTabs(current: PortfolioView = "holdings") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioTabs current={current} />
    </SWRConfig>,
  );
}

const open = (n: number) => apiFetch.mockResolvedValue({ open_lines: n, plans: [] });

describe("PortfolioTabs", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    open(0);
  });

  it("links the four views of Portfolio", () => {
    renderTabs();
    const nav = screen.getByRole("navigation", { name: "Portfolio views" });
    expect(within(nav).getByRole("link", { name: "Holdings" })).toHaveAttribute("href", "/portfolio");
    expect(within(nav).getByRole("link", { name: "This month" })).toHaveAttribute("href", "/portfolio/plan");
    expect(within(nav).getByRole("link", { name: "Saved plans" })).toHaveAttribute("href", "/portfolio/plan?tab=saved");
    expect(within(nav).getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/portfolio/plan?tab=orders");
  });

  it.each([
    ["holdings", "Holdings"],
    ["month", "This month"],
    ["saved", "Saved plans"],
    ["orders", "Orders"],
  ] as const)("marks %s as the current view, and only it", (view, label) => {
    renderTabs(view);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      if (link.getAttribute("aria-label") === label || link.textContent === label) expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("carries both label variants and keeps the full accessible name", () => {
    renderTabs();
    const month = screen.getByRole("link", { name: "This month" });
    expect(month).toHaveTextContent("This monthPlan");
    expect(screen.getByRole("link", { name: "Saved plans" })).toHaveTextContent("Saved plansSaved");
  });

  it("shows no badge at 0, while loading, or on error", async () => {
    renderTabs();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows no badge when the read fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderTabs();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
  });

  it("shows the open count as a named badge inside the Orders link", async () => {
    open(3);
    renderTabs();
    const badge = await screen.findByRole("img", { name: "3 open orders" });
    expect(badge).toHaveTextContent("3");
    const link = screen.getByRole("link", { name: /Orders.*3 open orders/ });
    expect(link).toContainElement(badge);
    expect(link).toHaveAttribute("href", "/portfolio/plan?tab=orders");
  });

  it("caps the badge at 99+", async () => {
    open(100);
    renderTabs();
    expect(await screen.findByRole("img", { name: "100 open orders" })).toHaveTextContent("99+");
  });

  it("shows 99 as is", async () => {
    open(99);
    renderTabs();
    expect(await screen.findByRole("img", { name: "99 open orders" })).toHaveTextContent("99");
  });
});
