"""Recurring schedules and market inputs: no network, database or Redis required."""

import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app import recurring
from app.recurring_market import MarketUnavailable, effective_session, historical_fx
from app.schemas_recurring import RecurringIn


def test_monthly_clamp_leap_and_custom_anchor():
    assert recurring.upcoming(date(2024, 1, 31), date(2024, 2, 1)) == [
        date(2024, 2, 29),
        date(2024, 3, 31),
        date(2024, 4, 30),
    ]
    assert recurring.upcoming(date(2025, 12, 31), date(2026, 1, 1), 2, "months") == [
        date(2026, 2, 28),
        date(2026, 4, 30),
        date(2026, 6, 30),
    ]
    assert recurring.upcoming(date(2026, 1, 31), date(2026, 2, 1), end=date(2026, 2, 28)) == [
        date(2026, 2, 28)
    ]


@pytest.mark.parametrize(
    "step,unit,expected",
    [(1, "weeks", "2026-03-30"), (2, "weeks", "2026-04-06"), (3, "days", "2026-03-29")],
)
def test_date_only_cadence_across_dst(step, unit, expected):
    assert (
        recurring.scheduled_on_or_after(
            date(2026, 3, 23), date(2026, 3, 28), step, unit
        ).isoformat()
        == expected
    )


def test_market_weekend_holiday_and_close_publication():
    now = datetime(2026, 4, 8, tzinfo=UTC)
    # Good Friday and Easter Monday are Xetra holidays.
    assert effective_session("GER", date(2026, 4, 3), now) == date(2026, 4, 7)
    assert effective_session("NMS", date(2026, 7, 4), datetime(2026, 7, 8, tzinfo=UTC)) == date(
        2026, 7, 6
    )
    with pytest.raises(MarketUnavailable, match="published daily close"):
        effective_session("GER", date(2026, 4, 7), datetime(2026, 4, 7, 14, tzinfo=UTC))
    with pytest.raises(MarketUnavailable, match="not supported"):
        effective_session("UNKNOWN", date(2026, 4, 7), now)


def test_historical_fx_direction_minor_units_and_no_future(monkeypatch):
    day = date(2026, 4, 7)

    async def closes(symbol, start, end):
        return {"2026-04-06": 1.2 if symbol == "EURUSD=X" else 0.8, "2026-04-08": 999}

    monkeypatch.setattr("app.recurring_market.fetch_closes_between", closes)
    assert asyncio.run(historical_fx("EUR", "USD", day)) == (Decimal("1.2"), date(2026, 4, 6))
    rate, _ = asyncio.run(historical_fx("USD", "GBp", day))
    assert rate.quantize(Decimal("0.000000000001")) == Decimal("66.666666666667")
    assert asyncio.run(historical_fx("EUR", "EUR", day)) == (Decimal(1), day)
    monkeypatch.setattr("app.recurring_market.fetch_closes_between", AsyncMock(return_value={}))
    with pytest.raises(MarketUnavailable, match="Waiting for historical FX"):
        asyncio.run(historical_fx("EUR", "USD", day))


@pytest.mark.parametrize(
    "over",
    [
        {"amount": "NaN"},
        {"amount": "0.001"},
        {"amount": -1},
        {"currency": "XYZ"},
        {"interval_count": 0},
        {"frequency": "daily"},
        {"end_date": "2025-01-01"},
    ],
)
def test_server_validation(over):
    with pytest.raises(ValidationError):
        RecurringIn.model_validate(
            {
                "name": "SAP",
                "ticker": "SAP.DE",
                "asset_type": "STOCK",
                "amount": "400",
                "currency": "EUR",
                "start_date": "2026-04-15",
            }
            | over
        )


