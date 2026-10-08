import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { SymbolMatch } from "@/lib/tickerSearch";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { TickerPicker } from "./TickerPicker";

const VWCE: SymbolMatch = { symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF", exchange: "XETRA" };
const AAPL: SymbolMatch = { symbol: "AAPL", name: "Apple Inc.", type: "STOCK", exchange: "NASDAQ" };
const OWNED: SymbolMatch = { symbol: "MSFT", name: "Microsoft", type: "STOCK", exchange: "" };

function Harness({
  suggestions,
  onPick = () => {},
  initial = "",
}: {
  suggestions?: SymbolMatch[];
  onPick?: (match: SymbolMatch) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TickerPicker label="Ticker" value={value} onChange={setValue} onPick={onPick} suggestions={suggestions} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const box = () => screen.getByRole("combobox", { name: "Ticker" });

async function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe("TickerPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue([VWCE, AAPL]);
  });
  afterEach(() => vi.useRealTimers());

  it("searches after two characters and a short pause, and lists the matches", async () => {
    render(<Harness />);

    await type("v");
    expect(apiFetch).not.toHaveBeenCalled();
    await type("vw");

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/market/search?q=vw");
    expect(await screen.findByText("VWCE.DE")).toBeInTheDocument();
    expect(screen.getByText(/Vanguard FTSE All-World/)).toBeInTheDocument();
    expect(screen.getByText(/XETRA/)).toBeInTheDocument();
  });

  it("waits out fast typing and searches once for the final text", async () => {
    render(<Harness />);

    fireEvent.change(box(), { target: { value: "vw" } });
    fireEvent.change(box(), { target: { value: "vwc" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/market/search?q=vwc");
  });

  it("puts the symbol in the field and reports the pick when a result is chosen", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await type("vwce");

    fireEvent.click(await screen.findByText("VWCE.DE"));

    expect(screen.getByTestId("value")).toHaveTextContent("VWCE.DE");
    expect(onPick).toHaveBeenCalledWith(VWCE);
  });

  it("does not search again for the symbol it just filled in", async () => {
    render(<Harness />);
    await type("vwce");
    fireEvent.click(await screen.findByText("VWCE.DE"));
    apiFetch.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps whatever is typed, so a ticker can still be entered without picking", async () => {
    apiFetch.mockResolvedValue([]);
    render(<Harness />);

    await type("brk-b");

    expect(screen.getByTestId("value")).toHaveTextContent("brk-b");
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });

  it("shows no list, and does not crash, when the search fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    render(<Harness />);

    await type("apple");

    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("apple");
  });

  it("offers the user's own holdings first when the field is opened empty", () => {
    render(<Harness suggestions={[OWNED]} />);

    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: "ArrowDown" });

    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.getByText(/in your portfolio/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("filters the user's own holdings by what is typed, above the search results", async () => {
    render(<Harness suggestions={[OWNED, { ...AAPL, symbol: "AMZN", name: "Amazon" }]} />);

    await type("mic");

    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options[0]).toContain("MSFT");
    expect(screen.queryByText("AMZN")).not.toBeInTheDocument();
  });

  it("does not list a search result twice when it is also in the portfolio", async () => {
    apiFetch.mockResolvedValue([AAPL]);
    render(<Harness suggestions={[AAPL]} />);

    await type("aapl");

    expect(screen.getAllByText("AAPL")).toHaveLength(1);
  });

  it("ignores a slow answer for text that has since changed", async () => {
    let resolveFirst: (value: SymbolMatch[]) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    apiFetch.mockResolvedValueOnce([AAPL]);
    render(<Harness />);

    await type("vw");
    await type("aapl");
    await act(async () => resolveFirst([VWCE]));

    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("VWCE.DE")).not.toBeInTheDocument();
  });

  describe("ISIN search", () => {
    it("passes the typed ISIN, upper-cased, with the pick", async () => {
      const onPick = vi.fn();
      render(<Harness onPick={onPick} />);
      await type("ie00bkm4gz66");

      fireEvent.click(await screen.findByText("VWCE.DE"));

      expect(onPick).toHaveBeenCalledWith({ ...VWCE, isin: "IE00BKM4GZ66" });
    });

    it("passes no isin for a name or ticker query", async () => {
      const onPick = vi.fn();
      render(<Harness onPick={onPick} />);
      await type("vwce");

      fireEvent.click(await screen.findByText("VWCE.DE"));

      expect(onPick).toHaveBeenCalledWith(VWCE);
      expect(onPick.mock.calls[0][0]).not.toHaveProperty("isin");
    });

    it("says the ISIN will be saved, only for an ISIN query with results", async () => {
      render(<Harness />);
      await type("vwce");
      expect(screen.queryByText(/will be saved with this ticker/i)).not.toBeInTheDocument();

      await type("IE00BKM4GZ66");
      expect(screen.getByText("ISIN IE00BKM4GZ66 will be saved with this ticker.")).toBeInTheDocument();
    });

    it("shows no such line when the ISIN finds nothing", async () => {
      apiFetch.mockResolvedValue([]);
      render(<Harness />);

      await type("IE00BKM4GZ66");

      expect(screen.queryByText(/will be saved with this ticker/i)).not.toBeInTheDocument();
      expect(screen.getByText(/no match/i)).toBeInTheDocument();
    });
  });
});
