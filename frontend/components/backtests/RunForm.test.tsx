import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunForm } from "./RunForm";

function setup(props: Partial<React.ComponentProps<typeof RunForm>> = {}) {
  const onRun = vi.fn();
  render(<RunForm onRun={onRun} running={false} error={null} {...props} />);
  return onRun;
}

describe("RunForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the last three years", () => {
    setup();
    expect(screen.getByLabelText("From")).toHaveValue("2023-09-30");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
  });

  it("sends the ticker uppercased and trimmed with both dates", () => {
    const onRun = setup();
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: " aapl " } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(onRun).toHaveBeenCalledWith({ ticker: "AAPL", start: "2023-09-30", end: "2026-09-30" });
  });

  it("blocks a bad ticker, a reversed range and an over-long range without calling onRun", () => {
    const onRun = setup();
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/enter a ticker/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/must not be after/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1990-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/at most 30 years/i)).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("shows the local validation message over a server error", () => {
    setup({ error: "Server said no" });
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));
    expect(screen.getByText(/enter a ticker/i)).toBeInTheDocument();
    expect(screen.queryByText("Server said no")).not.toBeInTheDocument();
  });

  it("shows a server error and disables the button while running", () => {
    setup({ error: "Something went wrong.", running: true });
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run backtest" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/running the backtest/i);
  });
});

describe("RunForm ticker suggestions", () => {
  const OWNED = [
    { symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF" as const, exchange: "" },
    { symbol: "AAPL", name: "Apple Inc.", type: "STOCK" as const, exchange: "" },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the user's own holdings when the ticker field is opened, and runs the one picked", () => {
    const onRun = setup({ suggestions: OWNED });

    const field = screen.getByLabelText("Ticker");
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByText(/in your portfolio/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("VWCE.DE"));
    fireEvent.click(screen.getByRole("button", { name: "Run backtest" }));

    expect(onRun).toHaveBeenCalledWith({ ticker: "VWCE.DE", start: "2023-09-30", end: "2026-09-30" });
  });
});
