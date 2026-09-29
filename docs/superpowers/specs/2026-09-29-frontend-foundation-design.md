# Frontend foundation (sub-project 3)

Status: design approved in the brainstorming session on 2026-09-29. Third sub-project of the frontend
roadmap in `2026-09-28-frontend-design-direction-design.md` (sub-project 1: design direction, approved
and built as mockups).

- **1 Design direction:** done (visual direction "Emerald Glass", screens, copy/accessibility rules;
  reference mockups in `docs/design/mockups/`).
- **2 Auth and multi-user backend:** done (2a auth core, 2b admin/invitations, 2c limits/usage — PRs #21,
  #22, #23).
- **3 Frontend foundation (this spec):** scaffold, shell, tokens/theme, API client and types,
  `frontend-ci.yml`, `frontend/CLAUDE.md`.
- **4-8:** login/admin screens, recommendations workflow, portfolio, chat, secondary screens — each its
  own spec/plan/cycle, all building on this one.

## Understanding

This cycle builds no user-facing screens. It builds the layer every later frontend cycle depends on: a
working Next.js app in `frontend/` that boots, themes correctly (dark/light, no flash), shows the shell
navigation (tab bar on phone, sidebar on desktop) with placeholder destinations, can call the FastAPI
backend with a typed client and an attached auth token, and has CI, tests, and a docs entry point in
place. Success: a later cycle can start writing a real screen on day one instead of first solving
scaffolding, theming, or API-typing problems.

Constraints carried from `PRODUCT.md`, root `CLAUDE.md`, and the design-direction spec: the system never
places a trade — no execution UI, ever; phone-first with a desktop layout; the approved "Emerald Glass"
visual direction (dark/light, glass panels, custom radii, tabular numerals) is the target look, not
Material Design's own; path-filtered CI so a frontend-only change doesn't trigger the backend build;
never commit `.env`/secrets.

## Scope

In scope:

- `create-next-app` scaffold in `frontend/` (Next.js 15, App Router, TypeScript, npm).
- MUI (`@mui/material` + `@mui/material-nextjs`) for interactive component behavior, themed via a single
  `createTheme` built from the spec's CSS-variable tokens so it matches the approved mockups, not MUI's
  own Material Design defaults. `lucide-react` for icons.
- Tailwind CSS 4 for layout/spacing utilities (already the decided stack per `PRODUCT.md`), preflight
  disabled so it doesn't collide with MUI's own baseline reset.
- Dark/light theme tokens as CSS custom properties, the no-flash pre-paint script, the header toggle.
- The app shell: tab bar (phone) / sidebar (desktop) chrome, with placeholder route pages for every
  destination sub-projects 4-8 will fill in, so the shell's navigation is visibly testable now.
- `lib/api/client.ts`: a typed fetch wrapper that attaches a Supabase bearer token and parses the
  backend's `{"detail": ...}` error shape.
- `@supabase/ssr` for the browser/server Supabase clients (login/session itself is sub-project 4's job;
  this cycle only wires the client the API wrapper reads a token from).
- TypeScript types generated from the backend's OpenAPI schema via `openapi-typescript`.
- Vitest + React Testing Library, wired into `frontend-ci.yml`, with smoke tests proving the pipeline
  (theme toggle, API client error parsing, shell nav-by-role).
- `frontend-ci.yml`, mirroring `backend-ci.yml`'s shape (path-filtered, lint/typecheck/test job,
  dependency audit, secrets scan).
- An empty `frontend/CLAUDE.md` (content supplied by the project owner afterward — this cycle only
  creates the file so root `CLAUDE.md`'s reference to it resolves).

Out of scope: any real screen content (sub-projects 4-8); login/session logic itself (sub-project 4);
`DESIGN.md` (impeccable's implementation-facing record, written from the built components once this
foundation exists, not from mockups — noted as a follow-up, not part of this cycle); deployment
configuration beyond what CI needs (Vercel project setup is an owner action, not code).

## Design

### Stack and theming

Next.js 15 (App Router) + TypeScript, npm. Fonts: Geist (400/500/600/700) via `next/font/local`, static
files in `public/fonts/`, system sans fallback.

Every visual property routes through one MUI theme (`lib/theme.ts`, `createTheme`) that reads the same
CSS custom properties the mockups define (`--bg`, `--accent`, `--panel`, etc.) rather than duplicating
color values: `palette` maps to `--accent`/`--up`/`--down`/`--warn`, `shape.borderRadius: 18` matches the
spec's panel radius, and `components.{MuiPaper,MuiDrawer,MuiChip,...}.styleOverrides` reproduce the
glass-panel look (translucent fill, hairline border, blur, soft shadow) and pill/chip shapes so a themed
MUI component matches the approved mockups without per-instance overrides. `lucide-react` icons are used
at the spec's approximate stroke weight (`strokeWidth={1.75}`).

Tokens themselves live in `app/globals.css` as CSS custom properties, dark under `:root` and light under
`:root[data-theme="light"]`, copied verbatim from the spec's token table. A pre-paint inline script in
`app/layout.tsx`'s `<head>` reads `localStorage`, falls back to `prefers-color-scheme`, and sets
`data-theme` on `<html>` before first paint — no flash. `ThemeToggle` (`components/shell/`) flips the
attribute, persists the choice, and is honored by the client-side `ThemeProvider` that rebuilds the MUI
theme object from the current CSS variable values on toggle, so MUI and Tailwind/CSS never drift apart.
Motion respects `prefers-reduced-motion`, per the spec.

Tailwind's `corePlugins.preflight` is disabled (MUI's own CSS baseline already normalizes elements);
Tailwind utility classes remain available for layout/spacing throughout.

