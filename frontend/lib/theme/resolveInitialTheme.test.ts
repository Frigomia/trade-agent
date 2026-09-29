import { describe, it, expect } from "vitest";
import { resolveInitialTheme } from "./resolveInitialTheme";

describe("resolveInitialTheme", () => {
  it("uses the stored value when it is a valid theme", () => {
    expect(resolveInitialTheme("light", false)).toBe("light");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
  });

  it("falls back to the system preference when nothing is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("light");
    expect(resolveInitialTheme(null, false)).toBe("dark");
  });

  it("ignores a garbage stored value and falls back to the system preference", () => {
    expect(resolveInitialTheme("purple", true)).toBe("light");
  });
});
