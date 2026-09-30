# Recommendations Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the human-in-the-loop approval loop: a "Today" list of pending recommendations, a
deep-linkable detail view per recommendation, and an approve/dismiss flow with an in-place
confirmation — the product-defining screen the whole system exists for.

**Architecture:** A small backend addition (two new nullable columns for structured evidence, a
new by-id endpoint, server-side live-quote augmentation reusing the existing cached quote fetch)
feeds a frontend built the same way as the admin screens: SWR for data, `apiFetch`/`ApiError` for
every backend call, inline `Alert`s for errors, no bare `fetch()`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic (backend) · Next.js App Router, TypeScript, MUI,
SWR (frontend).

**Spec:** `docs/superpowers/specs/2026-09-29-recommendations-workflow-design.md`

## Global Constraints

- **Approve/Dismiss only flip a status flag. Nothing executes a trade** — root `CLAUDE.md`'s
  hard, project-wide constraint.
- Backend routes stay sync `def` except where they genuinely await async IO — `backend/CLAUDE.md`'s
  convention. `list_recommendations` and the new by-id endpoint become `async def` specifically to
  `await` the quote fetch (which already isolates its own blocking yfinance call via
  `asyncio.to_thread`), matching this same router's existing `run_analysis`/`get_run_status`
  precedent — not a blanket exception.
- **Never call real external APIs (yfinance) in tests** — `backend/CLAUDE.md`. Every test that
  lists or fetches a `PENDING` recommendation must mock `fetch_quote_and_history`, including
  pre-existing tests that now incidentally trigger the live-quote path.
- No "similar past calls", no "Log the trade I placed" CTA, no portfolio-value tile this cycle —
  explicitly out of scope per the spec's "Out of scope" section.
- Errors surface inline via `ApiError.detail`, never silently — the same constraint enforced in
  the login-and-admin-screens cycle, still binding here.
- All backend calls through `lib/api/client.ts`'s `apiFetch` — no bare `fetch()` in components.
- Named exports for components; `page.tsx` files use Next's required default export (existing
  codebase convention — every route file so far is a default export, every reusable component a
  named one).

## Review Focus

- A recommendation whose `ai_analysis` and `fundamental_score` are both null (ETF/HOLD paths, or
  a skipped news agent) must render with those evidence pieces simply omitted — no literal
  "null"/"undefined" in the DOM. Pinned in Task 3 (`EvidencePanel`, reused by both the card and
  the detail page) and Task 4 (`RecommendationCard`'s own `ai_analysis`-null reasoning-line
  fallback).
- A recommendation whose live quote fetch failed (`current_price`/`price_change_pct` both null)
  must omit the price pill entirely, not show "NaN%". Pinned in Task 2 (backend) and Task 4
  (frontend).
- Double-clicking Approve/Dismiss before the first request resolves must fire only one request —
  the submitting-state guard already used across the admin screens. Pinned in Task 4 and Task 7.
- Navigating away from Today while a Run-analysis job is still polling must not throw a
  React "state update on an unmounted component" warning. SWR's own hook unsubscribes on unmount,
  so this is covered by the polling mechanism itself, not bespoke cleanup code — pinned as an
  explicit unmount-mid-poll test in Task 6, not just assumed.
- A job that comes back `FAILED` (the whole analysis run, not a per-ticker error inside
  `results`) needs its own distinct banner — not silently nothing, not confused with the
  per-ticker "N analyzed, M failed" note. Pinned in Task 6.

---

## File Structure

Backend:
- Modify: `backend/app/models.py` — `Recommendation` gains `fundamental_score`, `technical_signal`
- Create: `backend/migrations/versions/<hash>_add_evidence_fields_to_recommendations.py`
- Modify: `backend/app/schemas.py` — `RecommendationOut` gains 5 fields
- Modify: `backend/app/agents/jobs.py` — pass the two new fields into `Recommendation(...)`
- Modify: `backend/app/routers/analysis.py` — quote-augmentation helpers, async `list_recommendations`, new `GET /recommendations/{id}`
- Modify: `backend/tests/test_analysis_router.py` — mock the quote fetch in the two existing tests that now trigger it; add new tests

Frontend:
- Create: `frontend/lib/api/recommendation-types.ts` — `RecommendationOut`, `JobStatus` types
- Create: `frontend/components/recommendations/EvidencePanel.tsx` + test
- Create: `frontend/components/recommendations/RecommendationCard.tsx` + test
- Create: `frontend/components/recommendations/WebOpinionBox.tsx`
- Create: `frontend/components/recommendations/ConfirmationPanel.tsx` + test
- Modify: `frontend/app/(shell)/today/page.tsx` (replaces the sub-project 5 placeholder) + test
- Create: `frontend/app/(shell)/today/[id]/page.tsx` + test

---

### Task 1: Backend — structured evidence fields (model, migration, schema)

**Files:**
- Modify: `backend/app/models.py:50-67` (the `Recommendation` class)
- Create: `backend/migrations/versions/<hash>_add_evidence_fields_to_recommendations.py` (via `alembic revision --autogenerate`)
- Modify: `backend/app/schemas.py:74-87` (the `RecommendationOut` class)
- Modify: `backend/app/agents/jobs.py:57-67` (the `Recommendation(...)` construction inside `_process_ticker`)
- Test: `backend/tests/test_analysis_router.py` (new test, appended)

**Interfaces:**
- Consumes: `AnalysisState`'s `fundamental_score: int | None` and `technical_signal: str` (both
  already computed by `app/agents/graph.py`'s `fundamental_agent`/`technical_agent` nodes, already
  present in `state` at the point `jobs.py` builds the row — no new computation, just threading
  two existing values through).
