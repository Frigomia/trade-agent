import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveInitialTheme, NO_FLASH_SCRIPT } from "./resolveInitialTheme";

// Runs the exact script string layout.tsx ships in <head> against jsdom's document/localStorage,
// then checks the resulting data-theme attribute against resolveInitialTheme's own answer for the
// same inputs — so an edit to one without the other fails this test instead of shipping silently.
function runNoFlashScript() {
  const run = new Function(NO_FLASH_SCRIPT);
  run();
}

describe("NO_FLASH_SCRIPT", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    // jsdom has no real matchMedia implementation; the script calls it unconditionally
    // (to compute prefersLight) even when a stored value short-circuits the ternary, and its
    // own try/catch would otherwise silently swallow jsdom's "not implemented" error.
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("light") }) as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("agrees with resolveInitialTheme when a theme is stored", () => {
    localStorage.setItem("theme", "light");
    runNoFlashScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe(resolveInitialTheme("light", false));
  });

  it("agrees with resolveInitialTheme when nothing is stored and the system prefers light", () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("light") }) as MediaQueryList) as typeof window.matchMedia;

    runNoFlashScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe(resolveInitialTheme(null, true));
  });

  it("agrees with resolveInitialTheme when nothing is stored and the system prefers dark", () => {
    window.matchMedia = (() => ({ matches: false }) as MediaQueryList) as typeof window.matchMedia;

    runNoFlashScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe(resolveInitialTheme(null, false));
  });
});

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
