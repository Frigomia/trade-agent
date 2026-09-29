# Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js frontend scaffold, theming, shell navigation, and API client that every later screen-building cycle (sub-projects 4-8) depends on — no real screens yet.

**Architecture:** A `create-next-app` (App Router, TypeScript, npm) scaffold in `frontend/`, themed with MUI (`createTheme` reading CSS custom properties, not MUI's own Material defaults) so it matches the approved "Emerald Glass" mockups, Tailwind CSS 4 kept for layout utilities, a role-gated shell (tab bar / sidebar) with placeholder routes, a typed `fetch` wrapper attaching a Supabase bearer token, and CI mirroring the backend's.

**Tech Stack:** Next.js 15 (App Router), TypeScript, MUI 6 (`@mui/material`, `@mui/material-nextjs`), Tailwind CSS 4, `lucide-react`, `@supabase/ssr`, `openapi-typescript`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-frontend-foundation-design.md`

## Global Constraints

- The system never places a trade — no execution UI (no Buy/Sell/Deposit/Withdraw) anywhere, including placeholders.
- Every color/shadow/radius comes from the CSS custom properties or the MUI theme that reads them — never a hard-coded hex value in a component.
- Dark/light theme switching is one `data-theme` attribute flip on `<html>`, applied before first paint (no flash); the choice persists in `localStorage`, falling back to `prefers-color-scheme` when unset.
- Motion respects `prefers-reduced-motion`.
- `frontend-ci.yml` is path-filtered on `frontend/**` and its own workflow file, matching `backend-ci.yml`'s shape (quality job, dependency audit, secrets scan).
- No secrets or `.env` values committed; Conventional Commits.
- `frontend/CLAUDE.md` is created empty in this cycle — its content is supplied later by the project owner.
- `lib/api/types.generated.ts` is generated (via `npm run gen:types` against a running local backend) and gitignored, never committed — nothing built in this cycle imports it yet, so this has no CI impact.

## Review Focus

- A reload with a previously chosen theme must apply it before paint, and system-preference fallback (light OS setting, no stored choice) must resolve to light, not always dark — the spec's no-flash requirement is silent on the fallback branch, but a user with a light OS and no prior visit reasonably expects a light first paint, not a dark one that then never changes.
- `localStorage` being unavailable (private browsing) must not crash the theme toggle — a reasonable person expects the toggle button to keep working that session even if the choice can't persist.
- The Admin nav item must be absent for a non-admin role and present for admin, in both the phone tab bar and the desktop sidebar — the spec calls this out explicitly ("Admin users get an Admin tab" / "an 'Administration' group for the admin") and a leak here would show a non-admin destinations they can't use.
- `apiFetch` must omit the Authorization header entirely (not send a literal `"Bearer undefined"`) when there is no active session, and attach it correctly when there is one — the spec doesn't enumerate the unauthenticated case, but `/health` and pre-login calls must not send a malformed header.
- `apiFetch` must surface the backend's `detail` message on a non-2xx response, and fall back to the response's status text when the error body isn't valid JSON — a non-JSON error body is not in the spec's examples but is a real failure mode (a proxy error page, a timeout) that must not throw an unrelated parsing exception.

---

### Task 1: Scaffold, Tailwind v4 wiring, and the test runner

**Files:**
- Create: `frontend/` (via `create-next-app`)
- Modify: `frontend/next.config.ts`
- Modify: `frontend/postcss.config.mjs`
- Modify: `frontend/tsconfig.json`
- Create: `frontend/.env.example`
- Modify: `frontend/.gitignore`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/page.tsx`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`
- Test: `frontend/lib/smoke.test.ts`

**Interfaces:**
- Produces: a booting Next.js app at `frontend/`, `npm run dev`/`build`/`lint`/`test` scripts, a `@/*` import alias resolving to `frontend/`, Vitest configured with `jsdom` and `@testing-library/jest-dom` matchers available in every later test file via `globals: true` and the setup file.

- [ ] **Step 1: Scaffold with create-next-app**

From the repository root:

```bash
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
```

Answer any interactive prompts with the defaults (Turbopack: yes is fine either way, this plan doesn't depend on it).

- [ ] **Step 2: Confirm `next.config.ts`**

Open `frontend/next.config.ts` and replace its contents with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 3: Confirm the Tailwind v4 PostCSS setup**

Open `frontend/postcss.config.mjs` and ensure it reads exactly:

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 4: Set `app/globals.css` to a minimal Tailwind-without-preflight baseline**

Tailwind v4 has no `corePlugins` toggle for preflight; disabling it means importing only the `theme` and `utilities` layers, skipping `preflight` (MUI's `CssBaseline`, added in Task 2, provides the reset instead). Replace the entire contents of `frontend/app/globals.css` with:

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

html,
body {
  height: 100%;
}
```

(Theme tokens are added in Task 2 — this step only proves the build pipeline works without preflight.)

- [ ] **Step 5: Confirm `tsconfig.json`'s path alias**

Open `frontend/tsconfig.json` and confirm `compilerOptions.paths` contains:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

(`create-next-app --import-alias "@/*"` should already have set this; if the generated file differs, edit it to match exactly this mapping, leaving the rest of the generated `compilerOptions` as-is.)

- [ ] **Step 6: Write `.env.example`**

Create `frontend/.env.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 7: Extend `.gitignore`**

Open `frontend/.gitignore` (created by `create-next-app`) and add, if not already present:

```
# generated, never committed — regenerate with `npm run gen:types`
lib/api/types.generated.ts
```

- [ ] **Step 8: Replace the placeholder home page**

Replace `frontend/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/today");
}
```

(There is no auth yet, so this always redirects to the shell's default tab; sub-project 4 replaces this with a real authenticated/unauthenticated redirect.)

- [ ] **Step 9: Install and configure Vitest**

```bash
cd frontend
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Create `frontend/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Create `frontend/vitest.setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

Add a `test` script to `frontend/package.json`'s `"scripts"` block:

```json
"test": "vitest run"
```

- [ ] **Step 10: Write a trivial smoke test proving the pipeline**

Create `frontend/lib/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest pipeline", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 11: Run the test, the build, and the lint**

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: `npm test` shows 1 passed; `npm run build` completes without errors (the redirect in `page.tsx` is fine at build time — Next.js handles `redirect()` in a page component); `npm run lint` passes with no errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold the Next.js frontend with Tailwind v4 and Vitest"
```

---

### Task 2: Theme tokens, no-flash script, and MUI theming

**Files:**
- Modify: `frontend/app/globals.css`
- Create: `frontend/lib/theme/resolveInitialTheme.ts`
- Test: `frontend/lib/theme/resolveInitialTheme.test.ts`
- Create: `frontend/lib/theme/buildMuiTheme.ts`
- Create: `frontend/components/shell/ThemeProvider.tsx`
- Create: `frontend/components/shell/ThemeToggle.tsx`
- Test: `frontend/components/shell/ThemeToggle.test.tsx`
- Modify: `frontend/app/layout.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the scaffold itself.
- Produces: `resolveInitialTheme(stored: string | null, prefersLight: boolean): "light" | "dark"` (pure function, used by the inline script and testable in isolation); `buildMuiTheme(mode: "light" | "dark"): Theme`; `<ThemeProvider>` (wraps children in the MUI theme, re-derived on `data-theme` change); `<ThemeToggle>` (the header button). Later tasks import `ThemeToggle` into the shell header.

- [ ] **Step 1: Add the theme tokens to `globals.css`**

Append to `frontend/app/globals.css` (after the two `@import` lines and the `html, body` rule from Task 1):

```css
:root {
  --bg: #060d0c;
  --text: #e7f3ef;
  --text2: #cfe2dc;
  --muted: #8aa89f;
  --accent: #34e7a9;
  --accent-solid: #34e7a9;
  --on-accent: #032116;
  --up: #34e7a9;
  --down: #ff6b72;
  --warn: #f4c04f;
  --up-bg: rgba(52, 231, 169, 0.13);
  --down-bg: rgba(255, 107, 114, 0.13);
  --warn-bg: rgba(244, 192, 79, 0.12);
  --panel: rgba(255, 255, 255, 0.035);
  --line: rgba(120, 255, 214, 0.11);
  --line2: rgba(120, 255, 214, 0.2);
  --track: rgba(255, 255, 255, 0.08);
  --field: rgba(255, 255, 255, 0.045);
  --scrim: rgba(0, 0, 0, 0.55);
}

:root[data-theme="light"] {
  --bg: #f2f8f5;
  --text: #0b1f19;
  --text2: #29473c;
  --muted: #52695f;
  --accent: #078a5f;
  --accent-solid: #067a52;
  --on-accent: #ffffff;
  --up: #067a52;
  --down: #c8323d;
  --warn: #9a5b00;
  --up-bg: rgba(6, 122, 82, 0.1);
  --down-bg: rgba(200, 50, 61, 0.1);
  --warn-bg: rgba(154, 91, 0, 0.11);
  --panel: rgba(255, 255, 255, 0.78);
  --line: rgba(8, 110, 80, 0.15);
  --line2: rgba(8, 110, 80, 0.3);
  --track: rgba(10, 60, 45, 0.1);
  --field: rgba(255, 255, 255, 0.9);
  --scrim: rgba(11, 31, 25, 0.35);
}

body {
  background: var(--bg);
  color: var(--text);
}

@media (prefers-reduced-motion: no-preference) {
  [data-theme] {
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }
}
```

(Token values copied verbatim from the design spec's table.)

- [ ] **Step 2: Write the failing test for the theme-resolution logic**

Create `frontend/lib/theme/resolveInitialTheme.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveInitialTheme } from "./resolveInitialTheme";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/theme/resolveInitialTheme.test.ts`
Expected: FAIL — `resolveInitialTheme.ts` does not exist yet.

- [ ] **Step 4: Implement `resolveInitialTheme`**

Create `frontend/lib/theme/resolveInitialTheme.ts`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/theme/resolveInitialTheme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write `buildMuiTheme`**

Create `frontend/lib/theme/buildMuiTheme.ts`:

```typescript
import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";

/**
 * Every color/shadow/radius here reads a CSS custom property (see app/globals.css) instead
 * of a literal value, so the theme never drifts from the tokens Tailwind classes also use.
 * `mode` only steers MUI's own contrast/elevation math; it does not select the actual colors.
 */
export function buildMuiTheme(mode: "light" | "dark"): MuiTheme {
  return createTheme({
    palette: {
      mode,
      background: { default: "var(--bg)", paper: "var(--panel)" },
      text: { primary: "var(--text)", secondary: "var(--text2)" },
      primary: { main: "var(--accent-solid)", contrastText: "var(--on-accent)" },
      success: { main: "var(--up)" },
      error: { main: "var(--down)" },
      warning: { main: "var(--warn)" },
    },
    shape: { borderRadius: 18 },
    typography: {
      fontFamily: "var(--font-geist), system-ui, sans-serif",
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: "var(--panel)",
            border: "1px solid var(--line)",
            backdropFilter: "blur(20px)",
            boxShadow: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: "var(--panel)",
            borderLeft: "1px solid var(--line)",
            backdropFilter: "blur(20px)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999 },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 14, textTransform: "none" },
        },
      },
    },
  });
}
```

- [ ] **Step 7: Write `ThemeProvider`**

Create `frontend/components/shell/ThemeProvider.tsx`:

```tsx
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
```

- [ ] **Step 8: Write the failing test for `ThemeToggle`**

Create `frontend/components/shell/ThemeToggle.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("flips data-theme on click and persists the choice", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("still flips the visible theme when localStorage throws", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };

    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /switch theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    Storage.prototype.setItem = original;
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/shell/ThemeToggle.test.tsx`
Expected: FAIL — `ThemeToggle.tsx` does not exist yet.

- [ ] **Step 10: Implement `ThemeToggle`**

Install lucide-react first:

```bash
cd frontend
npm install lucide-react
```

Create `frontend/components/shell/ThemeToggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@mui/material";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
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
```

- [ ] **Step 11: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/shell/ThemeToggle.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 12: Install MUI and wire the root layout**

```bash
cd frontend
npm install @mui/material @mui/material-nextjs @emotion/react @emotion/styled geist
```

Replace the entire contents of `frontend/app/layout.tsx`:

```tsx
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
```

- [ ] **Step 13: Run the full test suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: all tests pass (6 total: 1 smoke + 3 `resolveInitialTheme` + 2 `ThemeToggle`); build and lint clean.

- [ ] **Step 14: Commit**

```bash
git add frontend/
git commit -m "feat: theme tokens, no-flash script, and MUI theming"
```

---

### Task 3: Shell navigation with role-gated Admin item

**Files:**
- Create: `frontend/lib/auth/role-stub.ts`
- Create: `frontend/components/shell/navItems.ts`
- Create: `frontend/components/shell/TabBar.tsx`
- Create: `frontend/components/shell/Sidebar.tsx`
- Test: `frontend/components/shell/Sidebar.test.tsx`
- Test: `frontend/components/shell/TabBar.test.tsx`
- Create: `frontend/app/(shell)/layout.tsx`
- Create: `frontend/app/(shell)/today/page.tsx`
- Create: `frontend/app/(shell)/portfolio/page.tsx`
- Create: `frontend/app/(shell)/chat/page.tsx`
- Create: `frontend/app/(shell)/more/preferences/page.tsx`
- Create: `frontend/app/(shell)/more/backtests/page.tsx`
- Create: `frontend/app/(shell)/more/account/page.tsx`
- Create: `frontend/app/(shell)/admin/page.tsx`
- Create: `frontend/app/login/page.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` from `frontend/components/shell/ThemeToggle.tsx` (Task 2).
- Produces: `getCurrentRole(): "admin" | "user"` (temporary stub, replaced by sub-project 4's real session check — later tasks in THIS plan and later sub-projects must call this exact function name so the eventual replacement is a one-file change); `PHONE_TABS`/`DESKTOP_SECTIONS: NavItem[]`; `<TabBar role>`/`<Sidebar role>`.

- [ ] **Step 1: Write the role stub**

Create `frontend/lib/auth/role-stub.ts`:

```typescript
// Temporary: returns a fixed role so the shell's nav can be built and tested now.
// Sub-project 4 replaces this with a real Supabase-session-backed role lookup, keeping the
// same function name and return type so nothing that calls it needs to change.
export type Role = "admin" | "user";

export function getCurrentRole(): Role {
  return "user";
}
```

- [ ] **Step 2: Write the shared nav item list**

Create `frontend/components/shell/navItems.ts`:

```typescript
import type { LucideIcon } from "lucide-react";
import { Home, PieChart, MessageCircle, MoreHorizontal, Shield, SlidersHorizontal, History, UserRound } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const PHONE_TABS: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Portfolio", href: "/portfolio", icon: PieChart },
  { label: "Chat", href: "/chat", icon: MessageCircle },
  { label: "More", href: "/more/preferences", icon: MoreHorizontal },
];

