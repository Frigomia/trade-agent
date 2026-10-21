import { describe, expect, it } from "vitest";
import { hostOf, safeHref } from "./safeHref";

describe("safeHref", () => {
  it("accepts http and https and rejects everything else", () => {
    expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHref("http://a.example/")).toBe("http://a.example/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
});

describe("hostOf", () => {
  it("drops www and falls back to the text for a non-URL", () => {
    expect(hostOf("https://www.example.com/q3")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
