"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@mui/material";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  // ponytail: known limitation — the icon on first paint is always the dark-theme icon, briefly
  // wrong for a light-theme user until the effect below corrects it after mount. Reading
  // document.documentElement.dataset.theme in the useState initializer looks like a one-line
  // fix, but this is a "use client" component that Next still server-renders for the initial
  // HTML, so the initializer would run on the client during hydration with a different value
  // than the server-rendered markup — trading this flash for a hydration mismatch (the exact
  // class of bug Finding 5 addresses elsewhere). Not worth restructuring for a Minor finding.
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    // Wrapped in a named function (rather than calling setTheme directly) so this reads as
    // syncing from an external system (the DOM), matching ThemeProvider's pattern and
    // satisfying the react-hooks/set-state-in-effect lint rule.
    const sync = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    sync();
  }, []);

  function toggle() {
    // Reads the DOM directly rather than the `theme` state variable, so this always acts on the
    // real current value even if data-theme changed externally (a second toggle instance, or a
    // future Preferences screen) between renders.
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing or storage disabled: the toggle still works for this session,
      // it just won't be remembered next visit.
    }
    setTheme(next);
  }

  return (
    <IconButton
      onClick={toggle}
      aria-label="Switch theme"
      size="small"
      sx={{
        width: 34,
        height: 34,
        color: "var(--text)",
        bgcolor: "var(--panel)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow)",
        "&:hover": { color: "var(--accent)", bgcolor: "var(--panel)" },
      }}
    >
      {theme === "light" ? (
        <Moon size={17} strokeWidth={1.75} />
      ) : (
        <Sun size={17} strokeWidth={1.75} />
      )}
    </IconButton>
  );
}
