import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { Plan, PlanSummary } from "@/lib/plans";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import PlanPage from "./page";

const DISCLAIMER = "Advisory only. Nothing is sent to a broker.";
const HOLDING = {
  ticker: "MSFT",
  name: "Microsoft",
  asset_type: "STOCK",
  shares: 3,
  cost_basis: 300,
  first_purchase_date: "2024-01-01",
  sector: null,
  target_weight: 0.2,
  current_price: 400,
  market_value: 1200,
  unrealized_pl: 0,
  unrealized_pl_pct: 0,
  weight: 1,
};
const SUMMARY = { holdings: [HOLDING], watchlist: [] };
const PLAN: Plan = {
  id: null,
  created_at: null,
  amount_eur: 500,
  whole_shares: false,
  total_before_eur: 7650,
  leftover_eur: 0,
  lines: [
    {
      ticker: "MSFT",
      name: "Microsoft",
      amount_eur: 312.04,
      shares: 0.795,
      price_eur: 392.18,
      currency: "USD",
      rate: 0.9226,
      weight_before: 0.18,
      weight_after: 0.184,
      reason: "favoured",
      reason_text: "Below its target, and its newest call is ADD or BUY",
    },
    {
      ticker: "SAP",
      name: "SAP SE",
      amount_eur: 187.96,
      shares: 0.817,
      price_eur: 229.95,
      currency: "EUR",
      rate: 1,
      weight_before: 0,
      weight_after: 0.024,
      reason: "new_position",
      reason_text: "A new position that starts at 0 %",
    },
  ],
  notes: ["NVDA is left out: no price available."],
  disclaimer: DISCLAIMER,
};
const SAVED: Plan = { ...PLAN, id: 7, created_at: "2026-10-08T12:14:00" };
const SUMMARIES: PlanSummary[] = [
  { id: 3, created_at: "2026-08-15T12:00:00", amount_eur: 450, line_count: 2 },
  { id: 5, created_at: "2026-09-15T12:00:00", amount_eur: 500, line_count: 3 },
];

let plans: PlanSummary[];

function setup({ summary = SUMMARY as unknown, monthly = 500 as number | null } = {}) {
  plans = [...SUMMARIES];
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/preferences") return Promise.resolve({ monthly_contribution: monthly });
    if (path === "/portfolio/summary") return Promise.resolve(summary);
    if (path === "/plans" && method === "GET") return Promise.resolve(plans);
    if (path === "/plans/preview") {
      const req = JSON.parse(init!.body as string) as { amount: number; whole_shares: boolean };
      return Promise.resolve({ ...PLAN, amount_eur: req.amount, whole_shares: req.whole_shares });
    }
    if (path === "/plans" && method === "POST") {
      plans = [{ id: 7, created_at: SAVED.created_at!, amount_eur: 500, line_count: 2 }, ...plans];
      return Promise.resolve(SAVED);
    }
    if (path === "/plans/5" && method === "GET") return Promise.resolve({ ...PLAN, id: 5, created_at: "2026-09-15T12:00:00" });
    if (path === "/plans/5" && method === "DELETE") {
      plans = plans.filter((p) => p.id !== 5);
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PlanPage />
    </SWRConfig>,
  );
}

const body = (path: string) =>
  apiFetch.mock.calls.filter(([p, init]) => p === path && (init as RequestInit | undefined)?.method === "POST").map(([, init]) => JSON.parse((init as RequestInit).body as string));

async function makePlan() {
  renderFresh();
  fireEvent.click(await screen.findByRole("button", { name: "Make plan" }));
  return screen.findByRole("table", { name: "Plan lines" });
}

