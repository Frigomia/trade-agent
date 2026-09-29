# Limits and usage (sub-project 2c)

Status: design approved in the brainstorming session on 2026-09-29. Third and last of three backend
cycles that make the system multi-user and invitation-only (roadmap step 2 in
`2026-09-28-frontend-design-direction-design.md`).

- **2a Auth core:** done (JWKS verification, `app_users`, RLS, restricted role).
- **2b Admin and invitations:** done (invite, list, resend, revoke, disable, enable, remove; `/me`,
  `/me/accept`; narrowed `app_users` grants).
- **2c Limits and usage (this spec):** monthly caps, usage counts, per-user rate limiting, the user's
  own data export and deletion.

## Understanding

Model and search calls cost money per use and the admin pays. Each user has a monthly cap on analysis
runs and chat messages, with sensible system defaults the admin can override per user; usage is visible
to the admin (counts only, never financial data); a user who reaches a cap sees a clear, calm message,
not a raw error. The existing per-IP burst rate limiter becomes per-user, closing a real gap where users
sharing a NAT/IP throttle each other instead of individually. A user can also export their own data as
JSON and delete their own data on demand, without needing the admin.

Constraints carried from `PRODUCT.md`, `CLAUDE.md`, and the 2a/2b specs: the system never places a
trade; the admin never sees financial data, only access-management data and usage counts; calm, generic
error messages; RLS remains the database-level boundary for anything a user does to their own rows; no
secrets in git.

## Scope

In scope:

- Two nullable override columns on `app_users`: `monthly_analysis_limit`, `monthly_chat_limit`.
- System default limits in `Settings`, used whenever a user's override is `NULL`.
- Redis-backed monthly usage counters, one per user per kind, keyed by calendar month (UTC).
- `analysis.py` and `chat.py` gain monthly-cap enforcement alongside their existing burst limiter.
- The existing burst rate limiter (`rate_limit.py`) changes its key from client IP to authenticated user
  id. Its per-minute limits (5 analysis, 20 chat) are unchanged.
- Admin: `GET /admin/users` gains four usage/limit fields per user; new `PATCH
  /admin/users/{id}/limits` to set or clear per-user overrides.
- Self-service: `GET /me/usage`, `GET /me/export`, `DELETE /me/data`.
- A shared user-data-deletion helper factored out of 2b's `admin/service.py`, used by both the admin's
  "remove user" flow and the new self-service delete.
- `ARCHITECTURE.md` updates (§4, §5, §11, §13).

Out of scope: any UI (frontend cycles, later); full self-service account/offboarding (deleting the
Supabase account and `app_users` row) — self-service is data-only, the account stays active; changing
who is admin; per-user rate limiting for routes other than `/analysis/run` and `/chat` (no other route
has a burst limiter today); billing or payment; notifying a user by email as they approach a limit.

## Design

### Data model and defaults

Migration (via the alembic CLI, autogenerate for the columns): adds `monthly_analysis_limit` and
`monthly_chat_limit` to `app_users`, both `Integer`, nullable, no default. `NULL` means "use the system
default." A manual step in the same migration extends the narrowed `app_users` `UPDATE` grant from 2b
(security finding L1) to include these two columns — the runtime role's grant becomes `UPDATE (status,
accepted_terms_at, last_seen_at, invited_at, monthly_analysis_limit, monthly_chat_limit)`. Still never
`id`, `email`, or `role`.

`Settings` (`backend/app/config.py`) gains `default_monthly_analysis_limit: int = 100` and
`default_monthly_chat_limit: int = 500` — generous enough not to interrupt a normal daily-check user
(the product's primary use case), low enough to bound spend if an account is compromised or scripted
against. `app/usage.py` provides `effective_limit(app_user, kind, settings) -> int`, returning the
override if set, else the matching default.

### Usage tracking and enforcement

New `backend/app/usage.py`, parallel in shape to the existing `backend/app/rate_limit.py`:

```python
from datetime import UTC, datetime

from app.redis_client import get_redis

_MONTH_TTL_SECONDS = 40 * 24 * 60 * 60  # outlives any calendar month; no scheduled reset needed


class UsageLimitExceeded(Exception):
    """Domain exception: the caller has used up their monthly allowance for `kind`."""

    def __init__(self, kind: str, limit: int) -> None:
        self.kind = kind
        self.limit = limit
        super().__init__(f"Monthly limit reached for {kind}: {limit}")


