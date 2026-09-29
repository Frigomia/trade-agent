import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders the four phone tabs regardless of role", () => {
    render(<TabBar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /more/i })).toBeInTheDocument();
  });

  it("does not show the Admin tab for a non-admin role", () => {
    render(<TabBar role="user" />);
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin tab for an admin role", () => {
    render(<TabBar role="admin" />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });
});
