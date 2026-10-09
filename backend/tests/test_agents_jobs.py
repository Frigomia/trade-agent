import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.jobs import (
    MAX_RUN_TICKERS,
    AnalysisAlreadyRunning,
    _active_key,
    create_job,
    default_ticker_infos,
    get_job_status,
    run_job,
)
from app.models import Holding, Recommendation, WatchlistItem
from app.redis_client import get_redis
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

FAKE_STATE_BUY = {
    "action": "BUY",
    "reasoning": ["test"],
    "ai_analysis": None,
    "suggested_position_pct": 0.15,
    "quote": {"price": 150.0, "closes": [150.0]},
    "fundamental_score": 78,
    "technical_signal": "OVERSOLD",
}
FAKE_STATE_SKIP = {
    "action": None,
    "reasoning": [],
    "ai_analysis": None,
    "suggested_position_pct": None,
    "quote": {"price": None, "closes": []},
    "fundamental_score": None,
    "technical_signal": "NEUTRAL",
}


def test_job_lifecycle_completes_and_records_results(session_local, app_session_local):
    with session_local() as seed_db:
        add_app_user(seed_db, OTHER_USER_ID)

    async def _fake_run_graph(
        user_id, ticker: str, asset_type: str, is_held: bool, client=None
    ) -> dict:
        assert user_id == OTHER_USER_ID
        return FAKE_STATE_BUY if ticker == "AAPL" else FAKE_STATE_SKIP

    async def _run() -> None:
        tickers = [
            {"ticker": "AAPL", "asset_type": "STOCK", "is_held": False},
            {"ticker": "NOPE", "asset_type": "STOCK", "is_held": False},
        ]
        job_id = await create_job(OTHER_USER_ID, tickers)

        status = await get_job_status(job_id, OTHER_USER_ID)
        assert status is not None
        assert status["status"] == "RUNNING"
        assert status["total"] == 2

        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(side_effect=_fake_run_graph)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers)

        final = await get_job_status(job_id, OTHER_USER_ID)
        assert final is not None
        assert final["status"] == "DONE"
        assert final["done"] == 2

        skipped = [r for r in final["results"] if r.get("skipped")]
        assert len(skipped) == 1

        recorded = [r for r in final["results"] if "recommendation_id" in r]
        assert len(recorded) == 1
        assert recorded[0]["ticker"] == "AAPL"

        saved_session = session_local()
        try:
            records = saved_session.query(Recommendation).filter_by(ticker="AAPL").all()
            assert len(records) > 0, "No AAPL recommendation found"
            saved = records[-1]
            assert float(saved.price_at_recommendation) == 150.0
            assert saved.user_id == OTHER_USER_ID
        finally:
            saved_session.close()

    asyncio.run(_run())


def test_get_job_status_returns_none_for_unknown_job():
    result = asyncio.run(get_job_status("does-not-exist", USER_ID))
    assert result is None


