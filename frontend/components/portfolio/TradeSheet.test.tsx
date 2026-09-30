// frontend/components/portfolio/TradeSheet.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { TradeSheet } from "./TradeSheet";

const HOLDINGS = [
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "OLD", name: "Sold Out Co" },
];

function setup(props: Partial<React.ComponentProps<typeof TradeSheet>> = {}) {
  const onClose = vi.fn();
  const onLogged = vi.fn();
  render(
    <TradeSheet open onClose={onClose} holdings={HOLDINGS} onLogged={onLogged} {...props} />,
  );
  return { onClose, onLogged };
}

function fill(shares: string, price: string) {
  fireEvent.change(screen.getByLabelText("Shares"), { target: { value: shares } });
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: price } });
}

function sentBody() {
  return JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("TradeSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says plainly that it only records a trade and sends nothing to a broker", () => {
    setup();

    expect(screen.getByText(/this only records it here/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent to a broker/i)).toBeInTheDocument();
  });

  it("lists every holding, including a sold-out one, so the user can buy back in", () => {
    setup();

    expect(screen.getByRole("option", { name: /AAPL/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OLD/ })).toBeInTheDocument();
  });

  it("applies the prefill and defaults the date to today", () => {
    setup({ prefill: { ticker: "OLD", action: "SELL" } });

    expect(screen.getByLabelText("Ticker")).toHaveValue("OLD");
    expect(screen.getByRole("button", { name: "Sold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-30");
  });

  it("logs a purchase, then reports it and closes", async () => {
    apiFetch.mockResolvedValue({});
    const { onClose, onLogged } = setup();

    fill("3", "121.6");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/portfolio/trades");
    expect(sentBody()).toEqual({
      date: "2026-09-30",
      ticker: "AAPL",
      action: "BUY",
      shares: 3,
      price: 121.6,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("logs a sale when Sold is selected", async () => {
    apiFetch.mockResolvedValue({});
    const { onLogged } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Sold" }));
    fill("2", "130");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(sentBody().action).toBe("SELL");
  });

  it("shows the backend's message and stays open when selling more than is held", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Cannot sell 50.0; holding has 10.0"));
    const { onClose, onLogged } = setup({ prefill: { ticker: "AAPL", action: "SELL" } });

    fill("50", "130");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() =>
      expect(screen.getByText("Cannot sell 50.0; holding has 10.0")).toBeInTheDocument(),
    );
    expect(onLogged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not send a request for empty or non-positive numbers", () => {
    setup();

    fill("", "");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));
    expect(screen.getByText(/enter shares and a price above zero/i)).toBeInTheDocument();

    fill("0", "10");
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first request is still in flight", async () => {
    let resolve!: (value: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();

    fill("3", "121.6");
    const save = screen.getByRole("button", { name: /save to log/i });
    fireEvent.click(save);
    fireEvent.click(save);
    resolve({});

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
