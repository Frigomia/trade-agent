# Orders tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth view in the Portfolio strip, "Orders", that lists every order line the person has not placed yet across all their saved plans, grouped by plan, so a line from an earlier month cannot be forgotten.

**Architecture:** One new read route, `GET /plans/orders/open`, that reuses the existing plan loaders and returns each plan that still has unplaced lines with only those lines. The frontend adds the Orders view and a badge to the strip and reuses the existing order cards, Record placed order sheet and auto-advance (`OrdersSection`) once per plan. No schema change, nothing new stored.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic v2, pytest; Next.js 16, MUI 9, SWR, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-orders-tab-design.md`

## Global Constraints

- The system never places a trade and never calls a broker. "Placed" only records what the person did. Screens say "Order" and "Placed", never Buy or Sell labels, and keep "Advisory only. Nothing is sent to a broker."
- The route works only on the caller's own rows (scoped session plus `user_id` filters) and returns no more than `GET /plans/{id}` already returns (live ISIN, placed fields). No new table or column. No logging of plan data.
- A plan older than 14 days shows "Planned 8 Sep. Prices and weights have moved since; make a new plan if this is no longer what you want." (the date is the plan's saved date, in the viewer's time zone); the ticket still copies as written.
- Strip labels: "Holdings", "This month", "Saved plans", "Orders" (a badge with the open-line total, hidden at zero); the exact phone labels follow the design the user picks in the design pause. Deep link `/portfolio/plan?tab=orders`.
- The empty state reads "No open orders." plus a line saying orders come from saving a plan.
- Conventional Commits; never skip hooks or GPG signing (retry once on a signing timeout, otherwise leave the work staged and report); branch `feature/orders-tab`.

## Review Focus

1. **A plan with some lines placed:** only its unplaced lines come back, and the count matches; a plan with everything placed is omitted. [Task 1]
2. **Another person's lines:** never listed, never counted. [Task 1]
3. **The route shadowed by `/{plan_id}`:** `GET /plans/orders/open` must return the list, never a 422 or 404 for "orders". [Task 1]
4. **Placing a line from the Orders view:** the badge and the list update, the group disappears when its last line is placed, and the next open line of that plan opens. [Task 4]
5. **A plan saved 14 days ago versus 15:** the old-plan note boundary. [Task 4]
6. **Nothing open:** the empty state, the badge hidden, no error. [Task 4]

---

## File Structure

- Modify `backend/app/schemas.py` (`OpenOrdersOut`), `backend/app/plans.py` (`open_orders`), `backend/app/routers/plans.py` (the route).
- Tests: `backend/tests/test_plans_router.py`.
- Docs: `docs/ARCHITECTURE.md`, `PRODUCT.md`, `docs/superpowers/specs/2026-10-09-order-tickets-design.md` (Future work: mark done).
- Frontend (Part 2): `frontend/lib/plans.ts` (types, `useOpenOrders`), `frontend/components/portfolio/PortfolioTabs.tsx`, `frontend/components/plan/OrdersView.tsx` (new), `frontend/app/(shell)/portfolio/plan/page.tsx`, `frontend/app/(shell)/portfolio/page.tsx` (the strip's badge), tests beside them.

Hazards for every implementer: the ruff PostToolUse hook strips imports that are unused when you add them (add an import with its first use); Docker/Postgres must be running and the full backend suite is run ONE process at a time; the local TLS issue with uv needs `--system-certs`; `GET /plans/{plan_id}` routes must stay LAST in `routers/plans.py`.

---

## Part 1 — Backend

### Task 1: `GET /plans/orders/open`

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/plans.py`, `backend/app/routers/plans.py`
- Test: `backend/tests/test_plans_router.py`
- Docs: `docs/ARCHITECTURE.md`, `PRODUCT.md`, the order tickets spec's Future work

**Interfaces:**
- Consumes: `plans._extras(db, user_id, lines)`, `plans._out(row, lines, extras)` (existing loaders: live ISIN, placed fields), `ContributionPlan`, `ContributionPlanLine`.
- Produces: `schemas.OpenOrdersOut(open_lines: int, plans: list[PlanOut])`; `plans.open_orders(db, user_id) -> OpenOrdersOut`; route `GET /plans/orders/open` returning `OpenOrdersOut`, declared above the `/{plan_id}` routes.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_plans_router.py`; reuse the existing helpers `_seed_basic`, `_saved`, `_line`, `_place`, `_prices`, `_holding`, `USER_ID`, `OTHER_USER_ID`, and the model imports; add imports with first use)

```python
def test_open_orders_lists_only_unplaced_lines_newest_plan_first(client, db_session):
    _seed_basic(db_session)
    first = _saved(client)
    second = _saved(client)
    _place(client, first, _line(client, first, "AAPL"))
    body = client.get("/plans/orders/open").json()
    assert [p["id"] for p in body["plans"]] == [second["id"], first["id"]]
    assert {l["ticker"] for l in body["plans"][1]["lines"]} == {"NVDA"}  # AAPL was placed
    assert {l["ticker"] for l in body["plans"][0]["lines"]} == {"AAPL", "NVDA"}
    assert body["open_lines"] == 3
    assert all(l["placed_at"] is None for p in body["plans"] for l in p["lines"])


