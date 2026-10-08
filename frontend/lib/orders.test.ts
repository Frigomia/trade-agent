import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  }
  return { apiFetch: vi.fn(), FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch, ApiError: FakeApiError }));

import { copyAllText, isinShape, nextUnplaced, parsePlacedNumber, placedFill, placeLine, setIsin, ticketText, unplacedLines } from "./orders";
import type { Plan, PlanLine } from "./plans";

const line = (o: Partial<PlanLine> = {}): PlanLine => ({
  id: 1,
  isin: "IE00B4L5Y983",
  placed_at: null,
  placed_trade_id: null,
  placed_shares: null,
  placed_price: null,
  ticker: "IWDA",
  name: "iShares Core MSCI World",
  amount_eur: 92.3,
  shares: 1.69,
  price_eur: 54.64,
  currency: "EUR",
  rate: 1,
  weight_before: null,
  weight_after: null,
  reason: "",
  reason_text: "",
  ...o,
});
const plan = (lines: PlanLine[], whole = false): Plan => ({
  id: 1,
  created_at: null,
  amount_eur: 100,
  whole_shares: whole,
  total_before_eur: 0,
  leftover_eur: 0,
  lines,
  notes: [],
  disclaimer: "",
});

beforeEach(() => {
  apiFetch.mockReset();
});

describe("ticketText", () => {
  it("formats the full ticket", () => {
    expect(ticketText(line(), false)).toBe(
      "Order (amount): 92.30 EUR · iShares Core MSCI World · ISIN IE00B4L5Y983 · about 1.69 shares at 54.64 EUR",
    );
  });
  it("omits the ISIN when null", () => {
    expect(ticketText(line({ isin: null }), false)).toBe(
      "Order (amount): 92.30 EUR · iShares Core MSCI World · about 1.69 shares at 54.64 EUR",
    );
  });
  it("says N shares for whole-share plans, singular for 1, with no 'about'", () => {
    expect(ticketText(line({ shares: 3 }), true)).toContain(" · 3 shares at 54.64 EUR");
    expect(ticketText(line({ shares: 1 }), true)).toContain(" · 1 share at 54.64 EUR");
    expect(ticketText(line({ shares: 3 }), true)).not.toContain("about");
  });
  it("keeps a name containing the separator", () => {
    expect(ticketText(line({ name: "A · B" }), false)).toContain("EUR · A · B · ISIN");
  });
  it("formats amounts and shares", () => {
    expect(ticketText(line({ amount_eur: 92.3 }), false)).toContain("92.30 EUR");
    expect(ticketText(line({ amount_eur: 1234.5 }), false)).toContain("1234.50 EUR");
    expect(ticketText(line({ shares: 1.69 }), false)).toContain("about 1.69 shares");
    expect(ticketText(line({ shares: 1.69 }), false)).not.toContain("1.690");
    expect(ticketText(line({ shares: 2.772 }), false)).toContain("about 2.772 shares");
    expect(ticketText(line({ shares: 2.77249 }), false)).toContain("about 2.772 shares");
    expect(ticketText(line({ shares: 2 }), false)).toContain("about 2 shares");
  });
});

describe("copyAllText", () => {
  it("joins unplaced lines in order, one per line, skipping placed ones", () => {
    const p = plan([
      line({ name: "A" }),
      line({ name: "B", placed_at: "2026-10-08T10:00:00" }),
      line({ name: "C", isin: null }),
    ]);
    expect(unplacedLines(p).map((l) => l.name)).toEqual(["A", "C"]);
    expect(copyAllText(p)).toBe(`${ticketText(p.lines[0], false)}\n${ticketText(p.lines[2], false)}`);
  });
  it("is empty when all are placed", () => {
    expect(copyAllText(plan([line({ placed_at: "2026-10-08T10:00:00" })]))).toBe("");
  });
  it("uses the plan's whole_shares", () => {
    expect(copyAllText(plan([line({ shares: 1 })], true))).toContain("1 share at");
  });
});

