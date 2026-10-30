from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas import AssetType, ExportOut, Ticker

Label = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00-\x1f]*$"
    ),
]


class RecurringIn(BaseModel):
    name: Label
    ticker: Ticker
    asset_type: AssetType
    source: Label | None = None
    amount: float = Field(ge=0.01, le=9999999999.99, allow_inf_nan=False, multiple_of=0.01)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    frequency: Literal["monthly"] = "monthly"
    start_date: date = Field(ge=date(2000, 1, 1), le=date(2100, 12, 31))


class RecurringOut(RecurringIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    next_date: date | None
    status: Literal["active", "paused", "ended"]
    upcoming_dates: list[date] = Field(default_factory=list)


class OccurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    plan_id: int
    scheduled_date: date
    ticker: str
    asset_type: AssetType
    amount: float
    currency: str
    status: Literal["scheduled", "skipped", "confirmed"]
    trade_id: int | None


class RecurringListOut(BaseModel):
    plans: list[RecurringOut]
    occurrences: list[OccurrenceOut]


class RecurringStatusIn(BaseModel):
    status: Literal["active", "paused", "ended"]


class OccurrenceStatusIn(BaseModel):
    status: Literal["scheduled", "skipped"]


class RecurringPreviewOut(BaseModel):
    upcoming_dates: list[date]
    catch_up_count: int


class RecurringExportOut(ExportOut):
    recurring_investments: list[RecurringOut]
    recurring_occurrences: list[OccurrenceOut]
