from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeFloat,
    StringConstraints,
    computed_field,
    field_validator,
)

from app.isin import is_valid_isin

# Real symbol formats this must allow: "BRK.B", "^GSPC", "RDS-A", "SAP.DE".
# Excludes path metacharacters (/, ?, #) and any ".." that yfinance interpolates
# unescaped into its request URL (the regex engine has no look-ahead, so a "." must be
# followed by another non-dot character); the first character must be a letter, digit
# or "^" (so "." and "-x" are out). Pattern is case-insensitive because
# pydantic-core checks the pattern before applying to_upper.
Ticker = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_upper=True,
        max_length=20,
        pattern=r"^[A-Za-z0-9^](?:[A-Za-z0-9\-]|\.[A-Za-z0-9\-])*$",
    ),
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
    isin: str | None = None


class WatchlistItemIn(BaseModel):
    ticker: Ticker
    asset_type: AssetType
    note: str | None = Field(default=None, max_length=500)  # matches WatchlistItem.note String(500)
    target_weight: float | None = Field(default=None, ge=0, le=1)


class WatchlistItemOut(WatchlistItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    isin: str | None = None


# A share count or price as a trade stores it (Numeric(18,6)): finite and at least the smallest
# stored step, so a smaller value cannot store as 0 while the cost basis used the unrounded one.
TradeNumber = Annotated[float, Field(ge=0.000001, allow_inf_nan=False)]


class TradeIn(BaseModel):
    date: date
    ticker: Ticker
    action: Literal["BUY", "SELL"]
    shares: TradeNumber
    price: TradeNumber


class PlaceIn(BaseModel):
    date: date
    shares: TradeNumber
    price: TradeNumber
    asset_type: AssetType | None = None  # needed only when the ticker is not a holding yet


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
    source: str = "manual"
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


class AutoAnalysisPaused(BaseModel):
    reason: Literal["no_key", "limit"]
    limit: int | None = None
    resumes_on: date | None = None


class PreferencesIn(BaseModel):
    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[SectorName] = Field(default_factory=list, max_length=MAX_AVOID_SECTORS)
    notes: str | None = Field(default=None, max_length=2000)
    auto_analysis: bool | None = None  # None: leave as it is
    monthly_contribution: Decimal | None = Field(
        default=None, ge=Decimal("0.01"), le=1_000_000, decimal_places=2
    )
    drift_threshold_pct: float | None = Field(default=None, ge=1, le=50)  # None: leave as it is


class PreferencesOut(BaseModel):
    """Deliberately not a subclass of PreferencesIn: output must stay lenient so a row saved before
    the input bounds existed can still be read (and exported) instead of failing validation."""

    model_config = ConfigDict(from_attributes=True)

    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[str] = Field(default_factory=list)
    notes: str | None = None
    auto_analysis: bool = False
    monthly_contribution: float | None = None
    drift_threshold_pct: float = 5.0
    # Only filled when auto_analysis is on
    auto_analysis_paused: AutoAnalysisPaused | None = None


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


class TelegramExportOut(BaseModel):
    linked: bool = True
    status: str
    digest_enabled: bool
    moves_enabled: bool
    plan_reminder_enabled: bool
    move_threshold_pct: float


class PlanIn(BaseModel):
    amount: Decimal = Field(ge=Decimal("0.01"), le=1_000_000, decimal_places=2)
    whole_shares: bool = False


REASON_TEXT = {
    "new_position": "A new position that starts at 0 %",
    "underweight": "Below its target weight",
    "favoured": "Below its target, and a pending call favours adding",
    "remainder": "Extra money shared by target weight",
}


class LeftOutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: str
    kind: str  # "excluded_call" | "unusable_price" | "too_small" | "unpriced"
    reason: str


class PlanLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    isin: str | None = None
    placed_at: datetime | None = None
    placed_trade_id: int | None = None
    placed_shares: float | None = None  # read from the logged trade, never stored
    placed_price: float | None = None
    ticker: str
    name: str
    amount_eur: float
    shares: float
    price_eur: float
    currency: str
    rate: float
    weight_before: float | None
    weight_after: float | None
    target_weight: float | None = None  # the normalised target at plan time; None on old plans
    reason: str

    @computed_field  # type: ignore[prop-decorator]
    @property
    def reason_text(self) -> str:
        return REASON_TEXT.get(self.reason, "")


class PlanOut(BaseModel):
    id: int | None = None
    created_at: datetime | None = None
    amount_eur: float
    whole_shares: bool
    total_before_eur: float
    leftover_eur: float
    lines: list[PlanLineOut]
    notes: list[str]
    left_out: list[LeftOutOut] = Field(default_factory=list)
    disclaimer: str = "Advisory only. Nothing is sent to a broker."


class OpenOrdersOut(BaseModel):
    open_lines: int
    plans: list[PlanOut]


class PlanSummaryOut(BaseModel):
    id: int
    created_at: datetime
    amount_eur: float
    line_count: int


class DriftItemOut(BaseModel):
    ticker: str
    name: str
    weight: float  # fractions of the targeted open holdings
    target: float
    points: float  # weight minus target, in percentage points


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
    telegram: TelegramExportOut | None = None
    contribution_plans: list[PlanOut] = Field(default_factory=list)


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


class LimitDefaults(BaseModel):
    """The system-wide monthly defaults, sent and returned as a pair (the admin form edits them
    together). The upper bound matches Postgres's Integer column so an oversized value 422s
    instead of 500ing."""

    model_config = ConfigDict(extra="forbid")

    analysis_limit: Annotated[int, Field(ge=0, le=2_147_483_647)]
    chat_limit: Annotated[int, Field(ge=0, le=2_147_483_647)]


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
    claude_key_state: str = "none"  # none | ok | needs_attention; never the key or its digits
    monthly_analysis_limit: int | None = None
    monthly_analysis_used: int | None = None
    monthly_chat_limit: int | None = None
    monthly_chat_used: int | None = None


class TelegramOut(BaseModel):
    configured: bool
    linked: bool
    status: Literal["ok", "blocked"] | None = None
    digest_enabled: bool = True
    moves_enabled: bool = True
    move_threshold_pct: float = 5.0
    plan_reminder_enabled: bool = True
    bot_username: str | None = None


class TelegramLinkOut(BaseModel):
    url: str
    expires_in: int


class TelegramSettingsIn(BaseModel):
    digest_enabled: bool | None = None
    moves_enabled: bool | None = None
    plan_reminder_enabled: bool | None = None
    move_threshold_pct: float | None = Field(default=None, ge=1, le=50)


class IsinIn(BaseModel):
    isin: str | None = None

    @field_validator("isin", mode="before")
    @classmethod
    def _normalise(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("isin must be text")
        text = value.strip().upper()
        if text == "":
            return None
        if not is_valid_isin(text):
            raise ValueError("Not a valid ISIN: 12 characters with a correct check digit.")
        return text


class IsinOut(BaseModel):
    ticker: str
    isin: str | None