def test_get_job_status_hides_other_users_jobs():
    async def _run() -> None:
        job_id = await create_job(
            USER_ID, [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        )
        assert await get_job_status(job_id, USER_ID) is not None
        assert await get_job_status(job_id, OTHER_USER_ID) is None

    asyncio.run(_run())


def test_a_new_run_supersedes_the_tickers_unreviewed_recommendations(
    session_local, app_session_local
):
    with session_local() as seed_db:
        add_app_user(seed_db, OTHER_USER_ID)

    def _fake_run_graph(user_id, ticker: str, asset_type: str, is_held: bool, client=None) -> dict:
        return FAKE_STATE_BUY

    async def _run() -> None:
        seed = session_local()
        try:
            for ticker, status in [("AAPL", "PENDING"), ("AAPL", "APPROVED"), ("MSFT", "PENDING")]:
                seed.add(
                    Recommendation(
                        user_id=OTHER_USER_ID,
                        ticker=ticker,
                        asset_type="STOCK",
                        action="BUY",
                        reasoning=["old"],
                        status=status,
                    )
                )
            seed.commit()
        finally:
            seed.close()

        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        with (
            patch(
                "app.agents.jobs.run_graph_for_ticker",
                AsyncMock(side_effect=_fake_run_graph),
            ),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers)

        check = session_local()
        try:
            rows = check.query(Recommendation).filter_by(user_id=OTHER_USER_ID).all()
            by_key = {(r.ticker, r.status) for r in rows}
            # The old PENDING AAPL is superseded, a new one is PENDING, the reviewed AAPL and the
            # other ticker's PENDING are untouched.
            assert ("AAPL", "SUPERSEDED") in by_key
            assert ("AAPL", "APPROVED") in by_key
            assert ("MSFT", "PENDING") in by_key
            assert sum(1 for r in rows if r.ticker == "AAPL" and r.status == "PENDING") == 1
        finally:
            check.close()

    asyncio.run(_run())


def test_the_job_hands_the_same_client_to_every_ticker(session_local, app_session_local):
    seen: list[object] = []

    async def _fake_run_graph(user_id, ticker, asset_type, is_held, client=None) -> dict:
        seen.append(client)
        return FAKE_STATE_SKIP

    sentinel = object()

    async def _run() -> None:
        tickers = [
            {"ticker": "AAPL", "asset_type": "STOCK", "is_held": False},
            {"ticker": "MSFT", "asset_type": "STOCK", "is_held": False},
        ]
        job_id = await create_job(OTHER_USER_ID, tickers)
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(side_effect=_fake_run_graph)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers, client=sentinel)

    asyncio.run(_run())

    assert seen == [sentinel, sentinel]


def _run_one_ticker(app_session_local, source=None):
    async def _run() -> None:
        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        extra = {} if source is None else {"source": source}
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=FAKE_STATE_BUY)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers, **extra)

    asyncio.run(_run())


def test_a_scheduled_run_stores_its_recommendations_as_scheduled(session_local, app_session_local):
    with session_local() as seed_db:
        add_app_user(seed_db, OTHER_USER_ID)
    _run_one_ticker(app_session_local, source="scheduled")
    with session_local() as db:
        assert db.query(Recommendation).filter_by(user_id=OTHER_USER_ID).one().source == "scheduled"


def test_a_manual_run_stores_manual(session_local, app_session_local):
    with session_local() as seed_db:
        add_app_user(seed_db, OTHER_USER_ID)
    _run_one_ticker(app_session_local)
    with session_local() as db:
        assert db.query(Recommendation).filter_by(user_id=OTHER_USER_ID).one().source == "manual"


def test_default_ticker_infos_lists_open_holdings_then_the_watchlist(session_local):
    with session_local() as db:
        for ticker, shares in (("AAPL", 5), ("OLD", 0)):
            db.add(
                Holding(
                    user_id=USER_ID,
                    ticker=ticker,
                    name=ticker,
                    asset_type="STOCK",
                    shares=shares,
                    cost_basis=100.0,
                    first_purchase_date=date(2024, 1, 1),
                )
            )
        db.add(WatchlistItem(user_id=USER_ID, ticker="MSFT", asset_type="STOCK"))
        db.commit()
        open_only = default_ticker_infos(db, USER_ID, open_only=True)
        everything = default_ticker_infos(db, USER_ID)
    assert [i["ticker"] for i in open_only] == ["AAPL", "MSFT"]  # the closed position is absent
    assert [i["is_held"] for i in open_only] == [True, False]
    assert [i["ticker"] for i in everything] == ["AAPL", "OLD", "MSFT"]


def test_default_ticker_infos_is_capped(session_local):
    with session_local() as db:
        for i in range(MAX_RUN_TICKERS + 2):
            db.add(WatchlistItem(user_id=USER_ID, ticker=f"T{i}", asset_type="STOCK"))
        db.commit()
        assert len(default_ticker_infos(db, USER_ID)) == MAX_RUN_TICKERS


