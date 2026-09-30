import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageSummary } from "./UsageSummary";

const NOW = new Date("2026-12-15T10:00:00Z");

describe("UsageSummary", () => {
  it("shows used over limit and the reset date", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 3, limit: 10 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText("0 / 50")).toBeInTheDocument();
    expect(screen.getByText(/resets on 2027-01-01/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a word, not only colour, above 90 percent", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 10, limit: 11 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText(/near limit/i)).toBeInTheDocument();
  });

  it("shows a warning banner at the limit and clamps an exceeded bar", () => {
    render(<UsageSummary now={NOW} usage={{ analysis_runs: { used: 12, limit: 10 }, chat_messages: { used: 0, limit: 50 } }} />);
    expect(screen.getByText(/at limit/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/resets on 2027-01-01.*ask your administrator/i);
    expect(screen.getByRole("progressbar", { name: /analysis runs/i })).toHaveAttribute("aria-valuenow", "100");
  });
});
