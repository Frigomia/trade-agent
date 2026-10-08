import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/today";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("does not show the admin items for a non-admin role", () => {
    render(<Sidebar role="user" />);
    expect(screen.queryByRole("link", { name: /users|usage/i })).not.toBeInTheDocument();
  });

  it("shows the admin items for an admin role", () => {
    render(<Sidebar role="admin" />);
    expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /usage/i })).toBeInTheDocument();
  });

  it("always shows the non-admin sections", () => {
    render(<Sidebar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portfolio" })).toBeInTheDocument();
  });

  it("puts Plan under Portfolio, linking to the plan views", () => {
    render(<Sidebar role="user" />);
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links.indexOf("Plan")).toBe(links.indexOf("Portfolio") + 1);
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/portfolio/plan");
  });

  it("lights Portfolio on the holdings and Plan on the plan views, never both", () => {
    pathname = "/portfolio";
    const { unmount } = render(<Sidebar role="user" />);
    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
    unmount();

    pathname = "/portfolio/plan";
    render(<Sidebar role="user" />);
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Portfolio" })).not.toHaveAttribute("aria-current");
    pathname = "/today";
  });
});
