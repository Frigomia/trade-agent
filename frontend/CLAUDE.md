# Frontend — Next.js, TypeScript

## Stack

Next.js 16 (App Router) · TypeScript strict · MUI 9 (the component library and
theme) · SWR (reads and job polling) · Supabase Auth (browser client plus SSR
helpers) · `d3-scale` and `d3-shape` (chart maths only) · Vitest + React Testing
Library · npm.

Tailwind v4 is installed and its theme/utilities layers are imported in
`app/globals.css`, but nothing is styled with it: styling is MUI `sx` and the
theme, driven by CSS variables (`--bg`, `--accent`, `--up`, `--down`, ...).
Don't start writing Tailwind classes unless asked.

The visual design system (tokens, colours, type, components, do's and don'ts) is
recorded in [`../DESIGN.md`](../DESIGN.md); read it before building or restyling a screen.

**Do not introduce, unless explicitly asked:** Redux or any global state
library, styled-components/CSS Modules, a second component library next to MUI,
a chart library (charts are hand-built SVG; d3 modules only compute numbers),
Axios (use `apiFetch`).

## Commands

| Task          | Command                                                         |
| ------------- | --------------------------------------------------------------- |
| Dev / build   | `npm run dev` / `npm run build`                                 |
| Lint          | `npm run lint`                                                  |
| Type check    | `npx tsc --noEmit`                                              |
| Test all / one | `npm test` (Vitest, runs once) / `npx vitest run path/to/file` |

Lint + typecheck + tests + `npm run build` before treating any change as done.

## Structure

```
app/          routes (App Router); (shell)/ holds the signed-in screens
              (today, portfolio, chat, more/*, admin/*)
components/   UI, grouped by area: admin, portfolio, recommendations, shell,
              settings, account, backtests
lib/          api/ (apiFetch client + per-area types), auth/, supabase/, theme/,
              and shared logic and hooks (format, useAction, trackRecord, ...);
              each has its test file next to it
proxy.ts      Next.js proxy (formerly middleware): refreshes the Supabase
              session and protects routes
```

## Patterns to follow

- **Server Components by default** — `"use client"` only where actual
  interactivity lives (forms, chat panel, click handlers)
- **Named exports**, not default exports — except files Next requires to be
  default (`page.tsx`, `layout.tsx`, ...)
- **All backend calls through `apiFetch`** in `lib/api/client.ts` (`ApiError`
  carries `status` and `detail`) — no bare `fetch()` in components
- Reads with SWR; submits with `useAction` (`lib/useAction.ts`): one request at
  a time, error text from `ApiError.detail`, callbacks inside the action
- Put pure logic (scoring, validation, formatting, chart geometry) in `lib/` as
  small tested functions, not inside components
- Colocate types with their usage; API response types live in
  `lib/api/*-types.ts`, one file per area — no dumping-ground `types.ts`
- Extract a custom hook once stateful logic is used twice, not before
- Narrow `unknown` before use; never widen a type error away with `any`
- Numbers carry no currency symbol; use `formatAmount` / `formatSigned` /
  `formatPct` from `lib/format.ts`
- Colours come from the CSS variables and the MUI theme, never hard-coded hex
  in a component. The theme flips through `data-theme` on `<html>` (a no-flash
  script in `app/layout.tsx`); `ThemeProvider` observes it
- This system never places a trade: no Buy / Sell / Deposit / Withdraw
  controls. Decisions are Approve / Dismiss; trades are logged in the past tense

## MUI 9 notes

- `TextField`: use `slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { ... } }}`;
  `SelectProps` and `InputLabelProps` no longer exist
- `Stack` takes `justifyContent` / `alignItems` through `sx`, not as props
- `Chip` has no `deleteIcon` slot prop; pass the `deleteIcon` element itself

## Patterns to avoid

- **`useEffect` for anything derivable during render**, or for data
  already available via SWR/Server Components. Before adding an effect:
  "could this just be computed during render instead?" — this is the most
  common React anti-pattern and the one most worth catching in review.
- Calling `Date.now()` / `new Date()` during render (the React purity lint
  rejects it): use a lazy initialiser, `useState(() => Date.now())`
- Calling `setState` straight inside an effect (also linted): when syncing from
  an external system such as the DOM, do it in a named function the effect calls
- Fetching in `useEffect` when a Server Component or SWR call avoids the
  loading-flash entirely
- d3 selecting or mutating the DOM — React renders every element
- Prop drilling past 2 levels — lift state or use context instead
- `any` — use `unknown` and narrow, or write the interface
- Array index as `key` on a list that can reorder or filter

## Accessibility (minimum bar)

- Icon-only buttons get `aria-label`
- Semantic elements (`<button>`, not `<div onClick>`); one `h1` per page
- Every list item has a stable, unique `key`
- Colour is never the only carrier of meaning: up/down and status always come
  with a sign, a word or a shape
- Charts have a text alternative (the numbers appear beside them) and work from
  the keyboard

## Next.js's own agent-file management

Recent Next.js versions auto-generate/update a managed block here
(`<!-- BEGIN:nextjs-agent-rules -->`) with version-specific guidance,
regenerated by `next dev`. Leave it in place if it appears; add
project-specific rules outside it.

## Testing

Vitest + React Testing Library (jsdom), tests next to the code as
`*.test.ts(x)`; run with `npm test`. Conventions:

- Mock the API with `vi.mock("@/lib/api/client", ...)`: an `apiFetch` mock keyed
  by path, and a `FakeApiError` created in `vi.hoisted`
- Wrap a page in `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>`
  so every test gets a fresh cache
- Fake only what the test needs: `vi.useFakeTimers({ toFake: ["Date"] })` for
  date logic; polling tests fake all timers, step with
  `vi.advanceTimersByTimeAsync`, and restore real timers in `afterEach`.
  `vitest.setup.ts` shims `jest` so RTL's `waitFor` works with fake timers
- Mock browser-only or Supabase modules (`@/lib/supabase/client`,
  `next/navigation`) at the top of the test file
- UI changes also get a real browser pass against the dev server before they
  count as done

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
