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


class BacktestResultOut(BaseModel):
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


class ChatIn(BaseModel):
    session_id: str = Field(max_length=100)
    message: str = Field(min_length=1, max_length=4000)


class ChatOut(BaseModel):
    session_id: str
    message: str


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


class PreferencesIn(BaseModel):
    risk_tolerance: RiskTolerance | None = None
    sector_avoid_list: list[str] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)


class PreferencesOut(PreferencesIn):
    model_config = ConfigDict(from_attributes=True)


class PortfolioSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    total_market_value: float
    total_cost_basis: float


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


class InviteIn(BaseModel):
    email: Email


class AdminUserOut(BaseModel):
    """Access-management data only: never anything from the user's portfolio or chats."""

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
