import { describe, it, expect, vi } from "vitest";
import { formatAmount, formatPct, formatSigned, localTodayIso, todayIso } from "./format";

describe("format", () => {
  it("formats amounts with thousands separators and two decimals, no currency symbol", () => {
    expect(formatAmount(10204.1)).toBe("10,204.10");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-103.2)).toBe("-103.20");
  });

  it("signs positive amounts explicitly", () => {
    expect(formatSigned(551.7)).toBe("+551.70");
    expect(formatSigned(-103.2)).toBe("-103.20");
    expect(formatSigned(0)).toBe("+0.00");
    expect(formatSigned(-0.001)).toBe("+0.00");
  });

  it("gives today's UTC date as YYYY-MM-DD", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T23:30:00Z"));
    expect(todayIso()).toBe("2026-09-30");
    vi.useRealTimers();
  });

  it("gives today's local calendar date near local midnight, whatever the UTC date is", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 8, 0, 15)); // 00:15 local on 8 Oct
    expect(localTodayIso()).toBe("2026-10-08");
    vi.setSystemTime(new Date(2026, 9, 8, 23, 45)); // 23:45 local on 8 Oct
    expect(localTodayIso()).toBe("2026-10-08");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 5));
    expect(localTodayIso()).toBe("2026-01-01");
    vi.useRealTimers();
  });

  it("formats percentages with one decimal and an explicit sign", () => {
    expect(formatPct(5.72)).toBe("+5.7%");
    expect(formatPct(-9.6)).toBe("-9.6%");
    expect(formatPct(0)).toBe("+0.0%");
    expect(formatPct(-0.04)).toBe("+0.0%");
  });
});
