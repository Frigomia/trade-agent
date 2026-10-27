import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Bar } from "./Bar";

describe("Bar", () => {
  it("is a named progressbar with a rounded value", () => {
    render(<Bar value={33.4} label="Fundamentals" />);
    const bar = screen.getByRole("progressbar", { name: "Fundamentals" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("shows an empty bar for a value that is not a number", () => {
    render(<Bar value={Number.NaN} label="Score" />);
    expect(screen.getByRole("progressbar", { name: "Score" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps a value outside 0 to 100", () => {
    const { rerender } = render(<Bar value={140} label="Score" />);
    expect(screen.getByRole("progressbar", { name: "Score" })).toHaveAttribute("aria-valuenow", "100");
    rerender(<Bar value={-5} label="Score" />);
    expect(screen.getByRole("progressbar", { name: "Score" })).toHaveAttribute("aria-valuenow", "0");
  });
});
