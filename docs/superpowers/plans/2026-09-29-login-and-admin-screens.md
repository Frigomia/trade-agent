# Login and Admin Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder login/admin pages and the temporary role stub with real Supabase authentication (login, accept invitation, password reset), server-side route protection, and the full admin user-management surface against the existing `/admin/*` API.

**Architecture:** A `proxy.ts` (Next 16's replacement for the deprecated `middleware.ts`) refreshes the Supabase session cookie on every request; `app/(shell)/layout.tsx` and a new `app/(shell)/admin/layout.tsx` become async Server Components that resolve the real session server-side and redirect when it's missing or insufficient; the three auth pages are Client Components using the Supabase browser client directly; the admin screens use SWR (first real use of the dependency) for data fetching and mutation-then-revalidate.

**Tech Stack:** Next.js 16 (App Router), `@supabase/ssr`, MUI (themed per PR #24), SWR, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-login-and-admin-screens-design.md`

## Global Constraints

- The system never places a trade — no execution UI anywhere in this plan.
- The admin never sees financial data — the admin screens touch only `AdminUserOut` fields (access/usage data), never portfolios, recommendations, or chats.
- Every color/shadow/radius comes from the CSS custom properties or the MUI theme already built in PR #24 — never a new hard-coded hex value. If a new MUI component throws `"MUI: Unsupported var(...) color"`, extend `readStatusColors`/`buildMuiTheme` the same way PR #24's final fix wave did — do not hardcode a literal color as a one-off workaround.
- Route protection file is `proxy.ts` (not `middleware.ts`, deprecated in the installed Next 16.3.7 — confirmed directly against `node_modules/next/dist/lib/constants.js`'s `PROXY_FILENAME` and the deprecation warning in `node_modules/next/dist/build/index.js`), exporting a function named `proxy`.
- `PATCH /admin/users/{id}/limits`'s omitted-vs-explicit-`null` distinction must be preserved exactly: an omitted field in the request body leaves that limit unchanged; an explicit `null` clears the override back to the system default; an integer sets it.
- `DELETE /admin/users/{id}` requires `{ confirm_email }` matching the user's email exactly — the UI's Remove button must stay disabled until the typed value matches.
- Calm, generic error messages: backend errors surface via `ApiError.detail` (already built in PR #24, including the FastAPI 422-array-join fix); Supabase auth errors get their own inline messages, never a raw SDK error string.
- No secrets or `.env` values committed; Conventional Commits.

## Review Focus

- A non-admin visiting `/admin` directly by URL, even while authenticated, must be redirected — the exact gap PR #24's final review flagged (today `/admin` is reachable with no guard, only hidden from the nav).
- An unauthenticated visit to any `(shell)` route must redirect to `/login` before any protected content is sent — a server-side check, not a client-side flash-then-redirect.
- An `invited` (not yet `active`) user who somehow holds a valid Supabase session must not reach the shell — treated the same as unauthenticated, redirected to `/login`.
- Clearing a limit override (an explicit `null` in the `PATCH` body) must be visibly distinct in the UI from simply not touching that field — the backend's own hard-won distinction (PR #23's final fix wave) must not get blurred back together by a UI that always sends both fields.
- The remove-user confirmation button must stay disabled until the typed email exactly equals the target user's email — the one destructive, irreversible action in this plan.

---

### Task 1: Server-side API client and session resolution

**Files:**
- Modify: `frontend/lib/api/client.ts`
- Test: `frontend/lib/api/client.test.ts`
- Create: `frontend/lib/auth/session.ts`
- Test: `frontend/lib/auth/session.test.ts`
- Delete: `frontend/lib/auth/role-stub.ts`
- Modify: `frontend/components/shell/Sidebar.tsx`
- Modify: `frontend/components/shell/TabBar.tsx`

**Interfaces:**
- Consumes: `createClient` from `frontend/lib/supabase/server.ts` (already built in PR #24, unchanged).
- Produces: `apiFetchServer<T>(path: string, accessToken: string, init?: RequestInit): Promise<T>` (same `ApiError` as `apiFetch`); `resolveSession(): Promise<SessionInfo | null>` where `SessionInfo = { userId: string; email: string; role: "admin" | "user"; status: string }`; `Role = "admin" | "user"` (moved from the deleted `role-stub.ts`, same name, same type — later tasks import it from `@/lib/auth/session`).

- [ ] **Step 1: Extract the shared response-handling logic in `client.ts`**

The current `apiFetch` inlines its error-parsing and header-building logic. Extract two helpers so a new `apiFetchServer` can reuse them instead of duplicating. Replace the whole of `frontend/lib/api/client.ts`:

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

function buildHeaders(init: RequestInit, authorization?: string): Headers {
  // Built through the Headers constructor (not object spread) so caller-supplied headers work
  // regardless of whether init.headers is a plain object, a Headers instance, or a tuple array —
  // object spread only handles the plain-object shape and silently drops the other two.
  const headers = new Headers(init.headers);
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  // Skipped for FormData bodies: the browser needs to set its own multipart boundary in
  // Content-Type, which a force-set "application/json" would stomp on.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string | { msg: string }[] };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI's default 422 validation-error shape: { detail: [{ loc, msg, type }, ...] }.
        detail = body.detail.map((error) => error.msg).join("; ");
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

function requireBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  return baseUrl;
}

/** Browser-only: reads the auth token from the current Supabase browser session. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = requireBaseUrl();
  const authHeader = await getAuthHeader();
  const headers = buildHeaders(init, authHeader.Authorization);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return handleApiResponse<T>(response);
}

/**
 * Server-only: for Server Components/proxy.ts, which don't have the browser Supabase client's
 * session available and must pass an explicit access token instead (from the server Supabase
 * client, see lib/supabase/server.ts). Same ApiError/error-parsing logic as apiFetch — the only
 * difference is where the token comes from.
 */
export async function apiFetchServer<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = requireBaseUrl();
  const headers = buildHeaders(init, `Bearer ${accessToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return handleApiResponse<T>(response);
}
```

- [ ] **Step 2: Run the existing `apiFetch` tests to confirm the refactor didn't change behavior**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: all 5 existing tests still PASS unchanged (the refactor is behavior-preserving).

- [ ] **Step 3: Write the failing tests for `apiFetchServer`**

Append to `frontend/lib/api/client.test.ts` (the file already has `vi.mock("@/lib/supabase/client", ...)` and a `mockSession` helper from PR #24 — leave those as-is, they're for `apiFetch`; these new tests don't need Supabase mocked at all since `apiFetchServer` takes the token directly):

```typescript
describe("apiFetchServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  });

  it("attaches the given access token as the bearer header", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await apiFetchServer("/me", "server-token");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).get("Authorization")).toBe("Bearer server-token");
  });

  it("parses the backend's error detail the same way apiFetch does", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "No access to this service" }), { status: 403 }),
    );

    await expect(apiFetchServer("/admin/users", "tok")).rejects.toMatchObject({
      status: 403,
      detail: "No access to this service",
    });
  });

  it("returns parsed JSON on success", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "u1" }), { status: 200 }));

    const result = await apiFetchServer<{ id: string }>("/me", "tok");

    expect(result).toEqual({ id: "u1" });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: the 3 new `apiFetchServer` tests FAIL (function doesn't exist) — Step 1 already implemented it, so this step should actually show them PASS already at this point since Step 1 wrote the implementation first. Confirm all 8 tests (5 original + 3 new) PASS.

- [ ] **Step 5: Write `lib/auth/session.ts`**

Create `frontend/lib/auth/session.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { apiFetchServer } from "@/lib/api/client";

export type Role = "admin" | "user";

export interface SessionInfo {
  userId: string;
  email: string;
  role: Role;
  status: string;
}

interface MeResponse {
  id: string;
  email: string;
  role: string;
  status: string;
  accepted_terms_at: string | null;
}

/**
 * Resolves the caller's identity server-side, or null if there's no valid, active-enough
 * session. Any failure — no Supabase session, an expired token, the backend rejecting the token
 * (a disabled user gets 403 from GET /me), a backend outage — is treated the same way: no
 * session. This keeps the shell/admin layouts' own logic to one check ("is this null?") instead
 * of distinguishing failure classes a visitor can't act on differently anyway — they see the
 * same calm "please sign in" redirect either way.
 */
export async function resolveSession(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return null;
  }

  try {
    const me = await apiFetchServer<MeResponse>("/me", session.access_token);
    return {
      userId: me.id,
      email: me.email,
      role: me.role === "admin" ? "admin" : "user",
      status: me.status,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Write the failing tests for `resolveSession`**

Create `frontend/lib/auth/session.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetchServer: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { apiFetchServer } from "@/lib/api/client";
import { resolveSession } from "./session";

function mockSupabaseSession(session: { access_token: string } | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, not the real client shape
  vi.mocked(createClient).mockResolvedValue({
    auth: { getSession: async () => ({ data: { session } }) },
  } as any);
}

describe("resolveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no Supabase session", async () => {
    mockSupabaseSession(null);

    expect(await resolveSession()).toBeNull();
    expect(apiFetchServer).not.toHaveBeenCalled();
  });

  it("returns the resolved role and status when /me succeeds", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      role: "admin",
      status: "active",
      accepted_terms_at: null,
    });

    const result = await resolveSession();

    expect(result).toEqual({ userId: "u1", email: "a@example.com", role: "admin", status: "active" });
    expect(apiFetchServer).toHaveBeenCalledWith("/me", "tok");
  });

  it("treats a non-admin role string as \"user\"", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
      accepted_terms_at: "2026-01-01T00:00:00",
    });

    expect((await resolveSession())?.role).toBe("user");
  });

  it("returns null when /me rejects the token (e.g. a disabled user)", async () => {
    mockSupabaseSession({ access_token: "tok" });
    vi.mocked(apiFetchServer).mockRejectedValue(new Error("403"));

    expect(await resolveSession()).toBeNull();
  });
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/auth/session.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Delete the role stub and repoint its two importers**

Delete `frontend/lib/auth/role-stub.ts`.

In `frontend/components/shell/Sidebar.tsx`, change:

```typescript
import type { Role } from "@/lib/auth/role-stub";
```

to:

```typescript
import type { Role } from "@/lib/auth/session";
```

Make the identical one-line change in `frontend/components/shell/TabBar.tsx`. No other change to either file — both already just take `role: Role` as a prop. `Sidebar.test.tsx`/`TabBar.test.tsx` pass `role="user"`/`role="admin"` as string literals and don't import `Role` — no change needed there.

- [ ] **Step 9: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass. The build step needs the placeholder Supabase/API env vars (already set locally per PR #24's `.env.local`, or export them inline for this command per `frontend-ci.yml`'s own pattern if running without a local `.env.local`).

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/api/client.ts frontend/lib/api/client.test.ts frontend/lib/auth/session.ts frontend/lib/auth/session.test.ts frontend/components/shell/Sidebar.tsx frontend/components/shell/TabBar.tsx
git rm frontend/lib/auth/role-stub.ts
git commit -m "feat: server-side API client and session resolution"
```

---

### Task 2: `proxy.ts` session refresh

**Files:**
- Create: `frontend/lib/supabase/proxy.ts`
- Test: `frontend/lib/supabase/proxy.test.ts`
- Create: `frontend/proxy.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `updateSession(request: NextRequest): Promise<NextResponse>` — used only by `frontend/proxy.ts` itself, no other task imports it.

- [ ] **Step 1: Write the failing test for `updateSession`**

Create `frontend/lib/supabase/proxy.test.ts`. This file needs Node's `Response`/`Request` globals, not jsdom's — add the pragma comment on line 1 so Vitest runs it under the `node` environment instead of the project's default `jsdom`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

import { NextRequest } from "next/server";
import { updateSession } from "./proxy";

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("calls getUser to trigger a token refresh and returns a response", async () => {
    const request = new NextRequest("https://example.com/today");

    const response = await updateSession(request);

    expect(getUser).toHaveBeenCalled();
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run lib/supabase/proxy.test.ts`
Expected: FAIL — `lib/supabase/proxy.ts` does not exist yet.

- [ ] **Step 3: Implement `updateSession`**

Create `frontend/lib/supabase/proxy.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie if the access token has expired, so Server Components
 * (which can't write cookies themselves — see lib/supabase/server.ts's try/catch) always see a
 * valid session. This does not redirect or protect any route by itself — see
 * app/(shell)/layout.tsx and app/(shell)/admin/layout.tsx for the actual route protection,
 * which runs server-side, after this.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers a token refresh if the current access token is expired; the setAll callback above
  // then writes the refreshed cookie onto the response.
  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run lib/supabase/proxy.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Write `frontend/proxy.ts`**

Create `frontend/proxy.ts` (at the repo root of `frontend/`, alongside `next.config.ts` — confirmed this is the file Next 16.3.7 looks for, exporting a function literally named `proxy`, per `node_modules/next/dist/esm/build/templates/middleware.js`'s `isProxy` branch):

```typescript
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 6: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/supabase/proxy.ts frontend/lib/supabase/proxy.test.ts frontend/proxy.ts
git commit -m "feat: refresh the Supabase session via proxy.ts"
```

---

### Task 3: Shell and admin route protection

**Files:**
- Modify: `frontend/app/(shell)/layout.tsx`
- Test: `frontend/app/(shell)/layout.test.tsx`
- Create: `frontend/app/(shell)/admin/layout.tsx`
- Test: `frontend/app/(shell)/admin/layout.test.tsx`

**Interfaces:**
- Consumes: `resolveSession`, `SessionInfo`, `Role` from `@/lib/auth/session` (Task 1).
- Produces: nothing new for later tasks — this is where the plan's two Review Focus route-protection items get closed.

- [ ] **Step 1: Write the failing tests for `ShellLayout`**

Create `frontend/app/(shell)/layout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ resolveSession: vi.fn() }));
vi.mock("@/components/shell/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/shell/TabBar", () => ({ TabBar: () => null }));
vi.mock("@/components/shell/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import ShellLayout from "./layout";

describe("ShellLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);

    await expect(ShellLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when the session isn't active yet (still invited)", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "invited",
    });

    await expect(ShellLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders the shell for an active session, without redirecting", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
    });

    const result = await ShellLayout({ children: null });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run "app/(shell)/layout.test.tsx"`
Expected: FAIL — `ShellLayout` still uses the deleted `getCurrentRole` stub, not `resolveSession`.

- [ ] **Step 3: Rewrite `app/(shell)/layout.tsx`**

Replace the whole file:

```tsx
import { redirect } from "next/navigation";
import { Box } from "@mui/material";
import { resolveSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();
  if (!session || session.status !== "active") {
    redirect("/login");
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar role={session.role} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2 }}>
          <ThemeToggle />
        </Box>
        <Box component="main" sx={{ flex: 1, p: 2 }}>
          {children}
        </Box>
        <TabBar role={session.role} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run "app/(shell)/layout.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing tests for `AdminLayout`**

Create `frontend/app/(shell)/admin/layout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ resolveSession: vi.fn() }));

import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import AdminLayout from "./layout";

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a non-admin to /today", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "a@example.com",
      role: "user",
      status: "active",
    });

    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/today");
  });

  it("redirects to /today when there is no session at all", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);

    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/today");
  });

  it("renders for an admin, without redirecting", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "u1",
      email: "admin@example.com",
      role: "admin",
      status: "active",
    });

    const result = await AdminLayout({ children: "admin content" });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd frontend && npx vitest run "app/(shell)/admin/layout.test.tsx"`
Expected: FAIL — `app/(shell)/admin/layout.tsx` does not exist yet.

- [ ] **Step 7: Write `app/(shell)/admin/layout.tsx`**

Create the file:

```tsx
import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();
  if (!session || session.role !== "admin") {
    redirect("/today");
  }

  return <>{children}</>;
}
```

(This runs nested inside `(shell)/layout.tsx`, which has already redirected unauthenticated/inactive visitors to `/login` — by the time this layout runs, `session` is non-null in practice. The defensive `!session` check here costs nothing and guards against `resolveSession` ever disagreeing between the two calls. Next's request-level `fetch` memoization means the two `GET /me` calls this causes per admin-route request typically dedupe into one real network call — no extra step needed to force that.)

- [ ] **Step 8: Run to verify it passes**

Run: `cd frontend && npx vitest run "app/(shell)/admin/layout.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 9: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add "frontend/app/(shell)/layout.tsx" "frontend/app/(shell)/layout.test.tsx" "frontend/app/(shell)/admin/layout.tsx" "frontend/app/(shell)/admin/layout.test.tsx"
git commit -m "feat: server-side route protection for the shell and admin routes"
```

---

### Task 4: Login page

**Files:**
- Modify: `frontend/app/login/page.tsx`
- Test: `frontend/app/login/page.test.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client` (browser client, built in PR #24, unchanged).
- Produces: nothing new for later tasks (Task 5 adds its own "Forgot password?" destination page and wires the link on this page).

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/login/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /today on a successful sign-in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@example.com", password: "secret123" });
  });

  it("shows an inline error on a wrong password, and does not redirect", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(/email or password is incorrect/i)).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("links to /reset-password", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/reset-password",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run app/login/page.test.tsx`
Expected: FAIL — the placeholder page has no form.

- [ ] **Step 3: Implement the login page**

Replace the whole of `frontend/app/login/page.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Box, TextField, Button, Alert, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError("Email or password is incorrect. Try again or reset your password.");
      return;
    }
    router.push("/today");
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Sign in
      </Typography>
      <Typography sx={{ color: "var(--muted)", mt: 0.5 }}>to your trade-agent account</Typography>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
        error={Boolean(error)}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
        <Link href="/reset-password" style={{ fontSize: 13 }}>
          Forgot password?
        </Link>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Sign in
      </Button>
      <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 3 }}>
        trade-agent is by invitation only. If you don&apos;t have an account, ask the
        administrator to invite you.
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run app/login/page.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/login/page.test.tsx
git commit -m "feat: real login page against Supabase auth"
```

---

### Task 5: Accept invitation and reset password pages

**Files:**
- Create: `frontend/app/accept-invitation/page.tsx`
- Test: `frontend/app/accept-invitation/page.test.tsx`
- Create: `frontend/app/reset-password/page.tsx`
- Test: `frontend/app/reset-password/page.test.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`; `apiFetch` from `@/lib/api/client` (both from PR #24/Task 1, unchanged).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests for accept-invitation**

Create `frontend/app/accept-invitation/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, updateUser } }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AcceptInvitationPage from "./page";

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an expired-link message when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<AcceptInvitationPage />);

    await waitFor(() =>
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument(),
    );
  });

  it("sets the password and accepts terms on submit", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    updateUser.mockResolvedValue({ error: null });
    apiFetch.mockResolvedValue({ status: "active" });

    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: "verystrongpw123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "verystrongpw123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: "verystrongpw123" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/me/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error and does not submit when the passwords don't match", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: "aaaaaaaaaaaa" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "bbbbbbbbbbbb" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/don't match/i)).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("keeps the submit button disabled until the terms box is checked", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { email: "sara.m@example.com" } } },
    });
    render(<AcceptInvitationPage />);
    await waitFor(() => expect(screen.getByDisplayValue("sara.m@example.com")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run app/accept-invitation/page.test.tsx`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Implement the accept-invitation page**

Create `frontend/app/accept-invitation/page.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  TextField,
  Button,
  Alert,
  Typography,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user.email ?? null);
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError(updateError.message);
      return;
    }
    try {
      await apiFetch("/me/accept", {
        method: "POST",
        body: JSON.stringify({ accept_terms: true }),
      });
      router.push("/today");
    } catch {
      setSubmitting(false);
      setError("Something went wrong recording your acceptance. Try again.");
    }
  }

  if (checkingSession) {
    return null;
  }

  if (!email) {
    return (
      <Box sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Alert severity="warning">
          This invitation link is no longer valid — it may have expired or already been used. Ask
          your administrator to resend it.
        </Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Set your password
      </Typography>
      <Typography sx={{ color: "var(--muted)", mt: 0.5 }}>
        The administrator invited you to trade-agent. This link expires in 24 hours.
      </Typography>
      <TextField label="Email" value={email} fullWidth margin="normal" disabled />
      <TextField
        label="Create password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <FormControlLabel
        control={
          <Checkbox checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
        }
        label="I understand trade-agent gives advisory information only and is not investment advice."
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button
        type="submit"
        variant="contained"
        fullWidth
        sx={{ mt: 2 }}
        disabled={!acceptedTerms || submitting}
      >
        Create account
      </Button>
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run app/accept-invitation/page.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing tests for reset-password**

Create `frontend/app/reset-password/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, resetPasswordForEmail, updateUser } }),
}));

import ResetPasswordPage from "./page";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a reset email when there is no session yet (request mode)", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "a@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") }),
    );
  });

  it("sets the new password and redirects when a reset session exists (confirm mode)", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "newpassword123" } });
    fireEvent.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/today"));
    expect(updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd frontend && npx vitest run app/reset-password/page.test.tsx`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 7: Implement the reset-password page**

Create `frontend/app/reset-password/page.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, TextField, Button, Alert, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(Boolean(session));
      setCheckingSession(false);
    });
  }, []);

  async function handleRequest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/today");
  }

  if (checkingSession) {
    return null;
  }

  if (hasSession) {
    return (
      <Box component="form" onSubmit={handleConfirm} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Choose a new password
        </Typography>
        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          margin="normal"
          required
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
          Save password
        </Button>
      </Box>
    );
  }

  if (sent) {
    return (
      <Box sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Alert severity="success">Check your email for a link to reset your password.</Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleRequest} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Reset your password
      </Typography>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Send reset link
      </Button>
    </Box>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd frontend && npx vitest run app/reset-password/page.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/accept-invitation/page.tsx frontend/app/accept-invitation/page.test.tsx frontend/app/reset-password/page.tsx frontend/app/reset-password/page.test.tsx
git commit -m "feat: accept-invitation and reset-password pages"
```

---

### Task 6: Admin users list and invite drawer

**Files:**
- Create: `frontend/lib/api/admin-types.ts`
- Modify: `frontend/app/(shell)/admin/page.tsx`
- Test: `frontend/app/(shell)/admin/page.test.tsx`
- Create: `frontend/components/admin/InviteDrawer.tsx`
- Test: `frontend/components/admin/InviteDrawer.test.tsx`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` from `@/lib/api/client`.
- Produces: `AdminUserOut` type (matches the backend's `AdminUserOut` Pydantic schema field-for-field: `id, email, role, status, created_at, invited_at, invite_expires_at, accepted_terms_at, last_seen_at, monthly_analysis_limit, monthly_analysis_used, monthly_chat_limit, monthly_chat_used` — Task 7 imports this same type).

- [ ] **Step 1: Install SWR**

```bash
cd frontend
npm install swr
```

- [ ] **Step 2: Write the hand-written `AdminUserOut` type**

Create `frontend/lib/api/admin-types.ts` (a hand-written interim type matching the backend's `AdminUserOut` schema exactly — `npm run gen:types` will eventually produce the real generated equivalent, but that requires a running backend and isn't committed; this file is what the admin components import until then):

```typescript
export interface AdminUserOut {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "invited" | "active" | "disabled";
  created_at: string;
  invited_at: string | null;
  invite_expires_at: string | null;
  accepted_terms_at: string | null;
  last_seen_at: string | null;
  monthly_analysis_limit: number | null;
  monthly_analysis_used: number | null;
  monthly_chat_limit: number | null;
  monthly_chat_used: number | null;
}
```

- [ ] **Step 3: Write the failing tests for the admin users list**

Create `frontend/app/(shell)/admin/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  },
}));

import AdminPage from "./page";

function renderFresh(ui: React.ReactElement) {
  // A fresh SWR cache per test — the module-level default cache otherwise leaks state
  // between tests using the same key ("/admin/users").
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const USERS: AdminUserOut[] = [
  {
    id: "u1",
    email: "active@example.com",
    role: "user",
    status: "active",
    created_at: "2026-01-01T00:00:00",
    invited_at: null,
    invite_expires_at: null,
    accepted_terms_at: "2026-01-02T00:00:00",
    last_seen_at: "2026-01-03T00:00:00",
    monthly_analysis_limit: 100,
    monthly_analysis_used: 5,
    monthly_chat_limit: 500,
    monthly_chat_used: 10,
  },
  {
    id: "u2",
    email: "invited@example.com",
    role: "user",
    status: "invited",
    created_at: "2026-01-01T00:00:00",
    invited_at: "2026-01-01T00:00:00",
    invite_expires_at: "2026-01-02T00:00:00",
    accepted_terms_at: null,
    last_seen_at: null,
    monthly_analysis_limit: 100,
    monthly_analysis_used: 0,
    monthly_chat_limit: 500,
    monthly_chat_used: 0,
  },
];

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists every user returned by GET /admin/users", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("active@example.com")).toBeInTheDocument());
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/admin/users");
  });

  it("resends an invite and refetches the list", async () => {
    apiFetch.mockResolvedValueOnce(USERS).mockResolvedValueOnce(undefined).mockResolvedValueOnce(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("invited@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/admin/users/u2/resend", expect.objectContaining({ method: "POST" })),
    );
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd frontend && npx vitest run "app/(shell)/admin/page.test.tsx"`
Expected: FAIL — the placeholder page has none of this.

- [ ] **Step 5: Implement the admin users list**

Replace the whole of `frontend/app/(shell)/admin/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, Chip, IconButton } from "@mui/material";
import { Plus, MoreHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { InviteDrawer } from "@/components/admin/InviteDrawer";

type StatusFilter = "all" | "active" | "invited" | "disabled";

export default function AdminPage() {
  const { data: users, mutate } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = (users ?? []).filter((u) => filter === "all" || u.status === filter);

  async function handleResend(id: string) {
    await apiFetch(`/admin/users/${id}/resend`, { method: "POST" });
    mutate();
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/admin/users/${id}/revoke`, { method: "POST" });
    mutate();
  }

  async function handleEnable(id: string) {
    await apiFetch(`/admin/users/${id}/enable`, { method: "POST" });
    mutate();
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data.
      </Alert>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Users
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setInviteOpen(true)}>
          Invite user
        </Button>
      </Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        {(["all", "active", "invited", "disabled"] as const).map((value) => {
          const count =
            value === "all" ? (users ?? []).length : (users ?? []).filter((u) => u.status === value).length;
          return (
            <Chip
              key={value}
              label={`${value[0].toUpperCase()}${value.slice(1)} ${count}`}
              onClick={() => setFilter(value)}
              color={filter === value ? "primary" : "default"}
            />
          );
        })}
      </Box>
      {filtered.map((user) => (
        <Box
          key={user.id}
          sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5, borderBottom: "1px solid var(--line)" }}
        >
          <Typography sx={{ fontWeight: 600, flex: 1 }}>{user.email}</Typography>
          <Chip label={user.role} size="small" />
          <Chip label={user.status} size="small" color={user.status === "disabled" ? "error" : "default"} />
          {user.status === "invited" && (
            <>
              <Button size="small" onClick={() => handleResend(user.id)}>
                Resend
              </Button>
              <Button size="small" onClick={() => handleRevoke(user.id)}>
                Revoke
              </Button>
            </>
          )}
          {user.status === "disabled" && (
            <Button size="small" onClick={() => handleEnable(user.id)}>
              Enable
            </Button>
          )}
          {user.status === "active" && (
            <IconButton size="small" aria-label="User details">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
        </Box>
      ))}
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
    </Box>
  );
}
```

(The active-row detail action is wired to `UserDetailDrawer` in Task 7 — this task leaves the button present but not yet opening anything, matching the interface Task 7's `Interfaces: Consumes` block below expects to attach to. This page imports `InviteDrawer`, which doesn't exist until Step 9 below — don't run this test file yet; Step 10 runs it together with `InviteDrawer`'s own tests once both exist.)

- [ ] **Step 6: Write the failing tests for `InviteDrawer`**

Create `frontend/components/admin/InviteDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
class FakeApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { InviteDrawer } from "./InviteDrawer";

