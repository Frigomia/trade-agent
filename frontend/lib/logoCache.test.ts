import { beforeEach, describe, expect, it } from "vitest";
import { clearLogos, getLogo, putLogo } from "./logoCache";

const image = (n: number) => ({ type: "image/png", bytes: new Uint8Array(n) });

beforeEach(clearLogos);

describe("logoCache", () => {
  it("keeps a logo for a day and a missing logo for an hour", () => {
    putLogo("a", image(10), 0);
    putLogo("b", null, 0);

    expect(getLogo("a", 23 * 3_600_000)?.image?.bytes.byteLength).toBe(10);
    expect(getLogo("a", 24 * 3_600_000)).toBeUndefined();
    expect(getLogo("b", 59 * 60_000)?.image).toBeNull();
    expect(getLogo("b", 60 * 60_000)).toBeUndefined();
  });

  it("knows nothing about a logo it never saw", () => {
    expect(getLogo("nope")).toBeUndefined();
  });

  it("drops the oldest logos first when over its byte budget", () => {
    putLogo("old", image(9_000_000), 0);
    putLogo("mid", image(9_000_000), 1);
    putLogo("new", image(9_000_000), 2);

    expect(getLogo("old", 3)).toBeUndefined();
    expect(getLogo("mid", 3)).toBeDefined();
    expect(getLogo("new", 3)).toBeDefined();
  });

  it("bounds the number of remembered misses too, so random tickers cannot grow it without end", () => {
    const limit = Math.floor(20_000_000 / 256);
    for (let i = 0; i < limit + 10; i += 1) putLogo(`m${i}`, null, i);

    expect(getLogo("m0", limit + 10)).toBeUndefined();
    expect(getLogo(`m${limit + 9}`, limit + 10)).toBeDefined();
  });

  it("refuses a single logo bigger than the whole budget", () => {
    putLogo("huge", image(20_000_001), 0);
    expect(getLogo("huge", 1)).toBeUndefined();
  });

  it("replaces an entry without double counting its size", () => {
    putLogo("a", image(12_000_000), 0);
    putLogo("a", image(12_000_000), 1);
    putLogo("b", image(8_000_000), 2);

    expect(getLogo("a", 3)).toBeDefined();
    expect(getLogo("b", 3)).toBeDefined();
  });
});
