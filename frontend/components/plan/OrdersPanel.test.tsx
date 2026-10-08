import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Plan, PlanLine } from "@/lib/plans";

const { setIsin, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  }
  return { setIsin: vi.fn(), FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(), ApiError: FakeApiError }));
vi.mock("@/lib/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/orders")>()), setIsin }));

import { copyAllText, ticketText } from "@/lib/orders";
import { OrdersPanel } from "./OrdersPanel";

const line = (o: Partial<PlanLine>): PlanLine => ({
  id: 1,
  isin: "IE00BKM4GZ66",
  placed_at: null,
  placed_trade_id: null,
  ticker: "EIMI.L",
  name: "iShares Core MSCI EM IMI UCITS ETF USD (Acc)",
  amount_eur: 92.3,
  shares: 1.69,
  price_eur: 54.64,
  currency: "USD",
  rate: 0.92,
  weight_before: 0.179,
  weight_after: 0.184,
  reason: "underweight",
  reason_text: "Below its target weight",
  ...o,
});
const LINES = [
  line({}),
  line({ id: 2, ticker: "IWDA.L", name: "iShares Core MSCI World", isin: "IE00B4L5Y983", amount_eur: 407.7, shares: 2.772, price_eur: 147.07 }),
  line({ id: 3, ticker: "NVDA", name: "NVIDIA <b>Corp</b>", isin: null, amount_eur: 100, shares: 0.86, price_eur: 116.31, reason_text: "A new position that starts at 0 %" }),
];
const plan = (lines: PlanLine[] = LINES, o: Partial<Plan> = {}): Plan => ({
  id: 9,
  created_at: "2026-10-08T09:14:00",
  amount_eur: 600,
  whole_shares: false,
  total_before_eur: 7710,
  leftover_eur: 0,
  lines,
  notes: ["MSFT is left out: no price available."],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
  ...o,
});
const placedAll = () => plan(LINES.map((l) => ({ ...l, placed_at: "2026-10-08T10:00:00" })));

const writeText = vi.fn();
const onChanged = vi.fn();

