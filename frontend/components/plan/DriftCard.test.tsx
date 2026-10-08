import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { DriftItem } from "@/lib/plans";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));

import { DriftCard, driftSentence } from "./DriftCard";

const item = (ticker: string, points: number): DriftItem => ({ ticker, name: ticker, weight: 0.3, target: 0.2, points });

function renderCard() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DriftCard />
    </SWRConfig>,
  );
}

describe("DriftCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the sentence and a link to the plan page", async () => {
    apiFetch.mockResolvedValue([item("AAPL", 7.24), item("NVDA", -6.1)]);
    renderCard();
    expect(await screen.findByText("AAPL is 7.2 points above its target and NVDA 6.1 below.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/portfolio/plan");
  });

  it("renders nothing while loading", () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no drift", async () => {
    apiFetch.mockResolvedValue([]);
    const { container } = renderCard();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing, and no error, when the request fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    const { container } = renderCard();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("driftSentence", () => {
  it("names one holding", () => {
    expect(driftSentence([item("AAPL", -2)])).toBe("AAPL is 2.0 points below its target.");
  });
  it("lists the top three and counts the rest", () => {
    const items = [item("A", 9), item("B", -8), item("C", 7), item("D", 6), item("E", -5)];
    expect(driftSentence(items)).toBe("A is 9.0 points above its target, B 8.0 below, C 7.0 above and 2 more.");
  });
});
