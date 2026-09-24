from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, NonNegativeFloat, PositiveFloat, StringConstraints

# Real symbol formats this must allow: "BRK.B", "^GSPC", "RDS-A".
# Excludes path metacharacters (/, ?, #, ..) that yfinance interpolates
# unescaped into its request URL. Pattern is case-insensitive because
# pydantic-core checks the pattern before applying to_upper.
Ticker = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9.\-^]{1,20}$"),
]


class HoldingIn(BaseModel):
    ticker: Ticker
    name: str
    asset_type: str
    shares: NonNegativeFloat
    cost_basis: NonNegativeFloat
    first_purchase_date: date
    target_weight: float | None = None
    sector: str | None = None


class HoldingOut(HoldingIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID


class WatchlistItemIn(BaseModel):
    ticker: Ticker
    asset_type: str
    note: str | None = None


class WatchlistItemOut(WatchlistItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID


class TradeIn(BaseModel):
    date: date
    ticker: str
    action: str
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
