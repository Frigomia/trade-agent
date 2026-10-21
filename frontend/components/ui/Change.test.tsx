import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Change } from "./Change";

describe("Change", () => {
  it("shows a rise with a plus sign and the up colour", () => {
    render(<Change pct={2.1} />);
    expect(screen.getByText("+2.1%")).toHaveStyle({ color: "var(--up)" });
  });

  it("shows a fall with a minus sign and the down colour", () => {
    render(<Change pct={-0.8} />);
    expect(screen.getByText("-0.8%")).toHaveStyle({ color: "var(--down)" });
  });
});

describe("Change at the edges", () => {
  it("shows a move that rounds to zero as flat and neutral, not as a fall", () => {
    render(<Change pct={-0.04} />);
    expect(screen.getByText("+0.0%")).toHaveStyle({ color: "var(--muted)" });
  });
});
