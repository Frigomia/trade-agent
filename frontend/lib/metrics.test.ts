import { describe, expect, it } from "vitest";
import type { PeerComparison } from "@/lib/api/discovery-types";
import { bandLayout, eurCompact, formatMetric, metricLabel, peerGroupLabel, peerNote, riskFlag, sizeWord } from "./metrics";

const cmp = (over: Partial<PeerComparison> = {}): PeerComparison => ({
  metric: "trailingPE",
  value: 24.6,
  peer_group: "industry",
  peer_count: 12,
  peer_median: 29.8,
  peer_p25: 22,
  peer_p75: 36,
  position: "within",
  ...over,
});

describe("formatMetric", () => {
  it("shows a fraction as a percent and a multiple with an x", () => {
    expect(formatMetric("returnOnEquity", 0.213)).toBe("21.3%");
    expect(formatMetric("operatingMargins", -0.04)).toBe("-4.0%");
    // dividend yield and debt to equity arrive normalized: the backend has already divided by 100
    expect(formatMetric("dividendYield", 0.025)).toBe("2.5%");
    expect(formatMetric("debtToEquity", 0.45)).toBe("45.0%");
    expect(formatMetric("trailingPE", 24.64)).toBe("24.6x");
  });

  it("keeps a second decimal below one, so a small figure does not read as zero", () => {
    expect(formatMetric("pegRatio", 0.04)).toBe("0.04x");
    expect(formatMetric("payoutRatio", 0.0004)).toBe("0.04%");
    expect(formatMetric("trailingPE", 0)).toBe("0.0x");
  });

  it("is null for a missing or non-finite value, so the caller can say Not available", () => {
    expect(formatMetric("trailingPE", null)).toBeNull();
    expect(formatMetric("trailingPE", undefined)).toBeNull();
    expect(formatMetric("trailingPE", Number.NaN)).toBeNull();
    expect(formatMetric("trailingPE", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("shows an unknown metric as a plain number, with no unit guessed, rather than hiding it", () => {
    expect(formatMetric("somethingNew", 3)).toBe("3");
    expect(formatMetric("grossMargins", 0.4321)).toBe("0.432");
    expect(metricLabel("somethingNew")).toBe("somethingNew");
    expect(metricLabel("fcfMargin")).toBe("Free cash flow margin");
  });
});

describe("bandLayout", () => {
  it("puts the band, the median and the dot on one track in the right order", () => {
    const l = bandLayout(cmp())!;
    expect(l.band.left).toBeLessThan(l.median);
    expect(l.median).toBeLessThan(l.band.left + l.band.width);
    expect(l.value).toBeGreaterThan(l.band.left); // 24.6 sits inside the 22 to 36 band
    expect(l.value).toBeLessThan(l.band.left + l.band.width);
    for (const n of [l.band.left, l.median, l.value, l.band.left + l.band.width]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });

  it("keeps a value far outside the band on the track", () => {
    const l = bandLayout(cmp({ value: 90 }))!;
    expect(l.value).toBeLessThanOrEqual(100);
    expect(l.value).toBeGreaterThan(l.band.left + l.band.width);
  });

  it("does not divide by zero when the peers all share one value", () => {
    const l = bandLayout(cmp({ peer_p25: 20, peer_p75: 20, peer_median: 20, value: 20 }))!;
    expect(Number.isFinite(l.value)).toBe(true);
    expect(Number.isFinite(l.band.width)).toBe(true);
  });

  it("is null when any figure is missing", () => {
    expect(bandLayout(cmp({ value: null }))).toBeNull();
    expect(bandLayout(cmp({ peer_median: null }))).toBeNull();
    expect(bandLayout(cmp({ peer_p25: null }))).toBeNull();
    expect(bandLayout(cmp({ peer_p75: null }))).toBeNull();
  });
});

describe("peerGroupLabel", () => {
  it("names the group and count when every comparison agrees, or nothing when there is no group", () => {
    expect(peerGroupLabel([cmp(), cmp()])).toBe("Industry group · 12 companies");
    expect(peerGroupLabel([cmp({ peer_group: "sector", peer_count: 40 })])).toBe("Sector group · 40 companies");
    expect(peerGroupLabel([cmp({ peer_count: 1 })])).toBe("Industry group · 1 company");
    expect(peerGroupLabel([cmp({ peer_group: "none", peer_count: 0 })])).toBeNull();
    expect(peerGroupLabel([])).toBeNull();
  });

  it("gives a range of counts rather than the largest, and says when the groups are mixed", () => {
    expect(peerGroupLabel([cmp(), cmp({ peer_count: 9 })])).toBe("Industry group · 9 to 12 companies");
    expect(peerGroupLabel([cmp({ peer_count: 12 }), cmp({ peer_group: "sector", peer_count: 40 })])).toBe(
      "Industry and sector groups · 12 to 40 companies",
    );
  });

  it("ignores a comparison with no peer group", () => {
    expect(peerGroupLabel([cmp(), cmp({ peer_group: "none", peer_count: 0 })])).toBe("Industry group · 12 companies");
  });
});

describe("peerNote", () => {
  it("states the group and count behind one comparison", () => {
    expect(peerNote(cmp())).toBe("12 industry peers");
    expect(peerNote(cmp({ peer_group: "sector", peer_count: 1 }))).toBe("1 sector peer");
    expect(peerNote(cmp({ peer_group: "none", peer_count: 0 }))).toBeNull();
  });
});

describe("risk helpers", () => {
  it("words size, and formats euro amounts compactly", () => {
    expect(sizeWord("large")).toBe("Large");
    expect(sizeWord("unknown")).toBe("Unknown");
    expect(eurCompact(38_200_000_000)).toBe("EUR 38.2B");
    expect(eurCompact(190_000_000)).toBe("EUR 190M");
    expect(eurCompact(450_000)).toBe("EUR 450K");
    expect(eurCompact(null)).toBeNull();
    expect(eurCompact(-1)).toBeNull();
  });

  it("splits a backend flag into a title and its detail", () => {
    expect(riskFlag("thin_liquidity: 0.4M EUR traded a day")).toEqual({ title: "Thin trading", detail: "0.4M EUR traded a day" });
    expect(riskFlag("brand_new_flag")).toEqual({ title: "Brand new flag", detail: "" });
  });
});
