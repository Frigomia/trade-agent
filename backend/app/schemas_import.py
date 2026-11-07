"""The strict shape of an export file the importer will accept (see the data-import design).

The file is exactly what GET /me/export emits. Every list the importer restores has an item model
here that (a) accepts every field the export emits for that list, including computed and read-only
ones, which are declared only so they can be ignored, and (b) rejects any other key. Stored
fields are held to the same rules as typed input (the *In models and their aliases), tightened
where a file can carry what a form cannot: NaN, infinity, numbers beyond the column. Text the app
only stores (names, sectors, notes) may hold any character but NUL, as the typed notes do: market
data names can. Text the typed path restricts (recurring label, sector to avoid, ticker, plan line
reason) keeps that restriction. Unknown TOP-LEVEL keys (profile, telegram, the AI output) are
ignored: they are the data the importer does not restore, and nothing reads them.
"""

from collections.abc import Sequence
from datetime import date
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NaiveDatetime,
    field_validator,
    model_validator,
)

from app.limits import MAX_HOLDINGS, MAX_PLANS, MAX_RECURRING
from app.recurring import today
from app.schemas import (
    EXPORT_FORMAT_VERSION,
    AssetType,
    AutoAnalysisPaused,
    HoldingIn,
    PreferencesIn,
    TargetPrice,
    Ticker,
    TradeIn,
    WatchlistItemBase,
    check_price_range,
)
from app.schemas_recurring import RecurringIn

# The lists without a cap of their own, sized from a heavy realistic export plus headroom. The
# watchlist cap is routers.portfolio.MAX_WATCHLIST (a test keeps the two equal); holdings, saved
# plans and recurring plans use MAX_HOLDINGS, MAX_PLANS and MAX_RECURRING. The whole file is also
# bounded in bytes (body_limit).
IMPORT_LIST_LIMITS: dict[str, int] = {
    "watchlist_items": 100,
    "trades": 10_000,  # ~25 a month for 30 years
    "portfolio_snapshots": 10_000,  # one a day for 27 years
    "recurring_occurrences": 20_000,  # 100 plans, monthly, for 16 years
}
_LIMITS = {
    "holdings": MAX_HOLDINGS,
    "contribution_plans": MAX_PLANS,
    "recurring_investments": MAX_RECURRING,
    **IMPORT_LIST_LIMITS,
}
# The words the screen uses for each list (frontend/lib/importFile.ts), for the over-limit message.
LIST_LABELS = {
    "holdings": "holdings",
    "watchlist_items": "watchlist companies",
    "trades": "trades",
    "portfolio_snapshots": "saved daily values",
    "contribution_plans": "saved plans",
    "recurring_investments": "recurring plans",
    "recurring_occurrences": "recurring entries",
}
MAX_LINES_PER_PLAN = 200  # a plan has a line per holding or watchlist item at most

