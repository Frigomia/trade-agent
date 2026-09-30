export type ThemeChoice = "system" | "light" | "dark";

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Same rules as the pre-paint script (resolveInitialTheme.ts): an explicit choice is stored and
 * wins; "system" forgets the stored choice and follows the OS. The theme still changes for this
 * visit when storage is blocked, it just is not remembered. ThemeProvider observes data-theme.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  let theme: "light" | "dark";
  if (choice === "system") {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } else {
    theme = choice;
  }
  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    // Private browsing or storage disabled: applied for this session only.
  }
}
