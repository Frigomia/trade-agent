# Investment Preferences Capture (4b) — Design Spec

Sub-project 4b of the analysis-agent evolution (ARCHITECTURE.md §15.1 step
4). The roadmap flagged "how investment preferences are captured" as an
open design question worth its own brainstorm rather than guessing ahead
of time; this spec answers it. 4a (chat agent) is merged. 4c
(`build_context()`, the function that will actually consume this data)
comes after this ships.

## Scope

In scope:
- One new table, `InvestmentPreferences` — a single row per user holding
  risk tolerance, a sector avoid-list, and a free-text notes field.
- `backend/app/routers/preferences.py`: `GET /preferences`,
  `POST /preferences` (upsert).
- `PreferencesIn`/`PreferencesOut` schemas in `backend/app/schemas.py`.

Out of scope:
- Consuming `InvestmentPreferences` anywhere. Not in `agents/chat.py`'s
  portfolio-context string, not in `analysis/recommend.py` or
  `analysis/technical.py`. Wiring it into what the agent reasons over is
  4c's job — this sub-project stops at capture + storage, same boundary
  3b drew around embeddings before step 4 existed to consume them.
- Any change to the three existing global thresholds
  (`max_single_position_pct`, `rsi_oversold`, `fundamental_buy_threshold`
  in `app/config.py`). These stay env-only Settings, read directly by
  `recommend.py`/`technical.py`. A stored preference never reaches
  CLAUDE.md's "fundamentals gate, technicals time, never reverse" rule —
  that stays pure deterministic code, not something a database row could
  bend. `InvestmentPreferences` is additive, LLM-facing context only.
- A `DELETE /preferences` endpoint (reset to empty). Not requested;
  `POST` with empty fields already achieves this.
- Multi-tenancy of any kind. One row per `user_id`, enforced by a unique
  constraint — this is a single-user system (`settings.default_user_id`,
  no auth), so "per-user" is a schema-level guarantee, not a feature.
- Chat-driven capture (e.g. "remember that I prefer dividend stocks" in
  a chat message, parsed and saved). §8 Phase 1's chat agent explicitly
  has "no tool-calling, no ability to take actions" — writing to
  preferences from chat would be an action. Capture is a plain REST
  endpoint, same as `Holding`/`WatchlistItem`.

## Data Model

New table, `backend/app/models.py`:

```python
class InvestmentPreferences(Base):
    __tablename__ = "investment_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    risk_tolerance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sector_avoid_list: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

`unique=True` on `user_id` is the single-profile-per-user constraint,
enforced at the DB level, not just by application convention.
`sector_avoid_list` follows `Recommendation.reasoning`'s existing
`JSON`-backed `list[str]` pattern — no new column-type precedent needed.
`risk_tolerance` is a plain `String(20)`, not a Postgres enum type —
validated at the Pydantic layer (`Literal`), matching how `Holding.asset_type`/
`WatchlistItem.asset_type` are already `String(10)` with the Literal
validation living in `schemas.py`, not the DB.

Migration: `alembic revision --autogenerate` — a plain new table, no hand
edits needed (unlike 3b's `pgvector` extension statement).

## `backend/app/routers/preferences.py`

Follows `routers/portfolio.py`'s existing `POST`-as-upsert convention
exactly (see `upsert_holding`/`upsert_watchlist_item`) — no new pattern
introduced.

```
GET /preferences
  -> db.query(InvestmentPreferences).filter_by(user_id=default_user_id).one_or_none()
  -> if None: return the schema's default shape (risk_tolerance=None,
     sector_avoid_list=[], notes=None) without creating a row. A fresh
     install must be able to GET before ever POSTing — no 404.
  -> if found: return it

POST /preferences {risk_tolerance?, sector_avoid_list?, notes?}
  -> query for existing row (filter_by(user_id=default_user_id).one_or_none())
  -> if None: create InvestmentPreferences(user_id=default_user_id, **payload.model_dump())
  -> if found: for field, value in payload.model_dump().items(): setattr(row, field, value)
  -> commit, refresh, return
```

## `backend/app/schemas.py`

```python
RiskTolerance = Literal["conservative", "moderate", "aggressive"]

class PreferencesIn(BaseModel):
    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[str] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)

class PreferencesOut(PreferencesIn):
    model_config = ConfigDict(from_attributes=True)
```

`notes` capped at 2000 chars, matching this project's established
precedent (`MemorySimilarIn.query` at 4000, `ChatIn.message` at 4000) for
free-text fields with no DB-level limit (`Text` column) but a real
app-level sanity cap. `PreferencesOut` has no `id`/`user_id` — a
single-profile-per-user resource has nothing else worth exposing, unlike
`HoldingOut`/`WatchlistItemOut` which list multiple rows and need an id
to address one.

## Testing

Mirrors `portfolio.py`'s existing upsert-endpoint tests (real Postgres via
the `client`/`db_session` fixtures, no mocking — this is plain CRUD, not
an external API call):
- `GET /preferences` before any `POST` returns the default empty shape,
  not a 404.
- `POST /preferences` with no existing row creates one.
- A second `POST /preferences` updates the same row (assert only one row
  exists in the table afterward, not two).
- Oversized `notes` (>2000 chars) is rejected with 422.
- `sector_avoid_list` round-trips correctly through the `JSON` column.
