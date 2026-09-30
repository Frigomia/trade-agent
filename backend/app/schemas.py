from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeFloat,
    PositiveFloat,
    StringConstraints,
)

# Real symbol formats this must allow: "BRK.B", "^GSPC", "RDS-A".
# Excludes path metacharacters (/, ?, #, ..) that yfinance interpolates
# unescaped into its request URL. Pattern is case-insensitive because
# pydantic-core checks the pattern before applying to_upper.
Ticker = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9.\-^]{1,20}$"),
]

# Matches every DB column comment that already documents this as the only
# two valid values (models.py: Holding.asset_type, WatchlistItem.asset_type).
AssetType = Literal["ETF", "STOCK"]


class HoldingIn(BaseModel):
    ticker: Ticker
    name: str = Field(max_length=200)  # matches Holding.name String(200)
    asset_type: AssetType
    shares: NonNegativeFloat
    cost_basis: NonNegativeFloat
    first_purchase_date: date
    target_weight: float | None = Field(default=None, ge=0, le=1)
    sector: str | None = Field(default=None, max_length=100)  # matches Holding.sector String(100)


class HoldingOut(HoldingIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID


class WatchlistItemIn(BaseModel):
    ticker: Ticker
    asset_type: AssetType
    note: str | None = Field(default=None, max_length=500)  # matches WatchlistItem.note String(500)


class WatchlistItemOut(WatchlistItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID


class TradeIn(BaseModel):
    date: date
    ticker: Ticker
    action: Literal["BUY", "SELL"]
    shares: PositiveFloat
    price: PositiveFloat


class TradeOut(TradeIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID


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
    # Stored by POST /memory/evaluate-outcomes ~20 days after the call. A fraction (0.05 = +5%)
    # despite the column name. evaluated_at set with a null return means "resolved, no valid
    # outcome" (no price history), which is different from "not due yet" (both null).
    outcome_forward_return_pct: float | None = None
    outcome_evaluated_at: datetime | None = None
    # Computed at request time (see app/routers/analysis.py's quote augmentation), never
    # persisted — defaults let model_validate build this from a plain ORM row before those are
    # attached.
    current_price: float | None = None
    price_change_pct: float | None = None


class EquityCurveOut(BaseModel):
    strategy: list[float]
    buy_and_hold: list[float]


class BacktestListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    created_at: datetime
    ticker: str
    start_date: date
    end_date: date
    final_value: float
    buy_and_hold_value: float
    excess_return_pct: float
    hit_rate_by_signal: dict[str, dict[str, float]]
    status: str


class BacktestResultOut(BacktestListItemOut):
    equity_curve: EquityCurveOut | None = None


class ChatIn(BaseModel):
    session_id: str = Field(max_length=100)
    message: str = Field(min_length=1, max_length=4000)


class ChatOut(BaseModel):
    session_id: str
    message: str


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: str
    role: str
    content: str
    created_at: datetime


class MemorySimilarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    asset_type: str
    action: str
    reasoning: list[str]
    created_at: datetime
    outcome_forward_return_pct: float | None
    outcome_evaluated_at: datetime | None


RiskTolerance = Literal["conservative", "moderate", "aggressive"]


# One sector name: stripped, 1-50 characters, no control characters (so no newlines).
SectorName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=50, pattern=r"^[^\x00-\x1f\x7f]+$"
    ),
]
MAX_AVOID_SECTORS = 20


class PreferencesIn(BaseModel):
    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[SectorName] = Field(default_factory=list, max_length=MAX_AVOID_SECTORS)
    notes: str | None = Field(default=None, max_length=2000)


class PreferencesOut(BaseModel):
    """Deliberately not a subclass of PreferencesIn: output must stay lenient so a row saved before
    the input bounds existed can still be read (and exported) instead of failing validation."""

    model_config = ConfigDict(from_attributes=True)

    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[str] = Field(default_factory=list)
    notes: str | None = None


class PortfolioSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    total_market_value: float
    total_cost_basis: float


class HoldingSummaryOut(HoldingIn):
    # Computed at request time, never stored; all None when the quote fails (or shares == 0).
    current_price: float | None = None
    market_value: float | None = None
    unrealized_pl: float | None = None
    unrealized_pl_pct: float | None = None
    weight: float | None = None


class WatchlistSummaryOut(WatchlistItemIn):
    current_price: float | None = None


class PortfolioSummaryOut(BaseModel):
    holdings: list[HoldingSummaryOut]
    watchlist: list[WatchlistSummaryOut]
    # Totals cover only priced, open (shares > 0) holdings — cost basis included, so P/L
    # compares like with like. unpriced_count says how many open holdings were left out.
    total_market_value: float
    total_cost_basis: float
    total_pl: float
    total_pl_pct: float | None
    unpriced_count: int


# Light shape check only; the real check is that Supabase can deliver the invitation. Lowercased
# and trimmed so the same person is never two rows.
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=320,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]


class AcceptIn(BaseModel):
    accept_terms: Literal[True]  # false or missing is a 422


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    accepted_terms_at: datetime | None


class ExportProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    created_at: datetime
    accepted_terms_at: datetime | None
    last_seen_at: datetime | None


class ExportOut(BaseModel):
    profile: ExportProfileOut
    holdings: list[HoldingOut]
    watchlist_items: list[WatchlistItemOut]
    trades: list[TradeOut]
    recommendations: list[RecommendationOut]
    chat_messages: list[ChatMessageOut]
    backtest_results: list[BacktestResultOut]
    investment_preferences: PreferencesOut | None
    portfolio_snapshots: list[PortfolioSnapshotOut]


class UsageDetail(BaseModel):
    used: int
    limit: int


class UsageOut(BaseModel):
    analysis_runs: UsageDetail
    chat_messages: UsageDetail


class DataDeleteIn(BaseModel):
    confirm: Literal[True]  # false or missing is a 422, same idiom as AcceptIn


class InviteIn(BaseModel):
    email: Email


class RemoveIn(BaseModel):
    confirm_email: Email  # must repeat the user's email; the API's safeguard for a permanent delete


class LimitsIn(BaseModel):
    """Either field is independent: omitted leaves that limit unchanged, an explicit null clears
    the override back to the system default, and a non-negative integer sets it. extra="forbid"
    turns a misspelled key (e.g. "analyiss_limit") into a 422 instead of a silent no-op; the
    upper bound matches Postgres's Integer column so an oversized value 422s instead of 500ing."""

    model_config = ConfigDict(extra="forbid")

    analysis_limit: Annotated[int, Field(ge=0, le=2_147_483_647)] | None = None
    chat_limit: Annotated[int, Field(ge=0, le=2_147_483_647)] | None = None


class AdminUserOut(BaseModel):
    """Access-management data only: never anything from the user's portfolio or chats. The four
    monthly_* fields are effective limits and this month's counts (never the raw nullable
    override column) — always filled in by the router's _to_out, like invite_expires_at below."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    status: str
    created_at: datetime
    invited_at: datetime | None
    invite_expires_at: datetime | None = None  # display hint, filled in by the router
    accepted_terms_at: datetime | None
    last_seen_at: datetime | None
    monthly_analysis_limit: int | None = None
    monthly_analysis_used: int | None = None
    monthly_chat_limit: int | None = None
    monthly_chat_used: int | None = None
