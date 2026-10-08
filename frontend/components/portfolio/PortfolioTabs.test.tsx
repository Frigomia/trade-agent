import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PortfolioTabs } from "./PortfolioTabs";

describe("PortfolioTabs", () => {
  it("links the three views of Portfolio", () => {
    render(<PortfolioTabs current="holdings" />);
    const nav = screen.getByRole("navigation", { name: "Portfolio views" });
    expect(within(nav).getByRole("link", { name: "Holdings" })).toHaveAttribute("href", "/portfolio");
    expect(within(nav).getByRole("link", { name: "This month" })).toHaveAttribute("href", "/portfolio/plan");
    expect(within(nav).getByRole("link", { name: "Saved plans" })).toHaveAttribute("href", "/portfolio/plan?tab=saved");
  });

  it.each([
    ["holdings", "Holdings"],
    ["month", "This month"],
    ["saved", "Saved plans"],
  ] as const)("marks %s as the current view, and only it", (view, label) => {
    render(<PortfolioTabs current={view} />);
    for (const link of screen.getAllByRole("link")) {
      if (link.textContent === label) expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
