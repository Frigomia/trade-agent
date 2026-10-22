import { describe, it, expect, vi } from "vitest";
import { DASH, formatAmount, formatClock, formatPct, formatShare, formatSigned, localTodayIso, todayIso } from "./format";

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

describe("formatShare", () => {
  it("shows a fraction as a percent with one decimal unless told otherwise, and no sign", () => {
    expect(formatShare(0.3125)).toBe("31.3%");
    expect(formatShare(0.5)).toBe("50.0%");
    expect(formatShare(1)).toBe("100.0%");
    expect(formatShare(0.1834, 0)).toBe("18%");
    expect(formatShare(0.12345, 2)).toBe("12.35%");
    expect(formatShare(-0.18, 1)).toBe("-18.0%"); // a fall keeps its minus
  });

  it("never reads minus zero", () => {
    expect(formatShare(-0.00004)).toBe("0.0%");
    expect(formatShare(-0.004, 0)).toBe("0%");
    expect(formatShare(-0)).toBe("0.0%");
  });

  it("gives the dash for a missing or non-finite value", () => {
    for (const bad of [null, undefined, Number.NaN, Infinity, -Infinity]) expect(formatShare(bad)).toBe(DASH);
  });

  it("rounds the value times 100 with toFixed, so halves go the way toFixed does, the same as formatPct", () => {
    expect(formatShare(0.125, 0)).toBe("13%"); // an exact half rounds up
    expect(formatShare(0.285, 1)).toBe("28.5%");
    expect(formatShare(0.0625, 1)).toBe("6.3%"); // 6.25 is exact: up
    expect(formatPct(6.25)).toBe("+6.3%"); // the same rule for the signed one
  });
});

describe("formatClock", () => {
  it("gives the local time of day, 24-hour and zero-padded", () => {
    expect(formatClock(new Date(2026, 9, 22, 14, 14).getTime())).toBe("14:14");
    expect(formatClock(new Date(2026, 9, 22, 9, 5).getTime())).toBe("09:05");
    expect(formatClock(new Date(2026, 9, 22, 0, 0).getTime())).toBe("00:00");
  });
});
