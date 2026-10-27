import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageMeter } from "./UsageMeter";

describe("UsageMeter", () => {
  it("shows the count and no cue well under the limit", () => {
    render(<UsageMeter usage={{ used: 44, limit: 100 }} />);
    expect(screen.getByText("44 / 100")).toBeInTheDocument();
    expect(screen.queryByText(/limit/i)).not.toBeInTheDocument();
  });

  it("says Near limit above 90% and At limit at the limit, so the amber is never the only cue", () => {
    const { rerender } = render(<UsageMeter usage={{ used: 90, limit: 100 }} />);
    expect(screen.queryByText(/limit/i)).not.toBeInTheDocument(); // exactly 90% is not yet "near"
    rerender(<UsageMeter usage={{ used: 91, limit: 100 }} />);
    expect(screen.getByText("Near limit")).toBeInTheDocument();
    rerender(<UsageMeter usage={{ used: 100, limit: 100 }} />);
    expect(screen.getByText("At limit")).toBeInTheDocument();
    expect(screen.getByText("100 / 100")).toBeInTheDocument();
  });

  it("is a plain 0 / 0 when Chat is turned off", () => {
    render(<UsageMeter usage={{ used: 0, limit: 0 }} />);
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
    expect(screen.queryByText(/limit/i)).not.toBeInTheDocument();
  });
});