describe("Plan page", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    setup();
  });

  it("prefills the saved monthly amount and validates it", async () => {
    renderFresh();
    const field = await screen.findByLabelText("Amount this month");
    expect(field).toHaveValue("500.00");
    const button = screen.getByRole("button", { name: "Make plan" });
    expect(button).toBeEnabled();
    for (const bad of ["0", "1000000.01", "12.345", "-3"]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(button).toBeDisabled();
    }
    expect(screen.getByText(/Enter an amount from 0.01 to 1,000,000/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "1000000" } });
    expect(button).toBeEnabled();
  });

  it("starts empty when there is no saved amount", async () => {
    setup({ monthly: null });
    renderFresh();
    expect(await screen.findByLabelText("Amount this month")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Make plan" })).toBeDisabled();
  });

  it("disables Make plan while pending, then shows the ledger with notes and leftover", async () => {
    let resolve: (p: Plan) => void = () => {};
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans/preview" ? new Promise<Plan>((r) => (resolve = r)) : base(path, init),
    );
    renderFresh();
    const button = await screen.findByRole("button", { name: "Make plan" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    resolve(PLAN);

    const table = await screen.findByRole("table", { name: "Plan lines" });
    expect(body("/plans/preview")).toEqual([{ amount: 500, whole_shares: false }]);
    const msft = within(table).getAllByRole("row")[1];
    expect(within(msft).getByText("Add 312.04 EUR")).toBeInTheDocument();
    expect(within(msft).getByText("about 0.795 sh")).toBeInTheDocument();
    expect(within(msft).getByText("Below its target, and its newest call is ADD or BUY")).toBeInTheDocument();
    expect(msft).toHaveTextContent("Weight 18.0% to 18.4%");
    expect(msft).toHaveTextContent("392.18 EUR");
    expect(within(table).getByText("Leftover 0.00 EUR")).toBeInTheDocument();
    expect(within(table).getByText("500.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("NVDA is left out: no price available.")).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/\b(Buy|Sell)\b/);
  });

  it("re-requests with whole_shares when the switch flips", async () => {
    await makePlan();
    fireEvent.click(screen.getByRole("switch", { name: "Whole shares only" }));
    await waitFor(() =>
      expect(body("/plans/preview")).toEqual([
        { amount: 500, whole_shares: false },
        { amount: 500, whole_shares: true },
      ]),
    );
  });

  it("shows the API error readably", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans/preview" ? Promise.reject(new FakeApiError(429, "Too many requests. Try again in a minute.")) : base(path, init),
    );
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Make plan" }));
    expect(await screen.findByText("Too many requests. Try again in a minute.")).toBeInTheDocument();
  });

  it("saves, keeps the result visible and lists the plan in the history", async () => {
    await makePlan();
    const save = screen.getByRole("button", { name: "Save plan" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(await screen.findByText(/Saved 8 Oct 2026/)).toBeInTheDocument();
    expect(body("/plans")).toEqual([{ amount: 500, whole_shares: false }]);
    expect(screen.queryByRole("button", { name: "Save plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Plan lines" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Saved plans" }));
    const history = await screen.findByRole("table", { name: "Saved plans" });
    await waitFor(() => expect(within(history).getAllByRole("row")).toHaveLength(4));
    fireEvent.click(screen.getByRole("tab", { name: "This month" }));
    expect(screen.getByText("Add 312.04 EUR")).toBeVisible();
  });

  it("shows the exchange rate with four significant digits", async () => {
    await makePlan();
    expect(screen.getByText(/1 USD = 0\.9226 EUR/)).toBeInTheDocument();
  });

  it("says when the saved plan differs from the preview because prices were refreshed", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans" && init?.method === "POST"
        ? Promise.resolve({ ...SAVED, lines: SAVED.lines.map((l) => ({ ...l, amount_eur: l.amount_eur + 1 })) })
        : base(path, init),
    );
    await makePlan();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByText("Prices were refreshed when saving; this is the plan that was saved.")).toBeInTheDocument();
  });

  it("says nothing extra when the saved plan matches the preview", async () => {
    await makePlan();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await screen.findByText(/Saved 8 Oct 2026/);
    expect(screen.queryByText(/Prices were refreshed/)).not.toBeInTheDocument();
  });

  it("explains that the amount is too small for one whole share", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans/preview"
        ? Promise.resolve({ ...PLAN, whole_shares: true, lines: [], leftover_eur: 500, notes: ["MSFT: 40.00 EUR is less than one share (392.18 EUR)."] })
        : base(path, init),
    );
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Make plan" }));
    expect(await screen.findByText(/not enough for one whole share of the tickers with a target/)).toBeInTheDocument();
  });

  it("shows how to set targets when nothing has one", async () => {
    setup({ summary: { holdings: [{ ...HOLDING, target_weight: null }], watchlist: [] } });
    renderFresh();
    expect(await screen.findByRole("heading", { name: "Set a target weight first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Portfolio" })).toHaveAttribute("href", "/portfolio");
    expect(screen.queryByRole("button", { name: "Make plan" })).not.toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("says there is nothing to fund when every ticker is left out", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans/preview"
        ? Promise.resolve({ ...PLAN, lines: [], leftover_eur: 500, notes: ["MSFT gets no money: its newest pending call is TRIM."] })
        : base(path, init),
    );
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Make plan" }));
    expect(await screen.findByRole("heading", { name: "Nothing to fund this month" })).toBeInTheDocument();
    expect(screen.getByText("MSFT gets no money: its newest pending call is TRIM.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save plan" })).not.toBeInTheDocument();
  });

  it("always shows the disclaimer", async () => {
    renderFresh();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Saved plans" }));
    expect(screen.getByText(DISCLAIMER)).toBeVisible();
  });

  it("marks the preview stale when the amount changes and saves the displayed plan only", async () => {
    await makePlan();
    const field = screen.getByLabelText("Amount this month");
    fireEvent.change(field, { target: { value: "600" } });
    expect(screen.getByText("This plan is for 500.00 EUR. Press Make plan to update.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Make plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save plan" })).toBeEnabled());
    expect(screen.queryByText(/Press Make plan to update/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(body("/plans")).toEqual([{ amount: 600, whole_shares: false }]));
  });

  it("keeps the switch on the shown plan when the amount is invalid", async () => {
    await makePlan();
    fireEvent.change(screen.getByLabelText("Amount this month"), { target: { value: "" } });
    const sw = screen.getByRole("switch", { name: "Whole shares only" });
    fireEvent.click(sw);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter an amount from 0.01 to 1,000,000/);
    expect(sw).not.toBeChecked();
    expect(body("/plans/preview")).toHaveLength(1);
  });

  it("rolls the switch back and shows the error when the re-request fails", async () => {
    await makePlan();
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/plans/preview"
        ? Promise.reject(new FakeApiError(429, "Too many plans in a minute. Try again shortly."))
        : base(path, init),
    );
    const sw = screen.getByRole("switch", { name: "Whole shares only" });
    fireEvent.click(sw);
    expect(await screen.findByText("Too many plans in a minute. Try again shortly.")).toBeInTheDocument();
    expect(sw).not.toBeChecked();
    expect(screen.getByText("about 0.795 sh")).toBeInTheDocument();
  });

  it("shows a 422 from the preview and a 409 from saving", async () => {
    const base = apiFetch.getMockImplementation()!;
    let previewFails = true;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/plans/preview" && previewFails) {
        return Promise.reject(new FakeApiError(422, "Input should be less than or equal to 1000000"));
      }
      if (path === "/plans" && init?.method === "POST") {
        return Promise.reject(new FakeApiError(409, "You can keep up to 24 saved plans. Delete one before saving another."));
      }
      return base(path, init);
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Make plan" }));
    expect(await screen.findByText("Input should be less than or equal to 1000000")).toBeInTheDocument();

    previewFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Make plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByText("You can keep up to 24 saved plans. Delete one before saving another."),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Plan lines" })).toBeInTheDocument();
  });

  it("offers a retry when the portfolio cannot be loaded", async () => {
    const base = apiFetch.getMockImplementation()!;
    let fail = true;
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/portfolio/summary" && fail ? Promise.reject(new FakeApiError(500, "boom")) : base(path, init),
    );
    renderFresh();
    expect(await screen.findByText("Could not load your portfolio.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Make plan" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load your portfolio.")).not.toBeInTheDocument();
  });

  it("counts a target on a holding with no shares yet, as the backend does", async () => {
    setup({ summary: { holdings: [{ ...HOLDING, shares: 0 }], watchlist: [] } });
    renderFresh();
    expect(await screen.findByRole("button", { name: "Make plan" })).toBeInTheDocument();
  });
});
