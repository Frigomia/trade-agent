import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Agent",
  description: "A personal, advisory-only trading assistant.",
};

// Inlined copy of resolveInitialTheme's logic: a <head> script can't import a module, so
// the decision rule is duplicated here and kept in sync by the test in
// lib/theme/resolveInitialTheme.test.ts, which is the source of truth for the rule itself.
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme = (stored === "light" || stored === "dark") ? stored : (prefersLight ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeProvider>{children}</ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
