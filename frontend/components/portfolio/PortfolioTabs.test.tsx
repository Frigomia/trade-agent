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
    expect(within(nav).getByRole("link", { name: /^This month/ })).toHaveAttribute("href", "/portfolio/plan");
    expect(within(nav).getByRole("link", { name: /^Saved plans/ })).toHaveAttribute("href", "/portfolio/plan?tab=saved");
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
      if (link.textContent?.startsWith(label)) expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
    }
  });

  // jsdom applies no media queries, so both variants count here; in a browser the display: none one
  // drops out and the name is the visible text (label in name, WCAG 2.5.3). Not testable in jsdom.
  it("carries both label variants with no aria-label overriding the visible text", () => {
    renderTabs();
    const month = screen.getByRole("link", { name: "This monthPlan" });
    expect(month).not.toHaveAttribute("aria-label");
    expect(within(month).getByText("Plan")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("link", { name: "Saved plansSaved" })).not.toHaveAttribute("aria-label");
  });

  it("shows no badge at 0, while loading, or on error", async () => {
    renderTabs();
    expect(screen.getByRole("link", { name: "Orders" })).toHaveTextContent(/^Orders$/);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Orders" })).toHaveTextContent(/^Orders$/);
  });

  it("shows no badge when the read fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderTabs();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Orders" })).toHaveTextContent(/^Orders$/);
  });

  it("shows the open count as a hidden badge and puts it in the Orders link's name", async () => {
    open(3);
    renderTabs();
    const link = await screen.findByRole("link", { name: "Orders, 3 open orders" });
    expect(link).toHaveAttribute("href", "/portfolio/plan?tab=orders");
    const badge = within(link).getByText("3");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).not.toHaveAttribute("role");
  });

  it("says order, singular, for one", async () => {
    open(1);
    renderTabs();
    expect(await screen.findByRole("link", { name: "Orders, 1 open order" })).toBeInTheDocument();
  });

  it("caps the badge at 99+", async () => {
    open(100);
    renderTabs();
    expect(await screen.findByRole("link", { name: "Orders, 100 open orders" })).toHaveTextContent("Orders99+");
  });

  it("shows 99 as is", async () => {
    open(99);
    renderTabs();
    expect(await screen.findByRole("link", { name: "Orders, 99 open orders" })).toHaveTextContent("Orders99");
  });
});