- Produces: `Recommendation.fundamental_score: int | None`, `Recommendation.technical_signal: str
  | None` (columns); `RecommendationOut.fundamental_score`, `RecommendationOut.technical_signal`,
  `RecommendationOut.price_at_recommendation` (all exposed for the first time),
  `RecommendationOut.current_price: float | None = None`, `RecommendationOut.price_change_pct:
  float | None = None` (declared here with defaults so `model_validate` on a plain ORM object
  doesn't fail for lacking these two — Task 2 populates them at request time).

- [ ] **Step 1: Add the two columns to the model**

In `backend/app/models.py`, inside the `Recommendation` class, add two lines right after
`price_at_recommendation` (line 64):

```python
    price_at_recommendation: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    fundamental_score: Mapped[int | None] = mapped_column(nullable=True)
    technical_signal: Mapped[str | None] = mapped_column(String(20), nullable=True)
    outcome_forward_return_pct: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
```

(`String(20)` comfortably fits the longest current value, `"WEAK_DOWNTREND"`, 14 characters, with
room to grow.)

- [ ] **Step 2: Generate and inspect the migration**

Run: `uv run alembic revision --autogenerate -m "add evidence fields to recommendations"`

This writes a new file to `backend/migrations/versions/`. Open it and confirm its `upgrade()`
body is exactly two `op.add_column` calls (both nullable, no server default) — something like:

```python
def upgrade() -> None:
    op.add_column('recommendations', sa.Column('fundamental_score', sa.Integer(), nullable=True))
    op.add_column('recommendations', sa.Column('technical_signal', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('recommendations', 'technical_signal')
    op.drop_column('recommendations', 'fundamental_score')
```

No `GRANT`/`REVOKE` statements are needed here (unlike the `app_users` limits migration): the RLS
migration (`dd035aae788b`) already gave `trading_agent_app` a table-level `GRANT ... UPDATE` on
`recommendations` with no column list, which automatically covers new columns in Postgres. If the
autogenerated file contains anything else (a table recreation, an index change), stop and report
it rather than guessing — it means the model change didn't land the way this step expects.

- [ ] **Step 3: Apply the migration**

Run: `uv run alembic upgrade head`
Expected: no errors; `uv run alembic current` now shows the new revision as head.

- [ ] **Step 4: Add the fields to the schema**

In `backend/app/schemas.py`, replace the `RecommendationOut` class (lines 74-87) with:

```python
class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    created_at: datetime
    ticker: str
    asset_type: str
    action: str
    reasoning: list[str]
    ai_analysis: str | None
    suggested_position_pct: float | None
    status: str
    reviewed_at: datetime | None
    fundamental_score: int | None
    technical_signal: str | None
    price_at_recommendation: float | None
    # Computed at request time (see app/routers/analysis.py's quote augmentation), never
    # persisted — defaults let model_validate build this from a plain ORM row before those are
    # attached.
    current_price: float | None = None
    price_change_pct: float | None = None
```

- [ ] **Step 5: Wire the two new fields into job creation**

In `backend/app/agents/jobs.py`, inside `_process_ticker`'s `Recommendation(...)` call
(lines 58-67), add the two fields:

```python
                    rec = Recommendation(
                        user_id=user_id,
                        ticker=ticker_info["ticker"],
                        asset_type=ticker_info["asset_type"],
                        action=state["action"],
                        reasoning=state["reasoning"],
                        ai_analysis=state["ai_analysis"],
                        suggested_position_pct=state["suggested_position_pct"],
                        price_at_recommendation=state["quote"]["price"],
                        fundamental_score=state["fundamental_score"],
                        technical_signal=state["technical_signal"],
                    )
```

- [ ] **Step 6: Write a test that the two fields round-trip**

Append to `backend/tests/test_analysis_router.py`:

```python
def test_recommendation_exposes_evidence_fields(client, db_session):
    rec = Recommendation(
        user_id=USER_ID,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["Fundamental score 78/100", "Technical signal: OVERSOLD"],
        status="PENDING",
        fundamental_score=78,
        technical_signal="OVERSOLD",
        price_at_recommendation=186.40,
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 186.40, "closes": [184.0, 186.40]}),
    ):
        response = client.get("/analysis/recommendations?status=PENDING")

    assert response.status_code == 200
    body = response.json()[0]
    assert body["fundamental_score"] == 78
    assert body["technical_signal"] == "OVERSOLD"
    assert body["price_at_recommendation"] == 186.40
```

(This test references `fetch_quote_and_history` at `app.routers.analysis.fetch_quote_and_history`
— that import doesn't exist yet. This step's test is written now, alongside the fields it
verifies; it will fail with an `AttributeError`/collection error until Task 2 adds that import and
the augmentation call. That's expected — Task 2 is next and makes it pass. Do not skip writing it
now: it belongs with the fields it's proving.)

- [ ] **Step 7: Run the test to confirm the expected failure**

Run: `uv run python -m pytest tests/test_analysis_router.py::test_recommendation_exposes_evidence_fields -v`
Expected: FAIL (the `patch` target `app.routers.analysis.fetch_quote_and_history` doesn't exist
yet — `AttributeError: <module> does not have the attribute 'fetch_quote_and_history'`). This
confirms the test is actually exercising Task 2's not-yet-written code, not a typo.

- [ ] **Step 8: Lint, format, type-check**

Run: `uv run ruff check . && uv run ruff format . && uv run mypy app`
Expected: clean (the new test's expected failure above is a test-run failure, not a lint/type
error).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/ backend/app/schemas.py backend/app/agents/jobs.py backend/tests/test_analysis_router.py
git commit -m "feat: add fundamental_score and technical_signal to recommendations"
```

---

### Task 2: Backend — live quote augmentation and the by-id endpoint

**Files:**
- Modify: `backend/app/routers/analysis.py`
- Modify: `backend/tests/test_analysis_router.py` (mock the quote fetch in two existing tests; add new tests)

**Interfaces:**
- Consumes: `app.agents.market_data.fetch_quote_and_history(ticker: str) -> dict[str, Any]`
  (returns `{"price": float | None, "closes": list[float]}`, already Redis-cached 5 min, already
  retry-wrapped — see `backend/app/agents/market_data.py:39-53`). `RecommendationOut` from Task 1
  (has `current_price`/`price_change_pct` with `None` defaults, and is a plain, mutable Pydantic
  model — not frozen).
- Produces: `GET /analysis/recommendations/{recommendation_id}` (404 if missing/not owned,
  `RecommendationOut` otherwise); every `PENDING` row returned by either `GET
  /analysis/recommendations` or the new by-id endpoint now carries live `current_price`/
  `price_change_pct` when the quote fetch succeeds, both `None` when it fails or the row isn't
  `PENDING`.

- [ ] **Step 1: Write the augmentation helper's failing tests**

Append to `backend/tests/test_analysis_router.py`:

```python
def test_recommendations_list_attaches_live_quotes_for_pending_rows(client, db_session):
    rec = Recommendation(
        user_id=USER_ID,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["x"],
        status="PENDING",
    )
    db_session.add(rec)
    db_session.commit()

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 186.40, "closes": [184.0, 186.40]}),
    ) as mock_fetch:
        response = client.get("/analysis/recommendations?status=PENDING")

    mock_fetch.assert_awaited_once_with("AAPL")
    body = response.json()[0]
    assert body["current_price"] == 186.40
    assert round(body["price_change_pct"], 4) == round((186.40 - 184.0) / 184.0 * 100, 4)