def _usage_key(kind: str, user_id: str) -> str:
    year_month = datetime.now(UTC).strftime("%Y-%m")
    return f"usage:{kind}:{user_id}:{year_month}"


async def check_and_increment_usage(kind: str, user_id: str, limit: int) -> None:
    redis = get_redis()
    key = _usage_key(kind, user_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _MONTH_TTL_SECONDS)
    if count > limit:
        raise UsageLimitExceeded(kind, limit)


async def get_usage(kind: str, user_id: str) -> int:
    redis = get_redis()
    value = await redis.get(_usage_key(kind, user_id))
    return int(value) if value is not None else 0
```

`UsageLimitExceeded` is a domain exception (never `HTTPException`, per the project's
routers-thin/services-raise-domain-exceptions rule), mapped once in `main.py`'s existing exception
handler to `429` with a calm message: `"Monthly limit reached ({limit} {kind_label} this month). Resets
next month, or ask your admin to raise it."`

Semantics: the Nth call (N = limit) succeeds; the (N+1)th is the first rejection — matching the existing
burst limiter's own off-by-one behavior, so both limiters read the same way in code and in the error
copy.

`CurrentUser` (`app/auth/deps.py`) gains two fields, `monthly_analysis_limit: int | None` and
`monthly_chat_limit: int | None`, populated straight from the `app_users` row `get_current_user` already
loads — no extra query.

`analysis.py`'s `POST /analysis/run` and `chat.py`'s `POST /chat` each gain a second dependency,
`Depends(check_monthly_usage("analysis_run"))` / `Depends(check_monthly_usage("chat"))`, defined in
`usage.py`:

```python
def check_monthly_usage(kind: str) -> Callable[[CurrentUser], Awaitable[None]]:
    async def _check(user: CurrentUser = Depends(get_current_user)) -> None:
        limit = effective_limit(user, kind, settings)
        await check_and_increment_usage(kind, str(user.id), limit)

    return _check
```

This depends on `get_current_user` directly (FastAPI's dependency cache means it isn't re-run), so it
composes with the route's existing `Depends(get_current_user)` for free.

The existing burst limiter's key changes from `f"ratelimit:{key_prefix}:{client_ip}"` to
`f"ratelimit:{key_prefix}:{user.id}"`; `rate_limiter(...)` becomes a dependency on `CurrentUser` instead
of `Request`. Per-minute limits (5 analysis, 20 chat) are unchanged — this only fixes who the budget
belongs to. Today, users sharing a NAT/IP (a household, an office) throttle each other; per-user keys
close that.

### Admin visibility and API

`GET /admin/users?status=` response gains four fields per user, always resolved (never `NULL`):
`monthly_analysis_limit` and `monthly_chat_limit` (the effective value: override or default) and
`monthly_analysis_used`, `monthly_chat_used` (this month's counts from `get_usage`). These are counts
only — never holdings, recommendations, or chat content.

New `PATCH /admin/users/{id}/limits {analysis_limit?: int | null, chat_limit?: int | null}` — admin
only. Either field is optional and independent; omitted leaves that limit unchanged, an explicit `null`
clears the override back to the system default, a non-negative integer sets it. `422` if a provided
value is negative. `404` for an unknown user id, `403` for a non-admin, consistent with the rest of the
admin API.

### Self-service usage, export, and deletion

- `GET /me/usage` — `active` users only (`get_current_user`; an `invited` user has no usage yet).
  Returns:

  ```json
  {
    "analysis_runs": {"used": 12, "limit": 100},
    "chat_messages": {"used": 340, "limit": 500}
  }
  ```

- `GET /me/export` — synchronous JSON, `active` users only, built through the caller's own RLS-scoped
  session (`get_user_db`), so a bug here cannot leak another user's rows: an admin-side query could
  bypass RLS on a misconfigured connection (documented residual risk from 2b), but a user's own
  RLS-scoped session cannot see rows it isn't allowed to select in the first place. Returns the caller's
  `app_users` profile fields (`id`, `email`, `role`, `status`, `created_at`, `accepted_terms_at`,
  `last_seen_at` — never anything admin-internal) plus every row in each of `rls.USER_TABLES` for that
  user:

  ```json
  {
    "profile": {"id": "...", "email": "...", "role": "user", "status": "active", "...": "..."},
    "holdings": [...],
    "watchlist_items": [...],
    "trades": [...],
    "recommendations": [...],
    "chat_messages": [...],
    "backtest_results": [...],
    "investment_preferences": {...},
    "portfolio_snapshots": [...]
  }
  ```

- `DELETE /me/data {confirm: true}` — `active` users only. Wipes the caller's rows in every
  `rls.USER_TABLES` table via their own RLS-scoped session. `422` without `confirm: true`. `204` on
  success. The account, login, `app_users` row, and Supabase user are untouched — this deletes data, not
  the account (out of scope: full self-offboarding, see Scope).

### Shared deletion helper

2b's `admin/service.py` has `_delete_user_data(factory, user_id)`, hardened in 2b's final review to
filter explicitly by `user_id` rather than relying only on RLS. That function moves to `app/user_data.py`
as `delete_user_data(factory, user_id)`, unchanged in behavior, and both `admin/service.py`'s
`remove_user` and the new `me.py`'s `DELETE /me/data` call it. One implementation, one place the
filtered-delete logic can be audited — the class of bug 2b's final review caught (an unfiltered `DELETE`
under RLS bypass) only needs fixing once and stays fixed for both callers.