def test_a_plan_with_every_line_placed_is_omitted(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    for ticker in ("AAPL", "NVDA"):
        _place(client, plan, _line(client, plan, ticker), asset_type="STOCK")
    body = client.get("/plans/orders/open").json()
    assert body == {"open_lines": 0, "plans": []}


def test_open_orders_is_empty_without_plans(client):
    assert client.get("/plans/orders/open").json() == {"open_lines": 0, "plans": []}


def test_open_orders_never_lists_another_persons_lines(client, db_session):
    _seed_basic(db_session)
    other = ContributionPlan(user_id=OTHER_USER_ID, amount_eur=100, whole_shares=False,
                             total_before_eur=0, leftover_eur=0, notes=[])
    db_session.add(other)
    db_session.commit()
    db_session.add(ContributionPlanLine(user_id=OTHER_USER_ID, plan_id=other.id, ticker="AAPL", name="Apple",
                                        amount_eur=100, shares=1, price_eur=100, currency="EUR", rate=1,
                                        reason="underweight"))
    db_session.commit()
    assert client.get("/plans/orders/open").json() == {"open_lines": 0, "plans": []}


def test_open_lines_carry_the_live_isin_and_a_whole_shares_flag(client, db_session):
    _seed_basic(db_session)
    plan = _saved(client)
    client.put("/portfolio/instruments/AAPL/isin", json={"isin": "US0378331005"})
    line = next(l for l in client.get("/plans/orders/open").json()["plans"][0]["lines"] if l["ticker"] == "AAPL")
    assert line["isin"] == "US0378331005"
    assert client.get("/plans/orders/open").json()["plans"][0]["whole_shares"] is False
    assert plan["id"] == client.get("/plans/orders/open").json()["plans"][0]["id"]


def test_the_open_orders_route_is_not_shadowed_by_the_plan_id_route(client):
    assert client.get("/plans/orders/open").status_code == 200  # not 422/404 for "orders"


def test_open_orders_requires_authentication(anon_client):
    assert anon_client.get("/plans/orders/open").status_code == 401
```

- [ ] **Step 2: Run to verify they fail** — `uv run --system-certs pytest tests/test_plans_router.py -q` (from `backend/`); expected: FAIL (404/422 for the route).

- [ ] **Step 3: Implement**

`backend/app/schemas.py`:

```python
class OpenOrdersOut(BaseModel):
    open_lines: int
    plans: list[PlanOut]
```

`backend/app/plans.py` (next to `load_all`):

```python
def open_orders(db: Session, user_id: uuid.UUID) -> OpenOrdersOut:
    """The saved plans that still have lines to place, newest first, each with ONLY its unplaced lines."""
    lines = (
        db.query(ContributionPlanLine)
        .filter(ContributionPlanLine.user_id == user_id, ContributionPlanLine.placed_at.is_(None))
        .order_by(ContributionPlanLine.id)
        .all()
    )
    by_plan: dict[int, list[ContributionPlanLine]] = {}
    for line in lines:
        by_plan.setdefault(line.plan_id, []).append(line)
    rows = (
        db.query(ContributionPlan)
        .filter(ContributionPlan.user_id == user_id, ContributionPlan.id.in_(list(by_plan) or [0]))
        .order_by(ContributionPlan.id.desc())
        .all()
    )
    extras = _extras(db, user_id, lines)  # once, not per plan
    plans_out = [_out(row, by_plan[row.id], extras) for row in rows]
    return OpenOrdersOut(open_lines=sum(len(p.lines) for p in plans_out), plans=plans_out)
```

`backend/app/routers/plans.py` (above the "Keep the /{plan_id} routes LAST" comment, with the other fixed paths):

```python
@router.get("/orders/open", response_model=OpenOrdersOut)
def open_orders(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_user_db)
) -> OpenOrdersOut:
    return plans.open_orders(db, user.id)