_STORED = r"^[^\x00]*$"  # text that is only stored: anything but NUL (like Note)
_PLAIN = r"^[^\x00-\x1f\x7f-\x9f]*$"  # no control characters, for a short code
Text10 = Annotated[str, Field(max_length=10, pattern=_STORED)]
Text50 = Annotated[str, Field(max_length=50, pattern=_STORED)]
Text60 = Annotated[str, Field(max_length=60, pattern=_STORED)]
Text100 = Annotated[str, Field(max_length=100, pattern=_STORED)]
Text200 = Annotated[str, Field(max_length=200, pattern=_STORED)]
Text500 = Annotated[str, Field(max_length=500, pattern=_STORED)]
# The database check on isin (models.ISIN_CHECK): the shape only.
Isin = Annotated[str, Field(pattern=r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")]

Id = Annotated[int, Field(ge=1, le=2_147_483_647)]  # a row id in the file; the importer remaps it
# Numeric(18,6): at most 12 integer digits. Numeric(12,2) and (18,2) likewise below.
Stored = Annotated[float, Field(ge=0, le=999_999_999_999, allow_inf_nan=False)]
Cents12 = Annotated[float, Field(ge=0, le=9_999_999_999.99, allow_inf_nan=False)]
Cents18 = Annotated[float, Field(ge=0, le=99_999_999_999_999.99, allow_inf_nan=False)]
Weight = Annotated[float, Field(ge=0, le=9.999999, allow_inf_nan=False)]  # Numeric(7,6)
Rate = Annotated[float, Field(ge=0, le=9_999_999_999, allow_inf_nan=False)]  # Numeric(18,8)
# The same rule RecurringIn.amount applies to a typed amount.
RecurringAmount = Annotated[
    float, Field(ge=0.01, le=9999999999.99, allow_inf_nan=False, multiple_of=0.01)
]
RecurringDate = Annotated[date, Field(ge=date(2000, 1, 1), le=date(2100, 12, 31))]

_FORBID = ConfigDict(extra="forbid")


class ImportHolding(HoldingIn):
    model_config = _FORBID

    name: Text200
    asset_type: AssetType
    shares: Stored
    cost_basis: Stored | None = None
    sector: Text100 | None = None
    id: Id | None = None
    user_id: UUID | None = None  # ignored
    industry: Text200 | None = None  # ignored (read from the market on demand)
    country: Text200 | None = None  # ignored
    currency: Text10 | None = None  # ignored
    isin: Isin | None = None


class ImportWatchlistItem(WatchlistItemBase):
    model_config = _FORBID

    id: Id | None = None
    user_id: UUID | None = None  # ignored
    isin: Isin | None = None
    name: Text200 | None = None
    exchange: Text60 | None = None
    currency: Annotated[str, Field(max_length=10, pattern=_PLAIN)] | None = None
    source: Literal["manual", "today"] = "manual"
    created_at: NaiveDatetime | None = None

    @model_validator(mode="after")
    def _range_is_both_ends_in_order(self) -> Self:
        check_price_range(self.target_price_low, self.target_price_high, self.model_fields_set)
        return self


class ImportTrade(TradeIn):
    model_config = _FORBID

    shares: TargetPrice  # a Numeric(18,6) of at least one step, as TradeNumber but bounded above
    price: TargetPrice
    id: Id  # the link key occurrences and plan lines point at
    user_id: UUID | None = None  # ignored


class ImportSnapshot(BaseModel):
    model_config = _FORBID

    id: Id | None = None
    created_at: NaiveDatetime
    total_market_value: Cents18
    total_cost_basis: Cents18
    cost_basis_complete: bool


class ImportLeftOut(BaseModel):
    model_config = _FORBID

    ticker: Text50
    name: Text200
    kind: Text50
    reason: Text500


class ImportPlanLine(BaseModel):
    model_config = _FORBID

    id: Id | None = None
    isin: Isin | None = None  # ignored (looked up from the holdings)
    placed_at: NaiveDatetime | None = None
    placed_trade_id: Id | None = None  # a link to a trade in the file
    placed_shares: float | None = Field(default=None, allow_inf_nan=False)  # ignored (computed)
    placed_price: float | None = Field(default=None, allow_inf_nan=False)  # ignored (computed)
    ticker: Ticker
    name: Text200
    amount_eur: Cents12
    shares: Stored
    price_eur: Stored
    currency: Annotated[str, Field(min_length=1, max_length=8, pattern=_PLAIN)]
    rate: Rate
    weight_before: Weight | None = None
    weight_after: Weight | None = None
    target_weight: float | None = Field(default=None, ge=0, le=1)
    reason: Annotated[str, Field(max_length=20, pattern=r"^[a-z_]*$")]
    reason_text: Text200 | None = None  # ignored (computed from reason)


class ImportPlan(BaseModel):
    model_config = _FORBID

    id: Id  # the link key; the importer gives the plan a new id
    created_at: NaiveDatetime | None = None
    amount_eur: Annotated[float, Field(ge=0.01, le=1_000_000, allow_inf_nan=False)]
    whole_shares: bool
    total_before_eur: Annotated[float, Field(ge=0, le=99_999_999_999_999, allow_inf_nan=False)]
    leftover_eur: Cents12
    lines: list[ImportPlanLine]
    notes: list[Text500] = Field(default_factory=list, max_length=100)
    left_out: list[ImportLeftOut] = Field(default_factory=list, max_length=500)
    disclaimer: Text200 | None = None  # ignored

    @field_validator("lines")
    @classmethod
    def _not_too_many_lines(cls, lines: list[ImportPlanLine]) -> list[ImportPlanLine]:
        if len(lines) > MAX_LINES_PER_PLAN:
            raise ValueError(
                f"A saved plan in this file has more than {MAX_LINES_PER_PLAN} lines, "
                "more than the app makes."
            )
        return lines


class ImportRecurring(RecurringIn):
    model_config = _FORBID

    id: Id
    user_id: UUID | None = None  # ignored
    # The export blanks it for a plan that is not active; the importer sets it (Task 5).
    next_date: RecurringDate | None = None
    status: Literal["active", "paused", "ended"]
    upcoming_dates: list[date] = Field(default_factory=list, max_length=10)  # ignored (computed)

    @model_validator(mode="after")
    def _an_active_plan_has_a_next_date(self) -> Self:
        if self.status == "active" and self.next_date is None:
            raise ValueError("An active recurring investment in this file has no next date.")
        return self


class ImportOccurrence(BaseModel):
    model_config = _FORBID

    id: Id | None = None
    user_id: UUID | None = None  # ignored
    plan_id: Id
    scheduled_date: RecurringDate
    ticker: Ticker
    asset_type: AssetType
    amount: RecurringAmount
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    status: Literal["scheduled", "skipped", "confirmed"]
    trade_id: Id | None = None


class ImportPreferences(PreferencesIn):
    """The PreferencesIn rules. auto_analysis and auto_discovery are accepted from the file; the
    importer forces both off (a restored account never starts spending allowance by itself)."""

    model_config = _FORBID

    notes: Annotated[str, Field(max_length=2000, pattern=r"^[^\x00]*$")] | None = None  # no NUL
    auto_analysis_paused: AutoAnalysisPaused | None = None  # ignored (computed)
    auto_discovery_paused: AutoAnalysisPaused | None = None  # ignored (computed)


def _repeated(values: Sequence[object]) -> bool:
    return len(set(values)) != len(values)


class ImportFile(BaseModel):
    format_version: int = EXPORT_FORMAT_VERSION  # a file with none is read as the current shape
    holdings: list[ImportHolding] = Field(default_factory=list)
    watchlist_items: list[ImportWatchlistItem] = Field(default_factory=list)
    trades: list[ImportTrade] = Field(default_factory=list)
    portfolio_snapshots: list[ImportSnapshot] = Field(default_factory=list)
    contribution_plans: list[ImportPlan] = Field(default_factory=list)
    recurring_investments: list[ImportRecurring] = Field(default_factory=list)
    recurring_occurrences: list[ImportOccurrence] = Field(default_factory=list)
    investment_preferences: ImportPreferences | None = None

    @model_validator(mode="before")
    @classmethod
    def _the_version_is_supported(cls, data: Any) -> Any:
        # Before the lists are read: a newer file may have a shape this one cannot parse, and
        # "unsupported version" is then the useful answer, not a pile of field errors.
        if isinstance(data, dict) and "format_version" in data:
            version = data["format_version"]
            if type(version) is not int or version != EXPORT_FORMAT_VERSION:
                raise ValueError(
                    "This file was made by a different version of the app and cannot be "
                    "imported here."
                )
        return data

    @model_validator(mode="after")
    def _every_list_is_within_its_limit(self) -> Self:
        for name, limit in _LIMITS.items():
            if len(getattr(self, name)) > limit:
                raise ValueError(
                    f"This file has more {LIST_LABELS[name]} than the app keeps ({limit})."
                )
        return self

    @model_validator(mode="after")
    def _there_is_something_to_restore(self) -> Self:
        if self.investment_preferences is None and not any(getattr(self, name) for name in _LIMITS):
            raise ValueError("This file has nothing to restore.")
        return self

    @model_validator(mode="after")
    def _no_ticker_is_listed_twice(self) -> Self:
        if _repeated([h.ticker for h in self.holdings]):
            raise ValueError("This file lists the same holding more than once.")
        if _repeated([w.ticker for w in self.watchlist_items]):
            raise ValueError("This file lists the same watchlist item more than once.")
        return self

    @model_validator(mode="after")
    def _ids_that_are_linked_to_are_unique(self) -> Self:
        for what, ids in (
            ("trades", [t.id for t in self.trades]),
            ("saved plans", [p.id for p in self.contribution_plans]),
            ("recurring investments", [r.id for r in self.recurring_investments]),
        ):
            if _repeated(ids):
                raise ValueError(f"Two of the {what} in this file share an id.")
        return self

    @model_validator(mode="after")
    def _an_occurrence_is_listed_once_per_plan_and_date(self) -> Self:
        if _repeated([(o.plan_id, o.scheduled_date) for o in self.recurring_occurrences]):
            raise ValueError(
                "This file has two entries for the same recurring investment on the same date."
            )
        return self

    @model_validator(mode="after")
    def _an_occurrence_belongs_to_a_plan_in_the_file(self) -> Self:
        plan_ids = {r.id for r in self.recurring_investments}
        if any(o.plan_id not in plan_ids for o in self.recurring_occurrences):
            raise ValueError("A recurring entry in this file belongs to a plan that is not in it.")
        return self

    @model_validator(mode="after")
    def _a_confirmed_occurrence_has_its_trade(self) -> Self:
        trade_ids = {t.id for t in self.trades}
        for o in self.recurring_occurrences:
            if o.status == "confirmed" and o.trade_id is None:
                raise ValueError("A confirmed recurring entry in this file has no trade.")
            if o.status == "confirmed" and o.trade_id not in trade_ids:
                raise ValueError(
                    "A confirmed recurring entry in this file points at a trade that is not in it."
                )
            if o.status != "confirmed" and o.trade_id is not None:
                raise ValueError("A recurring entry in this file has a trade but is not confirmed.")
        return self

    @model_validator(mode="after")
    def _one_trade_confirms_one_occurrence(self) -> Self:
        if _repeated([o.trade_id for o in self.recurring_occurrences if o.trade_id is not None]):
            raise ValueError("One trade in this file confirms two recurring entries.")
        return self

    @model_validator(mode="after")
    def _occurrences_are_dated_consistently(self) -> Self:
        # The daily job continues from an active plan's next_date: nothing may sit at or after it.
        now = today()
        next_dates = {r.id: r.next_date for r in self.recurring_investments if r.status == "active"}
        for o in self.recurring_occurrences:
            if o.scheduled_date > now:
                raise ValueError("A recurring entry in this file is dated in the future.")
            next_date = next_dates.get(o.plan_id)
            if next_date is not None and o.scheduled_date >= next_date:
                raise ValueError(
                    "A recurring entry in this file is dated on or after the next date of its plan."
                )
        return self

    @model_validator(mode="after")
    def _a_placed_plan_line_has_its_trade(self) -> Self:
        trade_ids = {t.id for t in self.trades}
        for plan in self.contribution_plans:
            for line in plan.lines:
                if line.placed_trade_id is not None and line.placed_trade_id not in trade_ids:
                    raise ValueError(
                        "A saved plan line in this file points at a trade that is not in it."
                    )
        return self


class ImportResultOut(BaseModel):
    dry_run: bool
    restored: dict[str, int]
    skipped: list[str]
    next_steps: list[str]