def test_recommendations_list_dedupes_quote_fetches_by_ticker(client, db_session):
    db_session.add_all(
        [
            Recommendation(
                user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="BUY",
                reasoning=["x"], status="PENDING",
            ),
            Recommendation(
                user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="ADD",
                reasoning=["y"], status="PENDING",
            ),
        ]
    )
    db_session.commit()

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 186.40, "closes": [184.0, 186.40]}),
    ) as mock_fetch:
        client.get("/analysis/recommendations?status=PENDING")

    mock_fetch.assert_awaited_once_with("AAPL")


def test_recommendations_quote_failure_degrades_to_null_not_500(client, db_session):
    rec = Recommendation(
        user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="BUY",
        reasoning=["x"], status="PENDING",
    )
    db_session.add(rec)
    db_session.commit()

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(side_effect=RuntimeError("yfinance is down")),
    ):
        response = client.get("/analysis/recommendations?status=PENDING")

    assert response.status_code == 200
    body = response.json()[0]
    assert body["current_price"] is None
    assert body["price_change_pct"] is None


def test_recommendations_quote_augmentation_skipped_for_non_pending(client, db_session):
    rec = Recommendation(
        user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="BUY",
        reasoning=["x"], status="APPROVED",
    )
    db_session.add(rec)
    db_session.commit()

    with patch("app.routers.analysis.fetch_quote_and_history", AsyncMock()) as mock_fetch:
        response = client.get("/analysis/recommendations?status=APPROVED")

    mock_fetch.assert_not_awaited()
    assert response.json()[0]["current_price"] is None


def test_get_recommendation_by_id(client, db_session):
    rec = Recommendation(
        user_id=USER_ID, ticker="AAPL", asset_type="STOCK", action="BUY",
        reasoning=["x"], status="PENDING",
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 186.40, "closes": [184.0, 186.40]}),
    ):
        response = client.get(f"/analysis/recommendations/{rec.id}")

    assert response.status_code == 200
    assert response.json()["ticker"] == "AAPL"
    assert response.json()["current_price"] == 186.40


def test_get_recommendation_by_id_404_when_missing(client):
    assert client.get("/analysis/recommendations/999").status_code == 404


def test_get_recommendation_by_id_404_for_another_users_row(client, db_session):
    rec = _rec(OTHER_USER_ID)
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    assert client.get(f"/analysis/recommendations/{rec.id}").status_code == 404
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `uv run python -m pytest tests/test_analysis_router.py -k "quote or by_id or evidence_fields" -v`
Expected: FAIL — `fetch_quote_and_history` isn't imported into `app.routers.analysis` yet, and
`GET /analysis/recommendations/{id}` doesn't exist (404 tests may pass by coincidence since a
nonexistent route also 404s — that's fine, the found-row tests are the real signal and will fail).

- [ ] **Step 3: Implement the augmentation helpers and wire them in**

In `backend/app/routers/analysis.py`, update the imports (add `logging` and the market-data
import) and add the two helpers plus the new/changed endpoints. Replace lines 1-18 with:

```python
import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.jobs import create_job, get_job_status, run_job
from app.agents.market_data import fetch_quote_and_history
from app.auth.deps import CurrentUser, get_current_user, get_user_db
from app.background import make_task_tracker
from app.models import Holding, Recommendation, WatchlistItem
from app.rate_limit import rate_limiter
from app.schemas import RecommendationOut
from app.usage import check_monthly_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"], dependencies=[Depends(get_current_user)])

_track_background_task = make_task_tracker("analysis")
```

Then replace `list_recommendations` (currently lines 85-94) and everything through the end of
`reject_recommendation` (currently lines 106-112) with:

```python
async def _quote_for_ticker(ticker: str) -> tuple[float, float | None] | None:
    try:
        data = await fetch_quote_and_history(ticker)
    except Exception:
        logger.exception("Live quote fetch failed for %s", ticker)
        return None
    price = data.get("price")
    if price is None:
        return None
    closes = data.get("closes") or []
    change_pct: float | None = None
    if len(closes) >= 2 and closes[-2]:
        change_pct = (closes[-1] - closes[-2]) / closes[-2] * 100
    return price, change_pct


async def _attach_live_quotes(recs: list[RecommendationOut]) -> None:
    """Mutates PENDING rows in place with a live price/day-change; everything else, and any row
    whose fetch fails, is left at the schema's None default — degrading quietly rather than
    ever failing the request over a flaky quote."""
    pending = [r for r in recs if r.status == "PENDING"]
    tickers = {r.ticker for r in pending}
    if not tickers:
        return
    results = await asyncio.gather(*(_quote_for_ticker(t) for t in tickers))
    quotes = dict(zip(tickers, results, strict=True))
    for rec in pending:
        quote = quotes.get(rec.ticker)
        if quote is not None:
            rec.current_price, rec.price_change_pct = quote


@router.get("/recommendations", response_model=list[RecommendationOut])
async def list_recommendations(
    status: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> list[RecommendationOut]:
    query = db.query(Recommendation).filter_by(user_id=user.id)
    if status:
        query = query.filter_by(status=status)
    outs = [RecommendationOut.model_validate(r) for r in query.all()]
    await _attach_live_quotes(outs)
    return outs


@router.get("/recommendations/{recommendation_id}", response_model=RecommendationOut)
async def get_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> RecommendationOut:
    rec = db.query(Recommendation).filter_by(id=recommendation_id, user_id=user.id).one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    out = RecommendationOut.model_validate(rec)
    await _attach_live_quotes([out])
    return out


@router.post("/recommendations/{recommendation_id}/approve", response_model=RecommendationOut)
def approve_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Recommendation:
    return _set_recommendation_status(db, user.id, recommendation_id, "APPROVED")


@router.post("/recommendations/{recommendation_id}/reject", response_model=RecommendationOut)
def reject_recommendation(
    recommendation_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_user_db),
) -> Recommendation:
    return _set_recommendation_status(db, user.id, recommendation_id, "REJECTED")
```

Leave `_set_recommendation_status` (the function after `reject_recommendation`) untouched.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `uv run python -m pytest tests/test_analysis_router.py -k "quote or by_id or evidence_fields" -v`
Expected: PASS, all of them, including Task 1's `test_recommendation_exposes_evidence_fields`.

- [ ] **Step 5: Fix the two existing tests that now incidentally hit the live-quote path**