def test_default_ticker_infos_drops_excluded_tickers_before_the_cap(session_local):
    with session_local() as db:
        for i in range(MAX_RUN_TICKERS + 10):
            db.add(WatchlistItem(user_id=USER_ID, ticker=f"T{i}", asset_type="STOCK"))
        db.commit()
        excluded = {f"T{i}" for i in range(MAX_RUN_TICKERS)}  # the first 50 are already fresh
        infos = default_ticker_infos(db, USER_ID, exclude=excluded)
    assert [i["ticker"] for i in infos] == [f"T{i}" for i in range(MAX_RUN_TICKERS, 60)]


def test_a_second_create_job_is_refused_while_the_first_is_active():
    async def _run() -> None:
        await create_job(OTHER_USER_ID, [])
        with pytest.raises(AnalysisAlreadyRunning):
            await create_job(OTHER_USER_ID, [])

    asyncio.run(_run())


def test_the_marker_is_released_after_a_successful_run(session_local, app_session_local):
    async def _run() -> None:
        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=FAKE_STATE_SKIP)),
            patch("app.db.SessionLocal", app_session_local),
        ):
            await run_job(job_id, OTHER_USER_ID, tickers)
        await create_job(OTHER_USER_ID, tickers)  # no AnalysisAlreadyRunning

    asyncio.run(_run())


def test_the_marker_is_released_when_the_run_raises():
    async def _run() -> None:
        job_id = await create_job(OTHER_USER_ID, [])
        with (
            patch("app.agents.jobs.asyncio.gather", AsyncMock(side_effect=RuntimeError("boom"))),
            pytest.raises(RuntimeError),
        ):
            await run_job(job_id, OTHER_USER_ID, [])
        await create_job(OTHER_USER_ID, [])

    asyncio.run(_run())


def test_a_job_does_not_release_a_marker_held_by_another_job():
    async def _run() -> None:
        job_id = await create_job(OTHER_USER_ID, [])
        await get_redis().set(_active_key(OTHER_USER_ID), "someone-else")
        await run_job(job_id, OTHER_USER_ID, [])
        with pytest.raises(AnalysisAlreadyRunning):
            await create_job(OTHER_USER_ID, [])

    asyncio.run(_run())


def test_the_marker_is_released_even_when_marking_the_job_done_fails():
    async def _run() -> None:
        job_id = await create_job(OTHER_USER_ID, [])
        with (
            patch.object(get_redis().__class__, "hset", AsyncMock(side_effect=OSError)),
            pytest.raises(OSError),
        ):
            await run_job(job_id, OTHER_USER_ID, [])
        assert await get_redis().get(_active_key(OTHER_USER_ID)) is None

    asyncio.run(_run())


def test_the_marker_expiry_is_refreshed_after_each_ticker(session_local, app_session_local):
    from app.agents.jobs import JOB_TTL_SECONDS, _process_ticker

    async def _run() -> None:
        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        redis = get_redis()
        await redis.expire(_active_key(OTHER_USER_ID), 30)  # nearly expired
        with patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=FAKE_STATE_SKIP)):
            await _process_ticker(job_id, OTHER_USER_ID, tickers[0], asyncio.Semaphore(1))
        assert await redis.ttl(_active_key(OTHER_USER_ID)) > JOB_TTL_SECONDS - 60

    asyncio.run(_run())


def test_the_refresh_does_not_recreate_a_missing_marker(session_local, app_session_local):
    from app.agents.jobs import _process_ticker

    async def _run() -> None:
        tickers = [{"ticker": "AAPL", "asset_type": "STOCK", "is_held": False}]
        job_id = await create_job(OTHER_USER_ID, tickers)
        await get_redis().delete(_active_key(OTHER_USER_ID))
        with patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(return_value=FAKE_STATE_SKIP)):
            await _process_ticker(job_id, OTHER_USER_ID, tickers[0], asyncio.Semaphore(1))
        assert await get_redis().get(_active_key(OTHER_USER_ID)) is None

    asyncio.run(_run())