def test_exact_session_close_required_and_split_history_refused(monkeypatch):
    import pandas as pd

    from app import recurring_market

    monkeypatch.setattr(
        recurring_market,
        "instrument",
        AsyncMock(return_value={"exchange": "GER", "currency": "EUR"}),
    )

    class Provider:
        def history(self, **kwargs):
            assert kwargs["auto_adjust"] is False and kwargs["back_adjust"] is False
            return pd.DataFrame(
                {"Close": [100.0], "Stock Splits": [0.0]}, index=pd.to_datetime(["2026-04-08"])
            )

    monkeypatch.setattr(recurring_market.yf, "Ticker", lambda _: Provider())
    # April 7 is an open session: April 8's available close is never substituted for it.
    with pytest.raises(MarketUnavailable, match="effective session"):
        asyncio.run(
            recurring_market.estimate(
                "SAP.DE", "STOCK", date(2026, 4, 7), "EUR", now=datetime(2026, 4, 10, tzinfo=UTC)
            )
        )
    monkeypatch.setattr(
        Provider,
        "history",
        lambda *a, **k: pd.DataFrame(
            {"Close": [50.0], "Stock Splits": [2.0]}, index=pd.to_datetime(["2026-04-07"])
        ),
    )
    with pytest.raises(MarketUnavailable, match="Stock split"):
        asyncio.run(
            recurring_market.estimate(
                "SAP.DE", "STOCK", date(2026, 4, 7), "EUR", now=datetime(2026, 4, 10, tzinfo=UTC)
            )
        )


def test_alembic_revision_preserves_legacy_rows_and_guards_downgrade():
    import importlib.util
    from io import StringIO
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = next(
        (Path(__file__).parents[1] / "migrations/versions").glob(
            "*_add_recurring_estimated_tracking.py"
        )
    )
    spec = importlib.util.spec_from_file_location("estimate_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "tracking_enabled BOOLEAN DEFAULT 'false' NOT NULL" in sql
    assert "DROP TABLE" not in sql and "DELETE FROM" not in sql
    output.seek(0)
    output.truncate()
    with Operations.context(context):
        module.downgrade()
    assert "RAISE EXCEPTION" in output.getvalue()


def test_market_batch_reuses_listing_history_and_does_not_retry_domain_errors(monkeypatch):
    from unittest.mock import Mock

    import pandas as pd

    from app import recurring_market

    listing = AsyncMock(return_value={"exchange": "GER", "currency": "USD"})
    history = Mock(
        return_value=pd.DataFrame(
            {"Close": [100.0, 120.0], "Stock Splits": [0.0, 0.0]},
            index=pd.to_datetime(["2026-04-07", "2026-04-08"]),
        )
    )
    provider = Mock(history=history)
    monkeypatch.setattr(recurring_market, "instrument", listing)
    monkeypatch.setattr(recurring_market.yf, "Ticker", lambda _: provider)
    fx = AsyncMock(return_value={"2026-04-07": 1.2, "2026-04-08": 1.3})
    monkeypatch.setattr(recurring_market, "fetch_closes_between", fx)

    async def run():
        batch = recurring_market.MarketBatch(
            start=date(2026, 4, 7), now=datetime(2026, 4, 10, tzinfo=UTC)
        )
        for day, expected in [(7, 100), (8, 120)]:
            result = await recurring_market.estimate(
                "SAP.DE", "STOCK", date(2026, 4, day), "EUR", batch=batch
            )
            assert result.price == expected
        with pytest.raises(MarketUnavailable, match="historical daily close"):
            await recurring_market.estimate("SAP.DE", "STOCK", date(2026, 4, 9), "EUR", batch=batch)

    asyncio.run(run())
    assert listing.await_count == history.call_count == fx.await_count == 1


def test_unsupported_instrument_is_not_retried(monkeypatch):
    from unittest.mock import Mock, PropertyMock

    from app import recurring_market

    provider = Mock()
    info = PropertyMock(return_value={"quoteType": "INDEX", "exchange": "UNKNOWN"})
    type(provider).info = info
    monkeypatch.setattr(recurring_market.yf, "Ticker", lambda _: provider)
    with pytest.raises(MarketUnavailable, match="supported exchange"):
        asyncio.run(recurring_market.instrument("^NDX", "STOCK"))
    assert info.call_count == 1