export const DESKTOP_SECTIONS: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Portfolio", href: "/portfolio", icon: PieChart },
  { label: "Chat", href: "/chat", icon: MessageCircle },
  { label: "Preferences", href: "/more/preferences", icon: SlidersHorizontal },
  { label: "Backtests", href: "/more/backtests", icon: History },
  { label: "Account", href: "/more/account", icon: UserRound },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];
```

- [ ] **Step 3: Write the failing tests for `Sidebar` and `TabBar`**

Create `frontend/components/shell/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("does not show the Admin item for a non-admin role", () => {
    render(<Sidebar role="user" />);
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin item for an admin role", () => {
    render(<Sidebar role="admin" />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("always shows the non-admin sections", () => {
    render(<Sidebar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
  });
});
```

Create `frontend/components/shell/TabBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders the four phone tabs regardless of role", () => {
    render(<TabBar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /more/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npx vitest run components/shell/Sidebar.test.tsx components/shell/TabBar.test.tsx`
Expected: FAIL — neither component exists yet.

- [ ] **Step 5: Implement `Sidebar` and `TabBar`**

Create `frontend/components/shell/Sidebar.tsx`:

```tsx
import Link from "next/link";
import { Box, List, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { DESKTOP_SECTIONS, type NavItem } from "./navItems";
import type { Role } from "@/lib/auth/role-stub";

export function Sidebar({ role }: { role: Role }) {
  const items = DESKTOP_SECTIONS.filter((item: NavItem) => !item.adminOnly || role === "admin");

  return (
    <Box
      component="nav"
      sx={{
        width: 218,
        borderRight: "1px solid var(--line)",
        display: { xs: "none", md: "block" },
      }}
    >
      <List>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <ListItemButton key={item.href} component={Link} href={item.href}>
              <ListItemIcon>
                <Icon size={18} strokeWidth={1.75} />
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
```

Create `frontend/components/shell/TabBar.tsx`:

```tsx
import Link from "next/link";
import { Box } from "@mui/material";
import { PHONE_TABS } from "./navItems";
import type { Role } from "@/lib/auth/role-stub";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- role kept in the signature so
// a later sub-project can add a phone-only admin affordance without changing every call site.
export function TabBar({ role }: { role: Role }) {
  return (
    <Box
      component="nav"
      sx={{
        display: { xs: "flex", md: "none" },
        justifyContent: "space-around",
        borderTop: "1px solid var(--line)",
        position: "sticky",
        bottom: 0,
        background: "var(--panel)",
        backdropFilter: "blur(20px)",
      }}
    >
      {PHONE_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </Link>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run components/shell/Sidebar.test.tsx components/shell/TabBar.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the shell layout**

Create `frontend/app/(shell)/layout.tsx`:

```tsx
import { Box } from "@mui/material";
import { getCurrentRole } from "@/lib/auth/role-stub";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const role = getCurrentRole();

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar role={role} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2 }}>
          <ThemeToggle />
        </Box>
        <Box component="main" sx={{ flex: 1, p: 2 }}>
          {children}
        </Box>
        <TabBar role={role} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 8: Write the placeholder pages**

Create `frontend/app/(shell)/today/page.tsx`:

```tsx
export default function TodayPage() {
  return (
    <div>
      <h1>Today</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 5.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/portfolio/page.tsx`:

```tsx
export default function PortfolioPage() {
  return (
    <div>
      <h1>Portfolio</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 6.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/chat/page.tsx`:

```tsx
export default function ChatPage() {
  return (
    <div>
      <h1>Chat</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 7.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/more/preferences/page.tsx`:

```tsx
export default function PreferencesPage() {
  return (
    <div>
      <h1>Preferences</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 8.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/more/backtests/page.tsx`:

```tsx
export default function BacktestsPage() {
  return (
    <div>
      <h1>Backtests</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 8.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/more/account/page.tsx`:

```tsx
export default function AccountPage() {
  return (
    <div>
      <h1>Account</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 8.</p>
    </div>
  );
}
```

Create `frontend/app/(shell)/admin/page.tsx`:

```tsx
export default function AdminPage() {
  return (
    <div>
      <h1>Admin</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 4.</p>
    </div>
  );
}
```

Create `frontend/app/login/page.tsx` (outside the `(shell)` route group — no tab bar/sidebar on the login screen):

```tsx
export default function LoginPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Log in</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 4.</p>
    </div>
  );
}
```

- [ ] **Step 9: Run the full test suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: all tests pass (10 total: prior 6 + 4 new shell tests); build succeeds (every placeholder route compiles); lint clean.

- [ ] **Step 10: Manually verify the shell in the browser**

```bash
cd frontend
npm run dev
```

Visit `http://localhost:3000` — confirm it redirects to `/today`, the sidebar (desktop width) or tab bar (narrow window) shows Today/Portfolio/Chat/Preferences (no Admin, since the stub returns `"user"`), the theme toggle flips instantly with no visible flash on manual reload after toggling, and `/login` renders without the shell chrome.

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat: shell navigation with role-gated Admin item and placeholder routes"
```

---

### Task 4: Supabase clients and the typed API fetch wrapper

**Files:**
- Create: `frontend/lib/supabase/client.ts`
- Create: `frontend/lib/supabase/server.ts`
- Create: `frontend/lib/api/client.ts`
- Test: `frontend/lib/api/client.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `createClient()` (browser, `lib/supabase/client.ts`) and `createClient()` (server, `lib/supabase/server.ts` — same name, different module, matching `@supabase/ssr`'s own convention so callers import whichever one matches their context); `ApiError extends Error { status: number; detail: string }`; `apiFetch<T>(path: string, init？: RequestInit): Promise<T>`, generic and with no compile-time dependency on `lib/api/types.generated.ts` (callers in later sub-projects supply `T` themselves once that file exists).

- [ ] **Step 1: Install the Supabase SSR package**

```bash
cd frontend
npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Write the Supabase clients**

Create `frontend/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Create `frontend/lib/supabase/server.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies can't be written; a middleware
            // (added when sub-project 4 builds real auth) refreshes the session instead.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Write the failing tests for `apiFetch`**

Create `frontend/lib/api/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "./client";

function mockSession(accessToken: string | null) {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken } : null },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, not the real client shape
  } as any);
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  });

  it("attaches the bearer token when a session exists", async () => {
    mockSession("test-token");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/portfolio/holdings");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("omits the Authorization header entirely when there is no session", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetch("/health");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers as Record<string, string>).not.toHaveProperty("Authorization");
  });

  it("parses the backend's error detail on a non-2xx response", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }),
    );

    const promise = apiFetch("/portfolio/holdings");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 401, detail: "Not authenticated" });
  });

  it("falls back to the response's status text when the error body isn't JSON", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }));

    await expect(apiFetch("/portfolio/holdings")).rejects.toMatchObject({
      status: 502,
      detail: "Bad Gateway",
    });
  });

  it("returns parsed JSON on success", async () => {
    mockSession(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    const result = await apiFetch<{ status: string }>("/health");
    expect(result).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: FAIL — `lib/api/client.ts` does not exist yet.

- [ ] **Step 5: Implement `apiFetch`**

Create `frontend/lib/api/client.ts`:

```typescript
import { createClient } from "@/lib/supabase/client";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }

  const authHeader = await getAuthHeader();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // Error body wasn't JSON (a proxy error page, a timeout) — statusText is still useful.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Add the type-generation script**

```bash
cd frontend
npm install --save-dev openapi-typescript
```

Add to `frontend/package.json`'s `"scripts"` block:

```json
"gen:types": "openapi-typescript http://localhost:8000/openapi.json -o lib/api/types.generated.ts"
```

- [ ] **Step 8: Run the full test suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
```

Expected: all tests pass (15 total); build and lint clean. (`npm run gen:types` is NOT run as part of this — it requires a locally running backend and is a manual dev-time command, verified separately in Task 5's definition-of-done check.)

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat: Supabase clients and a typed API fetch wrapper"
```

---

### Task 5: CI, `frontend/CLAUDE.md`, and final verification

**Files:**
- Create: `.github/workflows/frontend-ci.yml`
- Create: `frontend/CLAUDE.md`

**Interfaces:**
- Consumes: `npm run lint`, `tsc --noEmit` (add as a `typecheck` script if not already present from `create-next-app`), `npm test` — all from Tasks 1-4.

- [ ] **Step 1: Add a `typecheck` script**

Confirm `frontend/package.json`'s `"scripts"` block has:

```json
"typecheck": "tsc --noEmit"
```

(Add it if `create-next-app` didn't.)

- [ ] **Step 2: Write `frontend-ci.yml`**

Create `.github/workflows/frontend-ci.yml`, mirroring `backend-ci.yml`'s shape:

```yaml
name: Frontend CI

on:
  push:
    branches: [master, main]
    paths:
      - "frontend/**"
      - ".github/workflows/frontend-ci.yml"
  pull_request:
    paths:
      - "frontend/**"
      - ".github/workflows/frontend-ci.yml"

defaults:
  run:
    working-directory: frontend

jobs:
  quality:
    name: Lint, type-check, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_API_URL: "http://localhost:8000"
          NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co"
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder"

  security:
    name: Dependency audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Dependency vulnerability scan
        run: npm audit --audit-level=high

  secrets-scan:
    name: Secret scan (gitleaks)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - name: Install gitleaks
        env:
          GITLEAKS_VERSION: "8.30.1"
        run: |
          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o gitleaks.tar.gz
          tar -xzf gitleaks.tar.gz gitleaks
          sudo mv gitleaks /usr/local/bin/
      - name: Run gitleaks
        run: gitleaks detect --source . --redact -v
```

(The build step needs dummy Supabase env values since `createBrowserClient`/`createServerClient` read them at module-eval time in some code paths — placeholders are fine here since no page in this cycle actually calls Supabase at build time, but `next build` still evaluates the modules.)

- [ ] **Step 3: Create the empty `frontend/CLAUDE.md`**

Create `frontend/CLAUDE.md`:

```markdown
```

(Genuinely empty — the project owner supplies its content later. This file exists only so root `CLAUDE.md`'s `frontend/` → `frontend/CLAUDE.md` reference resolves.)

- [ ] **Step 4: Run the full local suite one more time**

```bash
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four pass cleanly.

- [ ] **Step 5: Verify `gen:types` against a running backend (manual, not CI)**

In one terminal:

```bash
cd backend
docker compose up -d
uv run uvicorn app.main:app --reload
```

In another terminal:

```bash
cd frontend
npm run gen:types
```

Expected: `lib/api/types.generated.ts` is created (and is already gitignored, so `git status` shows nothing new). Confirm the file contains recognizable type names from the backend's schemas (e.g. `HoldingOut`, `AdminUserOut`) before moving on — this is the plan's proof that codegen actually talks to the real backend, not just that the command exits zero.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/frontend-ci.yml frontend/CLAUDE.md frontend/package.json
git commit -m "chore: add frontend CI and an empty frontend/CLAUDE.md"
```

---

## Self-Review Notes

**Spec coverage:** every "In scope" bullet from the design spec maps to a task — scaffold/Tailwind/MUI (Task 1-2), tokens/no-flash/toggle (Task 2), shell + placeholders (Task 3), Supabase clients + API client + type generation (Task 4), tests + CI + empty `frontend/CLAUDE.md` (Task 1-5 collectively).

**Type consistency:** `getCurrentRole(): Role` (Task 3) is the one name every later sub-project's real auth check must preserve; `apiFetch<T>` (Task 4) is generic with no hard dependency on `types.generated.ts`, so later sub-projects supply their own `T` once that file exists locally.

**Review Focus:** all five items have an owning task and test — theme fallback/persistence (`resolveInitialTheme.test.ts`, Task 2), storage-unavailable resilience (`ThemeToggle.test.tsx`'s second test, Task 2), Admin nav gating (`Sidebar.test.tsx`, Task 3), missing-session header omission and non-JSON error fallback (`client.test.ts`, Task 4).
