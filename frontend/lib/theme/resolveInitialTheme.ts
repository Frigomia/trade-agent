export type Theme = "light" | "dark";

/**
 * Pure decision logic shared by the pre-paint inline script (as an inlined copy, since
 * scripts in <head> can't import modules) and this module's own callers. Kept here, tested
 * here, so the no-flash script's actual behavior is provable without testing paint timing.
 */
export function resolveInitialTheme(stored: string | null, prefersLight: boolean): Theme {
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return prefersLight ? "light" : "dark";
}
