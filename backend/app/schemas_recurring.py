from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.fx import RATE_SYMBOLS
from app.schemas import AssetType, ExportOut, Ticker

Label = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00-\x1f]*$"
    ),
]
# Keep the existing numeric JSON contract; validation, storage and arithmetic remain Decimal.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class RecurringFields(BaseModel):
    name: Label
    ticker: Ticker
    asset_type: AssetType
    source: Label | None = None
    amount: Money = Field(gt=0, le=Decimal("9999999999.99"), max_digits=12, decimal_places=2)
    currency: str = "EUR"
    frequency: Literal["weekly", "biweekly", "monthly", "custom"] = "monthly"
    interval_count: int = Field(default=1, ge=1, le=365)
    interval_unit: Literal["days", "weeks", "months"] = "months"
    start_date: date = Field(ge=date(2000, 1, 1), le=date(2100, 12, 31))
    end_date: date | None = None
    backfill: bool = False


class RecurringIn(RecurringFields):
    @model_validator(mode="after")
    def validate_schedule(self) -> "RecurringIn":
        if self.currency not in {"EUR", *RATE_SYMBOLS}:
            raise ValueError("Choose a supported contribution currency (major units).")
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date.")
        if self.frequency != "custom":
            cadence: dict[str, tuple[int, Literal["days", "weeks", "months"]]] = {
                "weekly": (1, "weeks"),
                "biweekly": (2, "weeks"),
                "monthly": (1, "months"),
            }
            self.interval_count, self.interval_unit = cadence[self.frequency]
        return self


class RecurringOut(RecurringFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    next_date: date | None
    status: Literal["active", "paused", "ended"]
    tracking_enabled: bool = False
    exchange: str | None = None
    upcoming_dates: list[date] = Field(default_factory=list)


class OccurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID
    plan_id: int
    scheduled_date: date
    ticker: str
    asset_type: AssetType
    amount: Money
    currency: str
    status: Literal["scheduled", "skipped", "confirmed", "posted", "reconciled", "voided"]
    trade_id: int | None
    effective_date: date | None = None
    quote_currency: str | None = None
    reference_price: Decimal | None = None
    fx_rate: Decimal | None = None
    fx_date: date | None = None
    pricing_source: str | None = None
    error: str | None = None
    attempts: int = 0
    shares: Decimal | None = None
    price: Decimal | None = None
    trade_date: date | None = None


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
    first_date: date | None = None
    last_date: date | None = None
    conflict: str | None = None


class RecurringExportOut(ExportOut):
    recurring_investments: list[RecurringOut]
    recurring_occurrences: list[OccurrenceOut]