```

(Import `OpenOrdersOut` in both modules with its first use.)

- [ ] **Step 4: Run** — `tests/test_plans_router.py`, then the full suite once, ruff and mypy. Expected: PASS. If the repo has a pattern for counting SQL statements in tests, add one proving the route's query count does not grow with the number of plans; otherwise note in the report that it reads the lines once, the plans once and the extras once.

- [ ] **Step 5: Docs** — `docs/ARCHITECTURE.md` (CRLF: preserve): the API table row for `GET /plans/orders/open` and a sentence in the order tickets section; `PRODUCT.md`: the Orders tab is built (backend now; the screen follows); mark the Orders tab as done (backend) in the order tickets spec's Future work.

- [ ] **Step 6: Commit**

```bash
git add backend docs PRODUCT.md
git commit -m "feat: list the unplaced order lines across the saved plans"
```

---

### Task 2: STOP — design the Orders view and the four-segment strip (huashu-design + impeccable)

No frontend code is written until this task is finished and the user has picked a direction.

**Files:** create `docs/design/orders-tab/` (draft HTML and screenshots) and `direction-approved.md` there.

- [ ] **Step 1: Run the design skills** — invoke `huashu-design` (three real HTML directions with screenshots, reusing `docs/design/contribution-planner/` `base.css` and `shell.js`, the Portfolio strip of `docs/design/portfolio-nav/`, and the approved order cards of `docs/design/order-tickets/` direction D) and `impeccable` (shape, critique, polish). Each direction covers, dark and light, desktop (1280) and phone (390): (a) the **four-segment strip** with the badge: how the labels shorten on a phone (for example Holdings, Plan, Saved, Orders), the badge at 0 (hidden), 1, 12; (b) the **Orders view** grouped by plan: a heading per plan ("October 2026, 2 open" with the saved date), that plan's open lines as the approved order cards (collapsed and one expanded), Copy all lines per plan, a placed-just-now state (the card leaves, the group count drops, the next line opens) and the last line of a plan placed (the group disappears); (c) the **old-plan note** on a plan older than 14 days ("Planned 8 Sep. Prices and weights have moved since; make a new plan if this is no longer what you want."); (d) the **empty state** ("No open orders." and where orders come from). Copy: "Order", "Placed", never Buy or Sell labels; "Advisory only. Nothing is sent to a broker." stays. Directions must differ structurally (for example: A: stacked plan sections with a sticky plan heading; B: a plan selector chip row above one plan's cards; C: collapsible plan groups, the newest open).
- [ ] **Step 2: Present and stop** — show the three directions and wait for the user's choice or mix. Do not start Task 3 until they answer.
- [ ] **Step 3: Record the decision** — write `direction-approved.md`, commit it with the design folder, and fill the exact labels, badge behaviour and grouping into Part 2 below.

---

## Part 2 — Frontend (filled in after the design pick)

Each task follows the same rhythm (failing Vitest test, run, implement, run, `eslint` / `tsc` / full suite / build, commit) and uses the existing `useSWR`, `apiFetch`, MUI components, tokens and the order tickets components (`OrdersPanel`, `OrdersSection`, `PlacedSheet`, `IsinRow`). The pages are behind sign-in, so say honestly in each report that nothing was checked in a browser.

### Task 3: Hook, types and the strip

**Files:** `frontend/lib/plans.ts` (the `OpenOrders` type and `useOpenOrders()`), `frontend/components/portfolio/PortfolioTabs.tsx` (the fourth view, the badge, the phone labels), the Portfolio page and the plan page (they render the strip), tests.

Behaviour to test: `useOpenOrders()` reads `GET /plans/orders/open` through SWR (one shared key, `revalidateOnFocus` off, no polling, a failure shows up in `error` and never throws) and exposes `openLines` and `plans`; the strip shows "Orders" with a badge of `openLines` (hidden at 0, hidden while loading or on error, "99+" above 99); the Orders link is `/portfolio/plan?tab=orders` with `aria-current="page"` on the Orders view only; the badge has an accessible name ("3 open orders"); the badge request does not make the Holdings page slower (it is one cheap read, loaded with the strip); the labels shorten at phone width per the chosen design and the strip does not overflow at 390px.

### Task 4: The Orders view

**Files:** a new `frontend/components/plan/OrdersView.tsx`, the plan page (`?tab=orders` switches to it, keeping the This month preview alive like Saved plans does), tests.

Behaviour to test (layout and copy from the chosen design): one block per plan with its heading (month, "N open", saved date) and that plan's open lines through `OrdersSection` (so Copy, Placed, Add ISIN, the Record placed order sheet and auto-advance all work unchanged); plans older than 14 days show the note with the saved date, a plan saved exactly 14 days ago does not and 15 days ago does (use a mocked clock); placing a line revalidates the open-orders data so the badge and the list update, the placed card leaves the list and a group with no lines left disappears; the empty state shows "No open orders." and the badge is hidden; a load error shows a readable message with Retry; `?tab=orders` deep-links to the view and the other views keep working; nothing says Buy or Sell; the "Advisory only" line is present once.

---

### Task 5: Final review, security review and the pull request

- [ ] **Step 1:** Run all checks: backend `uv run --system-certs ruff check . && uv run --system-certs ruff format --check . && uv run --system-certs mypy app && uv run --system-certs pytest -q`; frontend `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- [ ] **Step 2:** Dispatch the `security-reviewer` subagent on `git diff master...HEAD` with this brief: `GET /plans/orders/open` returns only the caller's own unplaced lines (scoped session, `user_id` filters, RLS), nothing another person's, and no more fields than `GET /plans/{id}`; the live ISIN lookup cannot read another person's holding or watchlist row; the number of queries does not grow with the number of plans; the route is not shadowed and needs authentication; nothing is logged or sent to Telegram; the frontend renders names, tickers, ISINs and the old-plan note as plain text; nothing can call a broker or place a trade.
- [ ] **Step 3:** Fix every finding it confirms in one pass, re-run the checks, push the branch and open the pull request. In the description note that no migration, secret or setting is needed.