`test_list_and_approve_recommendation` and
`test_recommendations_list_and_review_only_touch_the_token_users_rows` both list a `PENDING`
recommendation without mocking `fetch_quote_and_history` — before this task, that call didn't
exist; now it does, and an unmocked test would either hang on a real network call or violate
`backend/CLAUDE.md`'s "never call real external APIs in tests" rule outright.

In `test_list_and_approve_recommendation`, wrap only the first `GET` (the one that returns a
`PENDING` row) in the patch — the second `GET` returns `[]` (no `PENDING` rows left after
approving), so `_attach_live_quotes` returns early with no fetch and needs no mock:

```python
def test_list_and_approve_recommendation(client, db_session):
    rec = Recommendation(
        user_id=USER_ID,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        status="PENDING",
    )
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 150.0, "closes": [148.0, 150.0]}),
    ):
        response = client.get("/analysis/recommendations?status=PENDING")
    assert response.status_code == 200
    assert len(response.json()) == 1

    response = client.post(f"/analysis/recommendations/{rec.id}/approve")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"

    response = client.get("/analysis/recommendations?status=PENDING")
    assert response.json() == []
```

In `test_recommendations_list_and_review_only_touch_the_token_users_rows`, wrap the `listed = ...`
call (the only one that lists a still-`PENDING` row — `theirs` is `PENDING` at that point in the
test):

```python
def test_recommendations_list_and_review_only_touch_the_token_users_rows(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    mine = _rec(USER_ID, "AAPL")
    theirs = _rec(OTHER_USER_ID, "MSFT")
    db_session.add_all([mine, theirs])
    db_session.commit()
    headers = auth_headers(OTHER_USER_ID)

    with patch(
        "app.routers.analysis.fetch_quote_and_history",
        AsyncMock(return_value={"price": 300.0, "closes": [298.0, 300.0]}),
    ):
        listed = client.get("/analysis/recommendations", headers=headers).json()
    assert [r["ticker"] for r in listed] == ["MSFT"]

    approve = client.post(f"/analysis/recommendations/{theirs.id}/approve", headers=headers)
    assert approve.status_code == 200
    reject_mine = client.post(f"/analysis/recommendations/{mine.id}/reject", headers=headers)
    assert reject_mine.status_code == 404
    db_session.refresh(mine)
    db_session.refresh(theirs)
    assert theirs.status == "APPROVED"
    assert mine.status == "PENDING"
```

The other existing tests in this file are unaffected: `test_recommendations_exclude_other_users`
only ever sees `[]` for the token user (the other user's row is invisible under RLS, so no
`PENDING` row ever reaches `_attach_live_quotes`); the approve/reject/404/auth tests never call a
`GET` that returns a `PENDING` row.

- [ ] **Step 6: Run the full analysis test file**

Run: `uv run python -m pytest tests/test_analysis_router.py -v`
Expected: PASS, all tests, including every pre-existing one.

- [ ] **Step 7: Lint, format, type-check**

Run: `uv run ruff check . && uv run ruff format . && uv run mypy app`
Expected: clean.

- [ ] **Step 8: Run the full backend suite**

Run: `uv run python -m pytest tests/ -v`
Expected: PASS (369+ tests, no regressions elsewhere).

- [ ] **Step 9: Commit**

```bash
git add backend/app/routers/analysis.py backend/tests/test_analysis_router.py
git commit -m "feat: live quote augmentation and GET /analysis/recommendations/{id}"
```

---

### Task 3: Frontend — recommendation types and the EvidencePanel component

**Files:**
- Create: `frontend/lib/api/recommendation-types.ts`
- Create: `frontend/components/recommendations/EvidencePanel.tsx`
- Test: `frontend/components/recommendations/EvidencePanel.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier frontend tasks (this is the first recommendations-domain
  frontend file). Mirrors Task 1/2's `RecommendationOut` field-for-field.
- Produces: `RecommendationOut` type, `JobStatus` type (both exported from
  `recommendation-types.ts`, consumed by every later task); `EvidencePanel({ recommendation:
  RecommendationOut })` (exported from `EvidencePanel.tsx`, consumed by Task 4 and Task 7).

- [ ] **Step 1: Write the types file**

```typescript
// frontend/lib/api/recommendation-types.ts
export type Action = "BUY" | "ADD" | "HOLD" | "TRIM" | "SELL" | "WATCH";
export type TechnicalSignal = "NEUTRAL" | "OVERSOLD" | "STRONG_UPTREND" | "WEAK_DOWNTREND";
export type RecommendationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RecommendationOut {
  id: number;
  user_id: string;
  created_at: string;
  ticker: string;
  asset_type: "ETF" | "STOCK";
  action: Action;
  reasoning: string[];
  ai_analysis: string | null;
  suggested_position_pct: number | null;
  status: RecommendationStatus;
  reviewed_at: string | null;
  fundamental_score: number | null;
  technical_signal: TechnicalSignal | null;
  price_at_recommendation: number | null;
  current_price: number | null;
  price_change_pct: number | null;
}

export interface JobResult {
  ticker: string;
  recommendation_id?: number;
  skipped?: boolean;
  error?: string;
}

export interface JobStatus {
  status: "RUNNING" | "DONE" | "FAILED";
  total: number;
  done: number;
  results: JobResult[];
}
```

- [ ] **Step 2: Write EvidencePanel's failing test**

```typescript
// frontend/components/recommendations/EvidencePanel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidencePanel } from "./EvidencePanel";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Fundamental score 78/100", "Technical signal: OVERSOLD"],
    ai_analysis: "Earnings beat on services.",
    suggested_position_pct: 0.075,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 78,
    technical_signal: "OVERSOLD",
    price_at_recommendation: 186.4,
    current_price: 186.4,
    price_change_pct: -1.2,
    ...overrides,
  };
}

