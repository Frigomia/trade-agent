import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyThemeChoice, readThemeChoice } from "./applyTheme";

function mockPrefersLight(light: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: light }) as unknown as typeof window.matchMedia;
}

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("stores and applies an explicit choice", () => {
    applyThemeChoice("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(readThemeChoice()).toBe("light");
  });

  it("system forgets the stored choice and follows the OS preference", () => {
    localStorage.setItem("theme", "dark");
    mockPrefersLight(true);
    applyThemeChoice("system");
    expect(localStorage.getItem("theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readThemeChoice()).toBe("system");
  });

  it("treats an unknown stored value as system", () => {
    localStorage.setItem("theme", "purple");
    expect(readThemeChoice()).toBe("system");
  });

  it("still applies the theme when storage throws", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    applyThemeChoice("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    Storage.prototype.setItem = original;
  });
});
