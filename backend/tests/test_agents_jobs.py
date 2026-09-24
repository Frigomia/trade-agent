import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.jobs import create_job, get_job_status, run_job
from app.models import Recommendation

FAKE_STATE_BUY = {
    "action": "BUY",
    "reasoning": ["test"],
    "ai_analysis": None,
    "suggested_position_pct": 0.15,
    "quote": {"price": 150.0, "closes": [150.0]},
}
FAKE_STATE_SKIP = {
    "action": None,
    "reasoning": [],
    "ai_analysis": None,
    "suggested_position_pct": None,
    "quote": {"price": None, "closes": []},
}


def test_job_lifecycle_completes_and_records_results(session_local):
    async def _fake_run_graph(ticker: str, asset_type: str, is_held: bool) -> dict:
        return FAKE_STATE_BUY if ticker == "AAPL" else FAKE_STATE_SKIP

    async def _run() -> None:
        tickers = [
            {"ticker": "AAPL", "asset_type": "STOCK", "is_held": False},
            {"ticker": "NOPE", "asset_type": "STOCK", "is_held": False},
        ]
        job_id = await create_job(tickers)

        status = await get_job_status(job_id)
        assert status is not None
        assert status["status"] == "RUNNING"
        assert status["total"] == 2

        with (
            patch("app.agents.jobs.run_graph_for_ticker", AsyncMock(side_effect=_fake_run_graph)),
            patch("app.agents.jobs.SessionLocal", session_local),
        ):
            await run_job(job_id, tickers)

        final = await get_job_status(job_id)
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
            # Use the most recent record (by id, which is auto-incrementing)
            saved = records[-1]
            assert float(saved.price_at_recommendation) == 150.0
        finally:
            saved_session.close()

    asyncio.run(_run())


def test_get_job_status_returns_none_for_unknown_job():
    result = asyncio.run(get_job_status("does-not-exist"))
    assert result is None
