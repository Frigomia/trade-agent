from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, NonNegativeFloat, PositiveFloat


class HoldingIn(BaseModel):
    ticker: str
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
    ticker: str
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