describe("placedFill", () => {
  it("shows the logged shares (3 decimals at most) and price (2 decimals, no separators)", () => {
    expect(placedFill(line({ placed_shares: 1.69, placed_price: 54.6 }))).toBe("1.69 sh at 54.60");
    expect(placedFill(line({ placed_shares: 2.77249, placed_price: 1234.567 }))).toBe("2.772 sh at 1234.57");
    expect(placedFill(line({ placed_shares: 3, placed_price: 10 }))).toBe("3 sh at 10.00");
  });
  it("is null when the trade is not known", () => {
    expect(placedFill(line())).toBeNull();
    expect(placedFill(line({ placed_shares: 1 }))).toBeNull();
  });
});

describe("nextUnplaced", () => {
  const p = plan([
    line({ ticker: "A" }),
    line({ ticker: "B", placed_at: "2026-10-08T10:00:00" }),
    line({ ticker: "C" }),
    line({ ticker: "D" }),
  ]);
  it("takes the next unplaced line after the placed one", () => {
    expect(nextUnplaced(p, "A")?.ticker).toBe("C");
    expect(nextUnplaced(p, "C")?.ticker).toBe("D");
  });
  it("wraps to an earlier unplaced line", () => {
    expect(nextUnplaced(p, "D")?.ticker).toBe("A");
  });
  it("is null when the placed line was the last one", () => {
    expect(nextUnplaced(plan([line({ ticker: "A" }), line({ ticker: "B", placed_at: "x" })]), "A")).toBeNull();
  });
});

describe("parsePlacedNumber", () => {
  it.each([
    ["1.69", 1.69],
    ["54,6", 54.6],
    [" 2 ", 2],
    ["0.000001", 0.000001],
  ])("accepts %j", (raw, n) => {
    expect(parsePlacedNumber(raw)).toBe(n);
  });
  it.each(["", "e", "1e5", "-1", "0", "0.0", "abc", "1.2.3", "Infinity", "NaN", "1.0000001", "1000000000000"])("rejects %j", (raw) => {
    expect(parsePlacedNumber(raw)).toBeNull();
  });
});

describe("placeLine", () => {
  it("POSTs the body, without asset_type when not given", async () => {
    apiFetch.mockResolvedValue(line());
    await placeLine(4, 7, { date: "2026-10-08", shares: 1.69, price: 54.64 });
    const [path, init] = apiFetch.mock.calls[0];
    expect(path).toBe("/plans/4/lines/7/placed");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ date: "2026-10-08", shares: 1.69, price: 54.64 });
    expect(init.body).not.toContain("asset_type");
  });
  it("includes asset_type when given", async () => {
    apiFetch.mockResolvedValue(line());
    await placeLine(4, 7, { date: "2026-10-08", shares: 1, price: 2, asset_type: "ETF" });
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).asset_type).toBe("ETF");
  });
  it.each([404, 409, 422, 429])("propagates the %i detail", async (status: number) => {
    apiFetch.mockRejectedValue(new FakeApiError(status, "nope"));
    await expect(placeLine(1, 1, { date: "2026-10-08", shares: 1, price: 1 })).rejects.toHaveProperty("detail", "nope");
  });
});

describe("isinShape", () => {
  it("trims and upper-cases a well-shaped ISIN", () => {
    expect(isinShape("  us67066g1040 ")).toBe("US67066G1040");
  });
  it.each(["", "US67066G104", "US67066G10401", "1S67066G1040", "US67066G104X", "US67066G10-0"])("rejects %j", (raw) => {
    expect(isinShape(raw)).toBeNull();
  });
});

describe("setIsin", () => {
  it("PUTs the isin to the encoded ticker URL", async () => {
    apiFetch.mockResolvedValue({ ticker: "BRK/B", isin: "IE00B4L5Y983" });
    await setIsin("BRK/B", "IE00B4L5Y983");
    const [path, init] = apiFetch.mock.calls[0];
    expect(path).toBe("/portfolio/instruments/BRK%2FB/isin");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ isin: "IE00B4L5Y983" });
  });
  it("sends an empty string to clear", async () => {
    apiFetch.mockResolvedValue({ ticker: "X", isin: null });
    await setIsin("X", "");
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ isin: "" });
  });
  it("propagates the 422 detail", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Not a valid ISIN"));
    await expect(setIsin("X", "bad")).rejects.toHaveProperty("detail", "Not a valid ISIN");
  });
});
