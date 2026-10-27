import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EdgePill } from "./EdgePill";

describe("EdgePill", () => {
  it("shows an arrow beside the words for a result ahead or behind", () => {
    const { rerender } = render(<EdgePill fraction={0.048}>Ahead of buy-and-hold by +4.8%</EdgePill>);
    expect(screen.getByText("Ahead of buy-and-hold by +4.8%").querySelector("svg")).not.toBeNull();
    rerender(<EdgePill fraction={-0.041}>Behind buy-and-hold by −4.1%</EdgePill>);
    expect(screen.getByText("Behind buy-and-hold by −4.1%").querySelector("svg")).not.toBeNull();
  });

  it("is quiet, with no arrow, for a value that is not a number", () => {
    render(<EdgePill fraction={Number.NaN}>Level with buy-and-hold</EdgePill>);
    expect(screen.getByText("Level with buy-and-hold").querySelector("svg")).toBeNull();
  });

  it("is quiet, with no arrow, when level with buy-and-hold", () => {
    render(<EdgePill fraction={0.0002}>Level with buy-and-hold</EdgePill>);
    expect(screen.getByText("Level with buy-and-hold").querySelector("svg")).toBeNull();
  });
});
