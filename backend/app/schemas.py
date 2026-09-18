from datetime import date
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