describe("EvidencePanel", () => {
  it("shows the fundamentals score, technical signal, and suggested size", () => {
    render(<EvidencePanel recommendation={rec()} />);

    expect(screen.getByText(/78/)).toBeInTheDocument();
    expect(screen.getByText("Oversold")).toBeInTheDocument();
    expect(screen.getByText(/7\.5%/)).toBeInTheDocument();
  });

  it("omits the fundamentals row when there is no score", () => {
    render(<EvidencePanel recommendation={rec({ fundamental_score: null })} />);

    expect(screen.queryByText(/Fundamentals/i)).not.toBeInTheDocument();
  });

  it("omits the suggested size row when there is none", () => {
    render(<EvidencePanel recommendation={rec({ suggested_position_pct: null })} />);

    expect(screen.queryByText(/Suggested size/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- run components/recommendations/EvidencePanel.test.tsx`
Expected: FAIL — `EvidencePanel.tsx` doesn't exist yet.

- [ ] **Step 4: Implement EvidencePanel**

```tsx
// frontend/components/recommendations/EvidencePanel.tsx
import { Box, Typography, LinearProgress } from "@mui/material";
import type { RecommendationOut, TechnicalSignal } from "@/lib/api/recommendation-types";

const SIGNAL_LABEL: Record<TechnicalSignal, string> = {
  NEUTRAL: "Neutral",
  OVERSOLD: "Oversold",
  STRONG_UPTREND: "Strong uptrend",
  WEAK_DOWNTREND: "Weak downtrend",
};

// Matches the mockups' pill convention: oversold/strong-uptrend read as favorable (green),
// weak-downtrend as unfavorable (red), neutral as neither (muted).
const SIGNAL_COLOR: Record<TechnicalSignal, string> = {
  NEUTRAL: "var(--muted)",
  OVERSOLD: "var(--up)",
  STRONG_UPTREND: "var(--up)",
  WEAK_DOWNTREND: "var(--down)",
};

export function EvidencePanel({ recommendation }: { recommendation: RecommendationOut }) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;

  return (
    <Box sx={{ mt: 1.5 }}>
      {fundamental_score !== null && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Fundamentals</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{fundamental_score}/100</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={fundamental_score}
            sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
          />
        </Box>
      )}
      {technical_signal !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Technical timing</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: SIGNAL_COLOR[technical_signal] }}>
            {SIGNAL_LABEL[technical_signal]}
          </Typography>
        </Box>
      )}
      {suggested_position_pct !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Suggested size</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {(suggested_position_pct * 100).toFixed(1)}% of portfolio
          </Typography>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- run components/recommendations/EvidencePanel.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/recommendation-types.ts frontend/components/recommendations/EvidencePanel.tsx frontend/components/recommendations/EvidencePanel.test.tsx
git commit -m "feat: recommendation types and the EvidencePanel component"
```

---

### Task 4: Frontend — RecommendationCard

**Files:**
- Create: `frontend/components/recommendations/RecommendationCard.tsx`
- Test: `frontend/components/recommendations/RecommendationCard.test.tsx`

**Interfaces:**
- Consumes: `RecommendationOut` (Task 3), `EvidencePanel` (Task 3), `apiFetch`/`ApiError` (existing,
  `frontend/lib/api/client.ts`).
- Produces: `RecommendationCard({ recommendation, onDecided }: { recommendation:
  RecommendationOut; onDecided: (updated: RecommendationOut) => void })` — calls `onDecided` with
  the backend's updated row after a successful Approve/Dismiss. The card never shows a
  confirmation itself (only the detail page does — see Task 5/7); the parent (Task 6) reacts by
  revalidating the list, which drops the card since it's no longer `PENDING`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/components/recommendations/RecommendationCard.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { RecommendationCard } from "./RecommendationCard";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Fundamental score 78/100", "Technical signal: OVERSOLD"],
    ai_analysis: "Earnings beat on services. Coverage flags China demand risk.",
    suggested_position_pct: 0.075,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 78,
    technical_signal: "OVERSOLD",
    price_at_recommendation: 186.4,
    current_price: 186.4,
    price_change_pct: -1.2,
    ...overrides,
  };
}

describe("RecommendationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows ticker, action, price, day change, and the first sentence of ai_analysis", () => {
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText(/186\.4/)).toBeInTheDocument();
    expect(screen.getByText(/-1\.2%/)).toBeInTheDocument();
    expect(screen.getByText("Earnings beat on services.")).toBeInTheDocument();
  });

  it("omits the price row when the live quote is unavailable", () => {
    render(
      <RecommendationCard
        recommendation={rec({ current_price: null, price_change_pct: null })}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.queryByText(/186\.4/)).not.toBeInTheDocument();
  });

  it("falls back to the technical-signal reasoning line when ai_analysis is null", () => {
    render(<RecommendationCard recommendation={rec({ ai_analysis: null })} onDecided={vi.fn()} />);

    expect(screen.getByText("Technical signal: OVERSOLD")).toBeInTheDocument();
  });

  it("approves and calls onDecided with the updated recommendation", async () => {
    const onDecided = vi.fn();
    const updated = rec({ status: "APPROVED" });
    apiFetch.mockResolvedValue(updated);
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(updated));
  });

  it("dismisses and calls onDecided", async () => {
    const onDecided = vi.fn();
    apiFetch.mockResolvedValue(rec({ status: "REJECTED" }));
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows an inline error and does not call onDecided when approve fails", async () => {
    const onDecided = vi.fn();
    apiFetch.mockRejectedValue(new FakeApiError(500, "Something broke"));
    render(<RecommendationCard recommendation={rec()} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByText("Something broke")).toBeInTheDocument());
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first approve is still in flight", async () => {
    let resolve!: (value: RecommendationOut) => void;
    apiFetch.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<RecommendationCard recommendation={rec()} onDecided={vi.fn()} />);

    const approveButton = screen.getByRole("button", { name: /approve/i });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    resolve(rec({ status: "APPROVED" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run components/recommendations/RecommendationCard.test.tsx`
Expected: FAIL — `RecommendationCard.tsx` doesn't exist yet.

- [ ] **Step 3: Implement RecommendationCard**

```tsx
// frontend/components/recommendations/RecommendationCard.tsx
"use client";

import { useState } from "react";
import { Box, Typography, Button, Alert, Chip } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";
import { EvidencePanel } from "./EvidencePanel";

// Matches the mockups' badge convention: BUY/ADD/HOLD/WATCH share the default accent badge,
// TRIM gets the warning color, SELL the down color (the one action styled inline, not via a
// shared class, in the original mockup — folded into this same lookup for one consistent path).
const ACTION_COLOR: Record<Action, { bg: string; fg: string }> = {
  BUY: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  ADD: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  HOLD: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  WATCH: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  TRIM: { bg: "var(--warn)", fg: "var(--on-accent)" },
  SELL: { bg: "var(--down)", fg: "#fff" },
};

function reasoningLine(recommendation: RecommendationOut): string | null {
  if (recommendation.ai_analysis) {
    const end = recommendation.ai_analysis.indexOf(". ");
    return end === -1 ? recommendation.ai_analysis : recommendation.ai_analysis.slice(0, end + 1);
  }
  return recommendation.reasoning.at(-1) ?? null;
}

export function RecommendationCard({
  recommendation,
  onDecided,
}: {
  recommendation: RecommendationOut;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function decide(action: "approve" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${recommendation.id}/${action}`,
        { method: "POST" },
      );
      onDecided(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const line = reasoningLine(recommendation);
  const colors = ACTION_COLOR[recommendation.action];

  return (
    <Box sx={{ p: 2, border: "1px solid var(--line)", borderRadius: 2, mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 650, letterSpacing: "-.03em" }}>
          {recommendation.ticker}
        </Typography>
        <Chip
          label={recommendation.action}
          size="small"
          sx={{ bgcolor: colors.bg, color: colors.fg, fontWeight: 700 }}
        />
        <Box sx={{ flex: 1 }} />
        {recommendation.current_price !== null && (
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontWeight: 600 }}>{recommendation.current_price.toFixed(2)}</Typography>
            {recommendation.price_change_pct !== null && (
              <Typography
                sx={{
                  fontSize: 12,
                  color:
                    recommendation.price_change_pct >= 0 ? "var(--up)" : "var(--down)",
                }}
              >
                {recommendation.price_change_pct >= 0 ? "+" : ""}
                {recommendation.price_change_pct.toFixed(1)}%
              </Typography>
            )}
          </Box>
        )}
      </Box>
      <EvidencePanel recommendation={recommendation} />
      {line && (
        <Typography sx={{ fontSize: 13, color: "var(--text2)", mt: 1.5 }}>{line}</Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1.25, mt: 1.5 }}>
        <Button variant="outlined" fullWidth disabled={submitting} onClick={() => decide("reject")}>
          Dismiss
        </Button>
        <Button variant="contained" fullWidth disabled={submitting} onClick={() => decide("approve")}>
          Approve
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 1, textAlign: "center" }}>
        Approving records your decision. Nothing is sent to a broker.
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- run components/recommendations/RecommendationCard.test.tsx`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/recommendations/RecommendationCard.tsx frontend/components/recommendations/RecommendationCard.test.tsx
git commit -m "feat: RecommendationCard with inline approve/dismiss"
```

---

### Task 5: Frontend — WebOpinionBox and ConfirmationPanel

**Files:**
- Create: `frontend/components/recommendations/WebOpinionBox.tsx`
- Create: `frontend/components/recommendations/ConfirmationPanel.tsx`
- Test: `frontend/components/recommendations/ConfirmationPanel.test.tsx`

**Interfaces:**
- Consumes: `RecommendationOut` (Task 3), `apiFetch`/`ApiError` (existing).
- Produces: `WebOpinionBox({ text }: { text: string })` (consumed by Task 7, detail-only per the
  spec — never rendered by `RecommendationCard`). `ConfirmationPanel({ recommendation, onChanged,
  onBackToToday }: { recommendation: RecommendationOut; onChanged: (updated: RecommendationOut) =>
  void; onBackToToday: () => void })` — consumed by Task 7 only. The Today list (Task 6) never
  shows this: a list-card decision just removes the card via revalidation, and "Back to Today"
  would be nonsensical navigation copy on the page you're already standing on.

- [ ] **Step 1: Implement WebOpinionBox (presentational, no test needed — it's a 12-line pass-through with no branching logic)**

```tsx
// frontend/components/recommendations/WebOpinionBox.tsx
import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";

export function WebOpinionBox({ text }: { text: string }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        border: "1px dashed var(--line2)",
        borderRadius: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Globe size={15} color="var(--muted)" />
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          Web second opinion &middot; not part of the score
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 13, mt: 0.5 }}>{text}</Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Write ConfirmationPanel's failing test**

```typescript
// frontend/components/recommendations/ConfirmationPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import { ConfirmationPanel } from "./ConfirmationPanel";

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "NVDA",
    asset_type: "STOCK",
    action: "TRIM",
    reasoning: ["x"],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED",
    reviewed_at: "2026-01-02T00:00:00",
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

describe("ConfirmationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows what was decided, for an approved recommendation", () => {
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    expect(screen.getByText(/decision recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/TRIM/)).toBeInTheDocument();
    expect(screen.getByText(/nothing was sold/i)).toBeInTheDocument();
  });

  it("calls onBackToToday when that button is clicked", () => {
    const onBackToToday = vi.fn();
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={onBackToToday} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back to today/i }));
    expect(onBackToToday).toHaveBeenCalled();
  });

  it("changing the decision on an approved recommendation calls reject and onChanged", async () => {
    const onChanged = vi.fn();
    const reverted = rec({ status: "REJECTED" });
    apiFetch.mockResolvedValue(reverted);
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={onChanged} onBackToToday={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(reverted));
  });

  it("changing the decision on a rejected recommendation calls approve", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    render(
      <ConfirmationPanel
        recommendation={rec({ status: "REJECTED" })}
        onChanged={vi.fn()}
        onBackToToday={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/analysis/recommendations/1/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows an inline error when changing the decision fails", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "Something broke"));
    render(
      <ConfirmationPanel recommendation={rec()} onChanged={vi.fn()} onBackToToday={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change my decision/i }));

    await waitFor(() => expect(screen.getByText("Something broke")).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- run components/recommendations/ConfirmationPanel.test.tsx`
Expected: FAIL — `ConfirmationPanel.tsx` doesn't exist yet.

- [ ] **Step 4: Implement ConfirmationPanel**

```tsx
// frontend/components/recommendations/ConfirmationPanel.tsx
"use client";

import { useState } from "react";
import { Box, Typography, Button, Alert } from "@mui/material";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

export function ConfirmationPanel({
  recommendation,
  onChanged,
  onBackToToday,
}: {
  recommendation: RecommendationOut;
  onChanged: (updated: RecommendationOut) => void;
  onBackToToday: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function changeDecision() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // Neither endpoint guards on the current status — calling the opposite action on an
    // already-decided recommendation cleanly reverses it. No backend change needed.
    const oppositeAction = recommendation.status === "APPROVED" ? "reject" : "approve";
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${recommendation.id}/${oppositeAction}`,
        { method: "POST" },
      );
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const approved = recommendation.status === "APPROVED";

  return (
    <Box sx={{ textAlign: "center", p: 3 }}>
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          mx: "auto",
          bgcolor: approved ? "var(--up-bg)" : "var(--down-bg)",
          color: approved ? "var(--up)" : "var(--down)",
        }}
      >
        <CheckCircle2 size={30} />
      </Box>
      <Typography sx={{ fontSize: 22, fontWeight: 650, mt: 2 }}>Decision recorded</Typography>
      <Typography sx={{ color: "var(--text2)", mt: 1 }}>
        You {approved ? "approved" : "dismissed"} {recommendation.ticker} &middot;{" "}
        {recommendation.action}.
      </Typography>
      {approved && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            textAlign: "left",
            mt: 2.5,
            p: 1.5,
            bgcolor: "var(--warn-bg)",
            borderRadius: 1.5,
          }}
        >
          <AlertTriangle size={17} color="var(--warn)" style={{ flexShrink: 0 }} />
          <Typography sx={{ fontSize: 13 }}>
            <b>Nothing was sold.</b> trade-agent never trades. If you decide to act, do it in your
            broker app.
          </Typography>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2, textAlign: "left" }}>
          {error}
        </Alert>
      )}
      <Button variant="outlined" fullWidth sx={{ mt: 2.5 }} onClick={onBackToToday}>
        Back to Today
      </Button>
      <Button
        variant="text"
        fullWidth
        sx={{ mt: 1 }}
        disabled={submitting}
        onClick={changeDecision}
      >
        Change my decision
      </Button>
    </Box>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- run components/recommendations/ConfirmationPanel.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 6: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/recommendations/WebOpinionBox.tsx frontend/components/recommendations/ConfirmationPanel.tsx frontend/components/recommendations/ConfirmationPanel.test.tsx
git commit -m "feat: WebOpinionBox and ConfirmationPanel components"
```

---

### Task 6: Frontend — the Today page

**Files:**
- Modify: `frontend/app/(shell)/today/page.tsx` (replaces the sub-project 5 placeholder)
- Test: `frontend/app/(shell)/today/page.test.tsx`

**Interfaces:**
- Consumes: `RecommendationCard` (Task 4), `RecommendationOut`/`JobStatus` (Task 3), `apiFetch`/
  `ApiError` (existing). Does **not** consume `ConfirmationPanel` (Task 5) — that's detail-page
  only; see Task 5/7.
- Produces: the Today route itself — nothing else consumes this file.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/app/(shell)/today/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import TodayPage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: ["Technical signal: OVERSOLD"],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

describe("TodayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists pending recommendations", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.startsWith("/analysis/recommendations") ? Promise.resolve([rec()]) : Promise.reject(new Error("unexpected")),
    );
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
  });

  it("shows a calm empty state with no pending recommendations", async () => {
    apiFetch.mockResolvedValue([]);
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
  });

  it("shows an inline error when the list fails to load", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
  });

  it("approving a card removes it from the list (no inline confirmation on Today)", async () => {
    let listCall = 0;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") {
        listCall += 1;
        return Promise.resolve(listCall === 1 ? [rec()] : []);
      }
      if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") {
        return Promise.resolve(rec({ status: "APPROVED" }));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    expect(screen.queryByText(/decision recorded/i)).not.toBeInTheDocument();
  });

  it("runs analysis, polls while running, and refreshes the list on completion", async () => {
    vi.useFakeTimers();
    const running: JobStatus = { status: "RUNNING", total: 1, done: 0, results: [] };
    const done: JobStatus = { status: "DONE", total: 1, done: 1, results: [{ ticker: "AAPL", recommendation_id: 1 }] };
    let listCall = 0;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") {
        listCall += 1;
        return Promise.resolve(listCall === 1 ? [] : [rec()]);
      }
      if (path === "/analysis/run" && init?.method === "POST") {
        return Promise.resolve({ job_id: "job-1" });
      }
      if (path === "/analysis/run/job-1") {
        return Promise.resolve(running.status === "RUNNING" ? running : done);
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/analysis/run", expect.objectContaining({ method: "POST" })));

    running.status = "DONE";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("shows a distinct banner when the analysis job fails outright", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run" && init?.method === "POST") return Promise.resolve({ job_id: "job-1" });
      if (path === "/analysis/run/job-1") {
        return Promise.resolve({ status: "FAILED", total: 1, done: 0, results: [] });
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => expect(screen.getByText(/analysis failed/i)).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("shows the backend's detail message when Run analysis hits the monthly cap", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run") {
        return Promise.reject(new FakeApiError(429, "Monthly limit reached (100 analysis runs this month)."));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => expect(screen.getByText(/monthly limit reached/i)).toBeInTheDocument());
  });

  it("does not warn on unmount while a job is still polling", async () => {
    vi.useFakeTimers();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations?status=PENDING") return Promise.resolve([]);
      if (path === "/analysis/run" && init?.method === "POST") return Promise.resolve({ job_id: "job-1" });
      if (path === "/analysis/run/job-1") {
        return Promise.resolve({ status: "RUNNING", total: 1, done: 0, results: [] });
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderFresh(<TodayPage />);

    await waitFor(() => expect(screen.getByText(/no recommendations right now/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/analysis/run", expect.anything()));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run "app/(shell)/today/page.test.tsx"`
Expected: FAIL — the placeholder page has none of this behavior.

- [ ] **Step 3: Implement the Today page**

```tsx
// frontend/app/(shell)/today/page.tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button } from "@mui/material";
import { Play } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";

export default function TodayPage() {
  const {
    data: recommendations,
    error: loadError,
    mutate,
  } = useSWR<RecommendationOut[]>("/analysis/recommendations?status=PENDING", apiFetch);
  const [jobId, setJobId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data: job } = useSWR<JobStatus>(
    jobId ? `/analysis/run/${jobId}` : null,
    apiFetch,
    { refreshInterval: (data) => (data?.status === "RUNNING" ? 2000 : 0) },
  );

  if (job && job.status !== "RUNNING" && jobId) {
    // Job just finished (DONE or FAILED) — pull in whatever new recommendations exist, and stop
    // treating this job as active so a second Run-analysis click starts a fresh one.
    mutate();
    setJobId(null);
  }

  const running = jobId !== null;

  async function runAnalysis() {
    setRunError(null);
    try {
      const { job_id } = await apiFetch<{ job_id: string }>("/analysis/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setJobId(job_id);
    } catch (err) {
      setRunError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  const failedCount = job?.status === "DONE" ? job.results.filter((r) => r.error).length : 0;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Today
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>
          Awaiting you: {recommendations?.length ?? 0}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Play size={14} />}
          disabled={running}
          onClick={runAnalysis}
        >
          {running ? "Running…" : "Run analysis"}
        </Button>
      </Box>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load recommendations.
        </Alert>
      )}
      {runError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {runError}
        </Alert>
      )}
      {job?.status === "FAILED" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Analysis failed. Try again in a moment.
        </Alert>
      )}
      {job?.status === "DONE" && failedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {job.results.length - failedCount} analyzed, {failedCount} failed.
        </Alert>
      )}
      {recommendations?.length === 0 && (
        <Box sx={{ textAlign: "center", py: 6 }}>
          <Typography sx={{ color: "var(--muted)", mb: 2 }}>No recommendations right now.</Typography>
          <Button variant="contained" startIcon={<Play size={14} />} disabled={running} onClick={runAnalysis}>
            Run analysis
          </Button>
        </Box>
      )}
      {recommendations?.map((recommendation) => (
        // No inline confirmation here — approving/dismissing just revalidates the list, and the
        // card disappears because it's no longer PENDING. The full "Decision recorded" screen is
        // the detail page's job (/today/[id], Task 7); "Back to Today" would be nonsensical copy
        // on the page you're already standing on.
        <RecommendationCard key={recommendation.id} recommendation={recommendation} onDecided={() => mutate()} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- run "app/(shell)/today/page.test.tsx"`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "frontend/app/(shell)/today/page.tsx" "frontend/app/(shell)/today/page.test.tsx"
git commit -m "feat: Today page with recommendation list and run-analysis polling"
```

---

### Task 7: Frontend — recommendation detail page

**Files:**
- Create: `frontend/app/(shell)/today/[id]/page.tsx`
- Test: `frontend/app/(shell)/today/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `EvidencePanel` (Task 3), `WebOpinionBox` and `ConfirmationPanel` (Task 5),
  `RecommendationOut` (Task 3), `apiFetch`/`ApiError` (existing). Reads the route's `id` param via
  `useParams()` from `next/navigation`.
- Produces: the `/today/[id]` route — nothing else consumes this file.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/app/(shell)/today/[id]/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: "1" }),
}));

import RecommendationDetailPage from "./page";

function renderFresh(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "NVDA",
    asset_type: "STOCK",
    action: "TRIM",
    reasoning: ["Fundamental score 52/100", "Technical signal: NEUTRAL"],
    ai_analysis: "Coverage leans positive on demand. This conflicts with the fundamentals reading.",
    suggested_position_pct: 0.05,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: 52,
    technical_signal: "NEUTRAL",
    price_at_recommendation: 121.6,
    current_price: 121.6,
    price_change_pct: -1.8,
    ...overrides,
  };
}

describe("RecommendationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the full evidence, reasoning list, and web opinion", async () => {
    apiFetch.mockResolvedValue(rec());
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    expect(screen.getByText("Fundamental score 52/100")).toBeInTheDocument();
    expect(screen.getByText("Technical signal: NEUTRAL")).toBeInTheDocument();
    expect(screen.getByText(/not part of the score/i)).toBeInTheDocument();
    expect(screen.getByText(/conflicts with the fundamentals reading/i)).toBeInTheDocument();
  });

  it("shows an inline error when the recommendation fails to load", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(404, "Recommendation not found"));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("Recommendation not found")).toBeInTheDocument());
  });

  it("shows the confirmation panel immediately when the recommendation was already decided", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("approving swaps to the confirmation panel", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations/1") return Promise.resolve(rec());
      if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") {
        return Promise.resolve(rec({ status: "APPROVED" }));
      }
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
  });

  it("back to Today navigates to /today", async () => {
    apiFetch.mockResolvedValue(rec({ status: "APPROVED" }));
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText(/decision recorded/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /back to today/i }));

    expect(push).toHaveBeenCalledWith("/today");
  });

  it("ignores a second click while the first dismiss is still in flight", async () => {
    let resolve!: (value: RecommendationOut) => void;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/analysis/recommendations/1") return Promise.resolve(rec());
      return new Promise((r) => { resolve = r; });
    });
    renderFresh(<RecommendationDetailPage />);

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
    const dismissButton = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissButton);
    fireEvent.click(dismissButton);

    resolve(rec({ status: "REJECTED" }));
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter((c) => c[0] === "/analysis/recommendations/1/reject")).toHaveLength(1),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run "app/(shell)/today/[id]/page.test.tsx"`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Implement the detail page**

```tsx
// frontend/app/(shell)/today/[id]/page.tsx
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Box, Typography, Button, Alert, Chip } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { EvidencePanel } from "@/components/recommendations/EvidencePanel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";
import { ConfirmationPanel } from "@/components/recommendations/ConfirmationPanel";

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: recommendation, error: loadError, mutate } = useSWR<RecommendationOut>(
    `/analysis/recommendations/${id}`,
    apiFetch,
  );
  const [decided, setDecided] = useState<RecommendationOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loadError) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {loadError instanceof ApiError ? loadError.detail : "Could not load this recommendation."}
      </Alert>
    );
  }

  if (!recommendation) {
    return null;
  }

  const current = decided ?? recommendation;

  if (current.status !== "PENDING") {
    return (
      <ConfirmationPanel
        recommendation={current}
        onChanged={setDecided}
        onBackToToday={() => router.push("/today")}
      />
    );
  }

  async function decide(action: "approve" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${current.id}/${action}`,
        { method: "POST" },
      );
      setDecided(updated);
      mutate(updated, { revalidate: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Typography sx={{ fontSize: 30, fontWeight: 650, letterSpacing: "-.03em" }}>
          {current.ticker}
        </Typography>
        <Chip label={current.action} size="small" />
      </Box>
      <EvidencePanel recommendation={current} />
      <Box sx={{ mt: 1.5 }}>
        {current.reasoning.map((line, i) => (
          <Typography key={i} sx={{ fontSize: 13, color: "var(--text2)", mt: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>
      {current.ai_analysis && <WebOpinionBox text={current.ai_analysis} />}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1.25, mt: 2 }}>
        <Button variant="outlined" fullWidth disabled={submitting} onClick={() => decide("reject")}>
          Dismiss
        </Button>
        <Button variant="contained" fullWidth disabled={submitting} onClick={() => decide("approve")}>
          Approve
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 1, textAlign: "center" }}>
        Approving records your decision. Nothing is sent to a broker.
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- run "app/(shell)/today/[id]/page.test.tsx"`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the full frontend suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with `/today` and `/today/[id]` registered as routes.

- [ ] **Step 7: Commit**

```bash
git add "frontend/app/(shell)/today/[id]/page.tsx" "frontend/app/(shell)/today/[id]/page.test.tsx"
git commit -m "feat: recommendation detail page"
```
