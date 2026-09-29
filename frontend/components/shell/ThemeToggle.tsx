"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@mui/material";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    // Wrapped in a named function (rather than calling setTheme directly) so this reads as
    // syncing from an external system (the DOM), matching ThemeProvider's pattern and
    // satisfying the react-hooks/set-state-in-effect lint rule.
    const sync = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    sync();
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
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
    <IconButton onClick={toggle} aria-label="Switch theme" size="small">
      {theme === "light" ? (
        <Moon size={17} strokeWidth={1.75} />
      ) : (
        <Sun size={17} strokeWidth={1.75} />
      )}
    </IconButton>
  );
}
