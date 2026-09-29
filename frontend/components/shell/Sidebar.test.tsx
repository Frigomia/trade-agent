import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("does not show the Admin item for a non-admin role", () => {
    render(<Sidebar role="user" />);
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin item for an admin role", () => {
    render(<Sidebar role="admin" />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("always shows the non-admin sections", () => {
    render(<Sidebar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
  });
});
