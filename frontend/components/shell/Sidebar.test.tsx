import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
  });
});
