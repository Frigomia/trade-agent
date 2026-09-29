import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { NO_FLASH_SCRIPT } from "@/lib/theme/resolveInitialTheme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Agent",
  description: "A personal, advisory-only trading assistant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/* suppressHydrationWarning: a browser extension injecting a `src` attribute or
            rewriting this script's content before hydration is expected noise, not a real
            mismatch — the script has already run and done its job by the time React hydrates.
            <html>'s own suppressHydrationWarning doesn't cascade to children, so this needs
            its own. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeProvider>{children}</ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
