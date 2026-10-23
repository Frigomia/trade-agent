import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SegmentedControl, type Segment } from "./SegmentedControl";

const filters: Segment[] = [
  { key: "all", label: "All", count: 7 },
  { key: "analyzed", label: "AI analyzed", count: 3 },
];

describe("SegmentedControl", () => {
  it("makes buttons in a named group, with the chosen one aria-pressed", () => {
    render(<SegmentedControl label="Show" segments={filters} value="analyzed" />);

    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getByRole("button", { name: "AI analyzed 3" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "All 7" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the key of the clicked button", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Show" segments={filters} value="all" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "AI analyzed 3" }));
    expect(onChange).toHaveBeenCalledWith("analyzed");
  });

  it("makes links in a nav when a segment has an href, the current one aria-current", () => {
    const views: Segment[] = [
      { key: "a", label: "Holdings", href: "/portfolio" },
      { key: "b", label: "This month", short: "Plan", href: "/portfolio/plan" },
    ];
    render(<SegmentedControl label="Views" segments={views} value="b" />);

    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("link", { name: "Holdings" })).toHaveAttribute("href", "/portfolio");
    expect(within(nav).getByRole("link", { name: "Holdings" })).not.toHaveAttribute("aria-current");
    // Both label variants are in the DOM; a browser hides one with display: none.
    expect(within(nav).getByRole("link", { name: "This monthPlan" })).toHaveAttribute("aria-current", "page");
  });

  it("hides an alert chip and names the segment with its aria-label", () => {
    const views: Segment[] = [{ key: "o", label: "Orders", count: 3, alert: true, ariaLabel: "Orders, 3 open orders", href: "/o" }];
    render(<SegmentedControl label="Views" segments={views} value="x" />);

    expect(within(screen.getByRole("link", { name: "Orders, 3 open orders" })).getByText("3")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps an alert chip readable when the segment has no aria-label of its own", () => {
    render(<SegmentedControl label="Views" segments={[{ key: "i", label: "Inbox", count: 5, alert: true, href: "/i" }]} value="x" />);

    expect(screen.getByRole("link", { name: "Inbox 5" })).toBeInTheDocument();
  });

  it("raises the chosen segment on the panel colour", () => {
    render(<SegmentedControl label="Show" segments={filters} value="all" />);

    expect(screen.getByRole("button", { name: "All 7" })).toHaveStyle({ backgroundColor: "var(--panel)", fontWeight: "650" });
    expect(screen.getByRole("button", { name: "AI analyzed 3" })).toHaveStyle({ fontWeight: "500" });
  });
});