### Errors

Calm and generic, matching the existing copy rules:

- `429` monthly limit reached: `"Monthly limit reached ({limit} {kind_label} this month). Resets next
  month, or ask your admin to raise it."` (`kind_label` is "analysis runs" or "chat messages").
- `429` burst limit exceeded: unchanged copy from today, now keyed per user.
- `422` `DELETE /me/data` without `confirm: true`.
- `422` `PATCH /admin/users/{id}/limits` with a negative value.
- `403`/`404` on admin routes: unchanged shape from 2b.

### Testing

- `usage.py`: increment/expire-once/boundary-at-limit-vs-limit-plus-one, using a fake or real Redis
  (matching how `rate_limit.py` is tested today).
- `effective_limit`: override present vs `NULL` (falls back to default).
- Burst limiter keyed by user: two different users behind the same simulated IP each get their own
  budget (regression test for the gap this closes).
- `/me/usage`: correct counts after a mix of analysis/chat calls; `403` for an invited user.
- `/me/export`: returns only the caller's rows, verified against a second seeded user (same pattern as
  2b's isolation tests) — no cross-user leakage even by accident.
- `/me/data` delete: wipes only the caller's rows, leaves a second user's rows intact (isolation test,
  reusing 2b's `ROW_FACTORIES`); `422` without `confirm: true`; `204` and empty tables after.
- `PATCH /admin/users/{id}/limits`: sets an override, clears with explicit `null`, `422` on negative,
  `404` unknown user, `403` non-admin.
- `GET /admin/users` includes the four new fields with correct values after some usage.
- `delete_user_data` shared helper: a single test proving both callers (admin remove, self-delete)
  produce identical filtered-delete behavior (guards against the helper being extracted incorrectly).

### Documentation

`docs/ARCHITECTURE.md`: §4 (two new `app_users` columns, updated grant list), §5 (new routes: `/me/usage`,
`/me/export`, `DELETE /me/data`, `PATCH /admin/users/{id}/limits`; updated `/analysis/run` and `/chat`
rows noting per-user burst limiting and the new `429` monthly-limit error), §11 (two new default-limit
settings), §13/§16 status. `backend/CLAUDE.md` gains a one-line note on the two new settings if it lists
env/config knobs (it currently documents required `.env` vars, not `Settings` defaults with no env
override, so likely no change needed — confirmed during planning).

## Definition of done

- Ruff, ruff format, mypy strict, bandit, and pytest pass in `backend/`.
- The usage, per-user-burst-limit, self-service, admin-limits, and shared-deletion tests pass.
- No secrets committed; Conventional Commits; `ARCHITECTURE.md` updated.

## Risks

- Redis-backed usage counters are not durable across a Redis flush — a flush mid-month resets counts
  early. Acceptable for a soft cost-control cap on a personal system, not acceptable if this ever needs
  to be a billing record; noted as a boundary, not fixed here.
- `effective_limit` reads `CurrentUser.monthly_*_limit`, populated at `get_current_user` time from the
  `app_users` row already loaded on every request — no new query, but it does mean an admin's limit
  change takes effect on the user's next request, not mid-request (consistent with how 2b's disable/
  enable already behaves).
- The shared `delete_user_data` helper being called from two authorization contexts (admin-on-behalf-of,
  self-service) means a bug in it now has two blast radii instead of one; mitigated by the shared test
  proving both callers behave identically and by it already being the 2b-hardened, explicitly-filtered
  version.