function renderPanel(p: Plan = plan(), extra: Partial<Parameters<typeof OrdersPanel>[0]> = {}) {
  return render(<OrdersPanel plan={p} onChanged={onChanged} {...extra} />);
}
const card = (ticker: string) => screen.getByRole("button", { name: new RegExp(`^${ticker.replace(".", "\\.")}, `) });
const openCard = (ticker: string) => fireEvent.click(card(ticker));

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  onChanged.mockReset().mockResolvedValue(undefined);
  setIsin.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("OrdersPanel", () => {
  it("counts the placed lines with one dash each", () => {
    const p = plan([LINES[0], { ...LINES[1], placed_at: "2026-10-08T10:00:00" }, LINES[2]]);
    renderPanel(p);
    expect(screen.getByText("1 of 3 placed")).toBeInTheDocument();
    const dashes = screen.getByTestId("progress").querySelectorAll("i");
    expect([...dashes].map((d) => d.dataset.placed)).toEqual(["false", "true", "false"]);
    expect(screen.getByText("Orders")).toBeInTheDocument();
  });

  it("copies only the unplaced tickets with Copy all lines", async () => {
    const p = plan([LINES[0], { ...LINES[1], placed_at: "2026-10-08T10:00:00" }, LINES[2]]);
    renderPanel(p);
    fireEvent.click(screen.getByRole("button", { name: "Copy all lines" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(copyAllText(p)));
    expect(writeText.mock.calls[0][0]).not.toContain("IWDA");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("disables Copy all lines when every line is placed", () => {
    renderPanel(placedAll());
    expect(screen.getByText("All lines placed")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy all lines" })).toBeDisabled();
  });

  it("shows closed cards as the ledger row with no Copy or Placed buttons", () => {
    renderPanel(plan(), { onPlace: vi.fn() });
    const c = card("EIMI.L");
    expect(c).toHaveAccessibleName("EIMI.L, 92.30 EUR, not placed, press to open");
    expect(c).toHaveAttribute("aria-expanded", "false");
    expect(c).toHaveTextContent("about 1.69 sh");
    expect(c).toHaveTextContent("Below its target weight");
    expect(c).toHaveTextContent("Weight 17.9% to 18.4%");
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Placed" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ticket, the text Copy copies/)).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Leftover 0.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("600.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("MSFT is left out: no price available.")).toBeInTheDocument();
    expect(screen.getByText("Tap a line to open its order.")).toBeInTheDocument();
  });

  it("opens a card to show Copy, Placed, the ticket and the ISIN, and closes it again", () => {
    renderPanel(plan(), { onPlace: vi.fn() });
    openCard("EIMI.L");
    const c = card("EIMI.L");
    expect(c).toHaveAttribute("aria-expanded", "true");
    expect(c).toHaveAccessibleName("EIMI.L, 92.30 EUR, not placed, press to close");
    const region = document.getElementById(c.getAttribute("aria-controls")!)!;
    expect(within(region).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Placed" })).toBeInTheDocument();
    expect(within(region).getByText("Ticket, the text Copy copies")).toBeInTheDocument();
    expect(within(region).getByText(ticketText(LINES[0], false))).toBeInTheDocument();
    expect(within(region).getByText("IE00BKM4GZ66")).toBeInTheDocument();
    openCard("EIMI.L");
    expect(card("EIMI.L")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("shows the ticket without an ISIN and offers Add ISIN", () => {
    renderPanel();
    openCard("NVDA");
    expect(screen.getByText("Order (amount): 100.00 EUR · NVIDIA <b>Corp</b> · about 0.86 shares at 116.31 EUR")).toBeInTheDocument();
    expect(screen.getByText("None saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add ISIN" })).toBeInTheDocument();
    // The name is text, never markup.
    expect(document.querySelector("b")?.textContent).not.toBe("Corp");
  });

  it("copies the exact ticket, shows Copied for a moment and announces it", async () => {
    vi.useFakeTimers();
    renderPanel();
    openCard("EIMI.L");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith(ticketText(LINES[0], false));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Copied the EIMI.L ticket");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("uses whole shares in the ticket of a whole-shares plan", async () => {
    const p = plan([line({ shares: 3 })], { whole_shares: true });
    renderPanel(p);
    expect(card("EIMI.L")).toHaveTextContent("3 sh");
    openCard("EIMI.L");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("· 3 shares at 54.64 EUR")));
  });

  it("shows a readable message when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderPanel();
    openCard("EIMI.L");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Could not copy. Select the ticket text and copy it by hand.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy all lines" }));
    expect(await screen.findByText("Could not copy. Open each line and copy its ticket by hand.")).toBeInTheDocument();
  });

  it("shows a readable message when there is no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderPanel();
    openCard("EIMI.L");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  describe("Add ISIN", () => {
    beforeEach(() => {
      renderPanel();
      openCard("NVDA");
      fireEvent.click(screen.getByRole("button", { name: "Add ISIN" }));
    });

    it("checks the shape before saving", () => {
      fireEvent.change(screen.getByLabelText("ISIN for NVDA"), { target: { value: "US67066G104" } });
      expect(screen.getByText("11 of 12")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save ISIN" }));
      expect(screen.getByText(/An ISIN is 12 characters/)).toBeInTheDocument();
      expect(setIsin).not.toHaveBeenCalled();
    });

    it("shows the server's 422 for a wrong check digit", async () => {
      setIsin.mockRejectedValue(new FakeApiError(422, "Value error, Not a valid ISIN: 12 characters with a correct check digit."));
      fireEvent.change(screen.getByLabelText("ISIN for NVDA"), { target: { value: "US67066G1041" } });
      fireEvent.click(screen.getByRole("button", { name: "Save ISIN" }));
      expect(await screen.findByText("Not a valid ISIN: 12 characters with a correct check digit.")).toBeInTheDocument();
      expect(setIsin).toHaveBeenCalledWith("NVDA", "US67066G1041");
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("saves the normalised ISIN and asks the parent to reload", async () => {
      setIsin.mockResolvedValue({ ticker: "NVDA", isin: "US67066G1040" });
      fireEvent.change(screen.getByLabelText("ISIN for NVDA"), { target: { value: " us67066g1040 " } });
      fireEvent.click(screen.getByRole("button", { name: "Save ISIN" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(setIsin).toHaveBeenCalledWith("NVDA", "US67066G1040");
      await waitFor(() => expect(screen.queryByLabelText("ISIN for NVDA")).not.toBeInTheDocument());
    });

    it("can be cancelled", () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Add ISIN" })).toBeInTheDocument();
    });
  });

  it("shows a placed line with its date and no buttons, and still opens it to read the ticket", () => {
    const p = plan([{ ...LINES[0], placed_at: "2026-10-08T10:00:00" }, LINES[1]]);
    renderPanel(p, { onPlace: vi.fn() });
    const c = card("EIMI.L");
    expect(c).toHaveAccessibleName("EIMI.L, 92.30 EUR, placed 8 Oct, press to open");
    expect(c).toHaveTextContent("Placed 8 Oct");
    expect(c).not.toHaveTextContent("Weight");
    expect(within(c).getByTestId("mark-placed")).toBeInTheDocument();
    expect(within(card("IWDA.L")).getByTestId("mark-open")).toBeInTheDocument();
    openCard("EIMI.L");
    expect(screen.getByText(ticketText(LINES[0], false))).toBeInTheDocument();
    expect(screen.getByText("IE00BKM4GZ66")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Placed" })).not.toBeInTheDocument();
  });

  it("offers Placed only for a stored line, and hands the line to onPlace", () => {
    const onPlace = vi.fn();
    renderPanel(plan([LINES[0], { ...LINES[1], id: null }]), { onPlace });
    openCard("IWDA.L");
    expect(screen.queryByRole("button", { name: "Placed" })).not.toBeInTheDocument();
    openCard("EIMI.L");
    fireEvent.click(screen.getByRole("button", { name: "Placed" }));
    expect(onPlace).toHaveBeenCalledWith(LINES[0]);
  });

  it("keeps one line open at a time and can be controlled from outside", () => {
    const onOpenTickerChange = vi.fn();
    const { rerender } = renderPanel(plan(), { openTicker: "IWDA.L", onOpenTickerChange });
    expect(card("IWDA.L")).toHaveAttribute("aria-expanded", "true");
    expect(card("EIMI.L")).toHaveAttribute("aria-expanded", "false");
    openCard("EIMI.L");
    expect(onOpenTickerChange).toHaveBeenCalledWith("EIMI.L");
    rerender(<OrdersPanel plan={plan()} onChanged={onChanged} openTicker="NVDA" onOpenTickerChange={onOpenTickerChange} />);
    expect(card("NVDA")).toHaveAttribute("aria-expanded", "true");
    expect(card("IWDA.L")).toHaveAttribute("aria-expanded", "false");
  });

  it("uses no Buy or Sell wording", () => {
    renderPanel(plan(), { onPlace: vi.fn() });
    LINES.forEach((l) => openCard(l.ticker));
    expect(document.body.textContent).not.toMatch(/\b(Buy|Sell|Deposit|Withdraw)\b/i);
  });
});