describe("InviteDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invites the entered email and calls onInvited + onClose on success", async () => {
    apiFetch.mockResolvedValue({ id: "u1" });
    const onInvited = vi.fn();
    const onClose = vi.fn();
    render(<InviteDrawer open onClose={onClose} onInvited={onInvited} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/invite",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@example.com" }) }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the backend's error detail on a 409 and does not close", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(409, "That address already has access"));
    const onClose = vi.fn();
    render(<InviteDrawer open onClose={onClose} onInvited={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "existing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(screen.getByText("That address already has access")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd frontend && npx vitest run components/admin/InviteDrawer.test.tsx`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 8: Implement `InviteDrawer`**

Create `frontend/components/admin/InviteDrawer.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";

interface InviteDrawerProps {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteDrawer({ open, onClose, onInvited }: InviteDrawerProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setEmail("");
      onInvited();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box component="form" onSubmit={handleSubmit} sx={{ width: 360, p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 650, mb: 2 }}>
          Invite user
        </Typography>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          required
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
          Send invite
        </Button>
      </Box>
    </Drawer>
  );
}
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `cd frontend && npx vitest run "app/(shell)/admin/page.test.tsx" components/admin/InviteDrawer.test.tsx`
Expected: PASS, 4 tests total (2 + 2).

- [ ] **Step 10: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add frontend/lib/api/admin-types.ts "frontend/app/(shell)/admin/page.tsx" "frontend/app/(shell)/admin/page.test.tsx" frontend/components/admin/InviteDrawer.tsx frontend/components/admin/InviteDrawer.test.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: admin users list with SWR and the invite drawer"
```

---

### Task 7: User detail drawer and usage page

**Files:**
- Modify: `frontend/app/(shell)/admin/page.tsx`
- Test: `frontend/app/(shell)/admin/page.test.tsx`
- Create: `frontend/components/admin/UserDetailDrawer.tsx`
- Test: `frontend/components/admin/UserDetailDrawer.test.tsx`
- Modify: `frontend/app/(shell)/admin/usage/page.tsx`
- Test: `frontend/app/(shell)/admin/usage/page.test.tsx`

**Interfaces:**
- Consumes: `AdminUserOut` from `@/lib/api/admin-types` (Task 6); `apiFetch`, `ApiError` from `@/lib/api/client`.

- [ ] **Step 1: Write the failing tests for `UserDetailDrawer`**

Create `frontend/components/admin/UserDetailDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
class FakeApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { UserDetailDrawer } from "./UserDetailDrawer";

const USER: AdminUserOut = {
  id: "u1",
  email: "active@example.com",
  role: "user",
  status: "active",
  created_at: "2026-01-01T00:00:00",
  invited_at: null,
  invite_expires_at: null,
  accepted_terms_at: "2026-01-02T00:00:00",
  last_seen_at: "2026-01-03T00:00:00",
  monthly_analysis_limit: 100,
  monthly_analysis_used: 5,
  monthly_chat_limit: 500,
  monthly_chat_used: 10,
};

describe("UserDetailDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when user is null", () => {
    const { container } = render(<UserDetailDrawer user={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sets an analysis-run limit override without touching chat_limit", async () => {
    apiFetch.mockResolvedValue(USER);
    const onChanged = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText(/analysis runs/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /save limits/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = apiFetch.mock.calls.find(([path]) => path === "/admin/users/u1/limits")!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({ analysis_limit: 50 });
  });

  it("clears a limit by sending an explicit null, distinct from leaving it untouched", async () => {
    apiFetch.mockResolvedValue(USER);
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: /use default/i })[0]);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/admin/users/u1/limits",
        expect.objectContaining({ body: JSON.stringify({ analysis_limit: null }) }),
      ),
    );
  });

  it("keeps Remove disabled until the typed email matches exactly", () => {
    render(<UserDetailDrawer user={USER} onClose={vi.fn()} onChanged={vi.fn()} />);

    const removeButton = screen.getByRole("button", { name: /^remove$/i });
    expect(removeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: "wrong@example.com" } });
    expect(removeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: USER.email } });
    expect(removeButton).not.toBeDisabled();
  });

  it("calls DELETE with confirm_email once the typed value matches", async () => {
    apiFetch.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<UserDetailDrawer user={USER} onClose={onClose} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText(/confirm email/i), { target: { value: USER.email } });
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/users/u1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirm_email: USER.email }),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run components/admin/UserDetailDrawer.test.tsx`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 3: Implement `UserDetailDrawer`**

Create `frontend/components/admin/UserDetailDrawer.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert, Divider } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";

interface UserDetailDrawerProps {
  user: AdminUserOut | null;
  onClose: () => void;
  onChanged: () => void;
}

export function UserDetailDrawer({ user, onClose, onChanged }: UserDetailDrawerProps) {
  const [analysisLimit, setAnalysisLimit] = useState("");
  const [chatLimit, setChatLimit] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return null;
  }

  async function patchLimits(body: Record<string, number | null>) {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}/limits`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleSetLimits(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const body: Record<string, number> = {};
    if (analysisLimit !== "") body.analysis_limit = Number(analysisLimit);
    if (chatLimit !== "") body.chat_limit = Number(chatLimit);
    await patchLimits(body);
    setSubmitting(false);
  }

  async function handleDisable() {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}/disable`, { method: "POST" });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleRemove() {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  return (
    <Drawer anchor="right" open={Boolean(user)} onClose={onClose}>
      <Box sx={{ width: 400, p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 650 }}>
          {user.email}
        </Typography>
        <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 0.5 }}>{user.status}</Typography>

        <Divider sx={{ my: 2 }} />

        <Box component="form" onSubmit={handleSetLimits}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Monthly limits</Typography>
          <TextField
            label={`Analysis runs (used ${user.monthly_analysis_used ?? 0} of ${
              user.monthly_analysis_limit ?? "—"
            })`}
            value={analysisLimit}
            onChange={(e) => setAnalysisLimit(e.target.value)}
            fullWidth
            margin="normal"
            type="number"
          />
          <Button size="small" onClick={() => patchLimits({ analysis_limit: null })}>
            Use default
          </Button>
          <TextField
            label={`Chat messages (used ${user.monthly_chat_used ?? 0} of ${
              user.monthly_chat_limit ?? "—"
            })`}
            value={chatLimit}
            onChange={(e) => setChatLimit(e.target.value)}
            fullWidth
            margin="normal"
            type="number"
          />
          <Button size="small" onClick={() => patchLimits({ chat_limit: null })}>
            Use default
          </Button>
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
            Save limits
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        {user.status === "active" && (
          <Button variant="outlined" fullWidth onClick={handleDisable}>
            Disable
          </Button>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 600, mb: 1 }}>Remove user</Typography>
        <Typography sx={{ color: "var(--muted)", fontSize: 13, mb: 1 }}>
          Type {user.email} to confirm. This permanently deletes their data.
        </Typography>
        <TextField
          label="Confirm email"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Button
          color="error"
          variant="contained"
          fullWidth
          disabled={confirmEmail !== user.email}
          onClick={handleRemove}
        >
          Remove
        </Button>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Box>
    </Drawer>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run components/admin/UserDetailDrawer.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire `UserDetailDrawer` into the admin users list**

In `frontend/app/(shell)/admin/page.tsx`, add the import and the open/select state, and wire the "active" row's icon button to open it. Change:

```tsx
import { InviteDrawer } from "@/components/admin/InviteDrawer";
```

to:

```tsx
import { InviteDrawer } from "@/components/admin/InviteDrawer";
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";
```

Change:

```tsx
  const [inviteOpen, setInviteOpen] = useState(false);
```

to:

```tsx
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
```

Change the active-row icon button:

```tsx
          {user.status === "active" && (
            <IconButton size="small" aria-label="User details">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
```

to:

```tsx
          {user.status === "active" && (
            <IconButton
              size="small"
              aria-label="User details"
              onClick={() => setSelectedUserId(user.id)}
            >
              <MoreHorizontal size={18} />
            </IconButton>
          )}
```

And change the closing `<InviteDrawer .../>` line to also render the detail drawer:

```tsx
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
```

to:

```tsx
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
      <UserDetailDrawer
        user={users?.find((u) => u.id === selectedUserId) ?? null}
        onClose={() => setSelectedUserId(null)}
        onChanged={() => mutate()}
      />
```

- [ ] **Step 6: Add a test proving the wiring**

Append to `frontend/app/(shell)/admin/page.test.tsx`:

```tsx
  it("opens the user detail drawer when an active row's details button is clicked", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminPage />);

    await waitFor(() => expect(screen.getByText("active@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /user details/i }));

    // UserDetailDrawer renders a "Remove user" heading once open for this user.
    await waitFor(() => expect(screen.getByText(/remove user/i)).toBeInTheDocument());
  });
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd frontend && npx vitest run "app/(shell)/admin/page.test.tsx"`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write the failing tests for the usage page**

Create `frontend/app/(shell)/admin/usage/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { AdminUserOut } from "@/lib/api/admin-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AdminUsagePage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const USERS: AdminUserOut[] = [
  {
    id: "u1",
    email: "a@example.com",
    role: "user",
    status: "active",
    created_at: "2026-01-01T00:00:00",
    invited_at: null,
    invite_expires_at: null,
    accepted_terms_at: "2026-01-02T00:00:00",
    last_seen_at: null,
    monthly_analysis_limit: 100,
    monthly_analysis_used: 7,
    monthly_chat_limit: 500,
    monthly_chat_used: 42,
  },
];

describe("AdminUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each user's usage against their effective limit", async () => {
    apiFetch.mockResolvedValue(USERS);
    renderFresh(<AdminUsagePage />);

    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(screen.getByText("7 / 100")).toBeInTheDocument();
    expect(screen.getByText("42 / 500")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `cd frontend && npx vitest run "app/(shell)/admin/usage/page.test.tsx"`
Expected: FAIL — the placeholder page has none of this.

- [ ] **Step 10: Implement the usage page**

Replace the whole of `frontend/app/(shell)/admin/usage/page.tsx`:

```tsx
"use client";

import useSWR from "swr";
import { Box, Typography, Table, TableHead, TableBody, TableRow, TableCell } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";

export default function AdminUsagePage() {
  const { data: users } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 650, mb: 2 }}>
        Usage and limits
      </Typography>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>User</TableCell>
            <TableCell>Analysis runs</TableCell>
            <TableCell>Chat messages</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(users ?? []).map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                {user.monthly_analysis_used ?? 0} / {user.monthly_analysis_limit ?? "—"}
              </TableCell>
              <TableCell>
                {user.monthly_chat_used ?? 0} / {user.monthly_chat_limit ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
```

If this throws `"MUI: Unsupported var(...) color"` for `Table`/`TableRow`/`TableCell` the way `Button`/`Chip`/etc. did before PR #24's final fix wave, extend `readStatusColors`/`buildMuiTheme` the same way that fix did (see this plan's Global Constraints) — do not hardcode a color as a one-off fix.

- [ ] **Step 11: Run to verify it passes**

Run: `cd frontend && npx vitest run "app/(shell)/admin/usage/page.test.tsx"`
Expected: PASS, 1 test.

- [ ] **Step 12: Run the full suite, build, and lint**

```bash
cd frontend
npm test
npm run build
npm run lint
npm run typecheck
```

Expected: all pass.

- [ ] **Step 13: Manually verify against the real Supabase project and backend**

```bash
# terminal 1
cd backend && docker compose up -d && uv run uvicorn app.main:app --reload
# terminal 2
cd frontend && npm run dev
```

Walk through: invite a real address → check the email → accept the invitation → confirm redirect to `/today` → as the admin, confirm the user shows `active` in `/admin` → open their detail drawer, set a limit override, confirm it shows in `/admin/usage` → disable them (confirm their session is refused) → enable them → remove them (type their email, confirm they disappear from the list and from the Supabase dashboard). This is the same checklist PR #22's owner verification already proved on the backend — this step proves it through the real UI.

- [ ] **Step 14: Commit**

```bash
git add "frontend/app/(shell)/admin/page.tsx" "frontend/app/(shell)/admin/page.test.tsx" frontend/components/admin/UserDetailDrawer.tsx frontend/components/admin/UserDetailDrawer.test.tsx "frontend/app/(shell)/admin/usage/page.tsx" "frontend/app/(shell)/admin/usage/page.test.tsx"
git commit -m "feat: user detail drawer (limits, disable/enable, remove) and the usage page"
```

---

## Self-Review Notes

**Spec coverage:** every "In scope" bullet maps to a task — `proxy.ts` (Task 2), login/accept-invitation/reset-password (Tasks 4-5), shell/admin route protection (Task 3), server-side `apiFetch` (Task 1), admin screens including the usage page (Tasks 6-7), SWR adoption (Task 6).

**Type consistency:** `Role`/`SessionInfo` (Task 1) is the one shape every later task's server-side code relies on; `AdminUserOut` (Task 6) is the one shape every admin-screen task relies on — both defined once, imported everywhere else.

**Review Focus:** all five items have an owning task and test — `/admin` non-admin redirect (Task 3, `AdminLayout` tests), unauthenticated `(shell)` redirect (Task 3, `ShellLayout` tests), invited-user lockout (Task 3, `ShellLayout`'s `status !== "active"` test), the omitted-vs-null limits distinction (Task 7, `UserDetailDrawer`'s two dedicated tests), the remove-button confirm-by-typing-email gate (Task 7, `UserDetailDrawer`'s disabled/enabled test).