### File structure

```
frontend/
  app/
    layout.tsx              # theme script, fonts, MUI ThemeProvider, SWR provider
    globals.css              # CSS variables (both themes), Tailwind directives
    (shell)/
      layout.tsx              # shell chrome: TabBar (phone) / Sidebar (desktop)
      today/page.tsx           # placeholder — sub-project 5
      portfolio/page.tsx       # placeholder — sub-project 6
      chat/page.tsx            # placeholder — sub-project 7
      more/
        preferences/page.tsx    # placeholder — sub-project 8
        backtests/page.tsx      # placeholder — sub-project 8
        account/page.tsx        # placeholder — sub-project 8
      admin/page.tsx           # placeholder — sub-project 4; nav item shown only for role=admin
    login/page.tsx            # placeholder — sub-project 4
  components/
    shell/                    # TabBar, Sidebar, ThemeToggle
    ui/                       # thin wrappers where the theme alone isn't enough (e.g. Sparkline svg)
  lib/
    api/
      client.ts                # fetch wrapper: bearer token, base URL, ApiError shape
      types.generated.ts       # openapi-typescript output (generated, see below)
    supabase/
      client.ts                # browser client (@supabase/ssr createBrowserClient)
      server.ts                # server client, for server components/actions
    theme.ts                  # MUI createTheme reading the CSS variables
  public/fonts/
  frontend/CLAUDE.md          # empty; content supplied later by the project owner
  package.json / tsconfig.json / next.config.ts / tailwind.config.ts / vitest.config.ts / .env.example
```

Placeholder pages render only a heading and "Coming in sub-project N" — enough for the shell's navigation
to be visibly, testably real, without building anything sub-projects 4-8 own.

### API client and types

`npm run gen:types` runs `openapi-typescript` against the backend's `/openapi.json` (requires a running
local backend — documented in `frontend/CLAUDE.md`'s eventual content, and in this cycle's plan for
now) and writes `lib/api/types.generated.ts`, gitignored and regenerated on demand — not checked in, so
it can never silently drift stale in git while still being fast to regenerate.

`lib/api/client.ts` is a thin, generic `fetch` wrapper: reads `NEXT_PUBLIC_API_URL`, attaches
`Authorization: Bearer <token>` from the current Supabase session (`lib/supabase/client.ts`), and parses
FastAPI's `{"detail": "..."}` error shape into a typed `ApiError`. No SWR hooks or endpoint-specific
functions ship in this cycle — those arrive with each screen's own sub-project — only the wrapper
function itself, proven against the real `/health` endpoint.

### Shell

`(shell)/layout.tsx` renders `TabBar` at phone widths and `Sidebar` at desktop widths (media query /
`useMediaQuery`, matching the spec's breakpoint), listing the spec's four phone tabs (Today, Portfolio,
Chat, More) and the desktop sidebar's full section list plus an "Administration" group. The Admin nav
item's visibility is role-gated, but the actual role check is a stub in this cycle (no real auth exists
yet) — sub-project 4 wires it to a real session.

### Testing and CI

Vitest (jsdom) + React Testing Library. Three smoke tests prove the pipeline, not real behavior:
`ThemeToggle` flips and persists `data-theme`; `client.ts` correctly parses a mocked 404 into `ApiError`;
the shell renders the admin nav item only when the role stub says admin. `frontend-ci.yml` mirrors
`backend-ci.yml`: path-filtered on `frontend/**` plus its own workflow file; a quality job
(`npm run lint`, `tsc --noEmit`, `npm test`); a dependency-audit job (`npm audit --audit-level=high`); a
secrets-scan job (gitleaks, same approach as the backend's).

### `frontend/CLAUDE.md`

Created empty in this cycle. The project owner supplies its content (conventions, commands, rules)
afterward — this cycle's only obligation is that the file exists, since root `CLAUDE.md` already points
to it.

## Definition of done

- `npm run lint`, `tsc --noEmit`, and `npm test` pass in `frontend/`.
- The app boots locally (`npm run dev`), shows the shell with working theme toggle and no flash on
  reload, and every placeholder route is reachable from the nav.
- `npm run gen:types` succeeds against a locally running backend.
- `frontend-ci.yml` passes on a pushed branch (path-filtered correctly — a backend-only change does not
  trigger it, and vice versa).
- No secrets committed; Conventional Commits; `frontend/CLAUDE.md` exists (empty is acceptable for this
  cycle).

## Risks

- MUI's default styling engine (Emotion) plus Tailwind is a real but well-trodden combination; the main
  risk is style-injection order in the App Router (addressed by `@mui/material-nextjs`'s
  `AppRouterCacheProvider`, the officially documented approach) rather than anything novel to this
  project.
- Generated types depend on a running local backend at generation time; if the backend's OpenAPI schema
  changes shape in a later cycle without regenerating, the frontend's types silently go stale until the
  next `npm run gen:types` run. Mitigated by documenting the command prominently and, if it becomes a
  real problem later, running generation in CI as a drift-check (not part of this cycle).
- The MUI theme reproducing the mockups' glass-panel look precisely (blur, exact translucency, hairline
  borders) is themeable but not automatic — the plan should budget real time for matching
  `components.styleOverrides` against the mockups, not assume `createTheme` alone gets there.
