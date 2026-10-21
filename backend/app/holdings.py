"""Holding metadata and upserts; callers use the authenticated user's scoped session."""

import asyncio
import logging
import uuid

from sqlalchemy.orm import Session

from app.agents.market_data import fetch_profile
from app.db import lock_and_check_active
from app.limits import MAX_HOLDINGS, cap_message
from app.models import Holding
from app.schemas import HoldingIn, HoldingOut, HoldingSummaryOut

logger = logging.getLogger(__name__)


async def load_holdings(db: Session, user_id: uuid.UUID) -> list[HoldingOut]:
    task = asyncio.create_task(asyncio.to_thread(read_holdings, db, user_id))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # A cancelled request must not close its session while the worker still uses it.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
        task.result()
        raise


def read_holdings(db: Session, user_id: uuid.UUID) -> list[HoldingOut]:
    """Copy scoped rows and release the connection in the worker before provider awaits."""
    try:
        return [
            HoldingOut.model_validate(row)
            for row in db.query(Holding).filter_by(user_id=user_id).order_by(Holding.ticker)
        ]
    finally:
        db.close()


async def _profile_for(ticker: str) -> dict[str, str | None]:
    try:
        return await fetch_profile(ticker)
    except Exception as exc:
        # Optional metadata must not prevent reading or editing an existing position.
        logger.warning("Holding profile unavailable (%s)", type(exc).__name__)
        return {}


class HoldingRefused(ValueError):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        self.status_code = status_code
        super().__init__(detail)


async def upsert_holding(db: Session, user_id: uuid.UUID, payload: HoldingIn) -> HoldingOut:
    profile = await _profile_for(payload.ticker)
    return await asyncio.to_thread(_save_holding, db, user_id, payload, profile)


def _save_holding(
    db: Session, user_id: uuid.UUID, payload: HoldingIn, profile: dict[str, str | None]
) -> HoldingOut:
    try:
        if not lock_and_check_active(db, user_id):
            raise HoldingRefused("This account is not active.", 403)
        row = db.query(Holding).filter_by(user_id=user_id, ticker=payload.ticker).one_or_none()
        values = payload.model_dump(exclude_unset=True)
        if row is None:
            if db.query(Holding).filter_by(user_id=user_id).count() >= MAX_HOLDINGS:
                raise HoldingRefused(cap_message("holdings", MAX_HOLDINGS), 409)
            row = Holding(user_id=user_id, ticker=payload.ticker)
            db.add(row)
        # Missing update fields preserve known purchase data; explicit null clears it.
        for field, value in values.items():
            setattr(row, field, value)
        if not row.name or row.name == payload.ticker:
            row.name = profile.get("name") or payload.ticker
        if row.asset_type is None:
            quote_type = profile.get("quote_type")
            if quote_type not in {"EQUITY", "ETF"}:
                raise HoldingRefused("Choose Stock or ETF when the security type is unavailable.")
            row.asset_type = "STOCK" if quote_type == "EQUITY" else "ETF"
        if row.sector is None and "sector" not in payload.model_fields_set:
            row.sector = profile.get("sector")
        db.commit()
        db.refresh(row)
        out = HoldingOut.model_validate(row)
    except Exception:
        db.rollback()
        raise
    for field in ("industry", "country", "currency"):
        setattr(out, field, profile.get(field))
    return out


async def enrich_holdings(
    rows: list[HoldingOut] | list[HoldingSummaryOut], semaphore: asyncio.Semaphore
) -> None:
    async def enrich(row: HoldingOut | HoldingSummaryOut) -> None:
        async with semaphore:
            profile = await _profile_for(row.ticker)
        name = profile.get("name")
        if row.name == row.ticker and name:
            row.name = name
        for field in ("industry", "country", "currency"):
            setattr(row, field, profile.get(field))

    await asyncio.gather(*(enrich(row) for row in rows))
