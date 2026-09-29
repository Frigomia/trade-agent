"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { buildMuiTheme } from "@/lib/theme/buildMuiTheme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setMode(root.dataset.theme === "light" ? "light" : "dark");
    sync();
    // The toggle flips data-theme directly (synchronously, for zero flash); this observer
    // is how the MUI theme object learns about that flip and rebuilds.
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => buildMuiTheme(mode), [mode]);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}
