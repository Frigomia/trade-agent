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

/**
 * The pre-paint <head> script, as a string: a <head> script can't import a module, so this
 * builds the exact same source layout.tsx inlines via dangerouslySetInnerHTML, and that a test
 * can eval to prove it still agrees with resolveInitialTheme above. Keep this logic in lockstep
 * with resolveInitialTheme by hand — that's what the test in resolveInitialTheme.test.ts checks.
 */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme = (stored === "light" || stored === "dark") ? stored : (prefersLight ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;
