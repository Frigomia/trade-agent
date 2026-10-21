import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.analysis.discovery_score import rank_ideas
from app.config import settings
from app.discovery import jobs, runner
from app.discovery.persistence import save_scan
from app.models import AppUser, Holding, InvestmentPreferences, Recommendation, ScanRun
from app.schemas_discovery import IdeaSnapshot
from app.usage import get_usage
from tests.auth_support import ADMIN_ID, OTHER_USER_ID, USER_ID, add_app_user
from tests.discovery_fixtures import sample_candidate, sample_idea
from tests.test_discovery_screen import snap


def close_background(coro):
    coro.close()
    return MagicMock()


def test_manual_scan_accepts_empty_portfolio_and_passes_explicit_user_client(client):
    user_client = MagicMock()
    with (
        patch("app.routers.discovery.claude_keys.resolve_client", return_value=user_client),
        patch("app.routers.discovery._get_client", side_effect=AssertionError("No owner key")),
        patch("app.routers.discovery.run_job", AsyncMock()) as job,
        patch("app.routers.discovery.asyncio.create_task", side_effect=close_background),
    ):
        response = client.post("/discovery/run")
    assert response.status_code == 202
    assert len(response.json()["job_id"]) == 36
    assert job.call_args.args[1:] == (USER_ID, user_client)
    assert job.call_args.kwargs == {"uses_saved_key": True}
    assert client.portal.call(get_usage, "analysis_run", str(USER_ID)) == 1


def test_duplicate_run_is_409_and_refunds_usage(client):
    with patch("app.routers.discovery.asyncio.create_task", side_effect=close_background):
        first = client.post("/discovery/run")
        second = client.post("/discovery/run")
    assert first.status_code == 202 and second.status_code == 409
    assert client.portal.call(get_usage, "analysis_run", str(USER_ID)) == 1


def test_key_required_before_usage_or_job_creation(client_no_key):
    with patch("app.routers.discovery.create_job", AsyncMock()) as created:
        response = client_no_key.post("/discovery/run")
    assert response.status_code == 409 and response.json()["code"] == "claude_key_required"
    assert client_no_key.portal.call(get_usage, "analysis_run", str(USER_ID)) == 0
    created.assert_not_awaited()


def test_admin_server_client_is_explicit(admin_client):
    owner_client = MagicMock()
    with (
        patch("app.routers.discovery._get_client", return_value=owner_client),
        patch("app.routers.discovery.run_job", AsyncMock()) as job,
        patch("app.routers.discovery.asyncio.create_task", side_effect=close_background),
    ):
        response = admin_client.post("/discovery/run")
    assert response.status_code == 202
    assert job.call_args.args[1:] == (ADMIN_ID, owner_client)
    assert job.call_args.kwargs == {"uses_saved_key": False}


def test_missing_admin_server_configuration_refunds_usage(admin_client):
    with patch("app.routers.discovery._get_client", return_value=None):
        response = admin_client.post("/discovery/run")
    assert response.status_code == 409
    assert admin_client.portal.call(get_usage, "analysis_run", str(ADMIN_ID)) == 0


def test_regular_user_never_falls_back_to_server_key(client):
    with (
        patch("app.routers.discovery.claude_keys.resolve_client", return_value=None),
        patch("app.routers.discovery._get_client", side_effect=AssertionError("No owner key")),
    ):
        response = client.post("/discovery/run")
    assert response.status_code == 409
    assert client.portal.call(get_usage, "analysis_run", str(USER_ID)) == 0


def test_polling_hides_other_users_jobs(client):
    with patch("app.routers.discovery.asyncio.create_task", side_effect=close_background):
        job_id = client.post("/discovery/run").json()["job_id"]
    response = client.get(f"/discovery/run/{job_id}")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert response.json()["stage"] == "screening"
    other = client.portal.call(jobs.create_job, OTHER_USER_ID)
    assert client.get(f"/discovery/run/{other}").status_code == 404
    assert client.get(f"/discovery/run/{uuid4()}").status_code == 404


def test_scan_input_reads_only_callers_open_holdings_and_preferences(
    client,
    db_session,
    app_session_local,
):
    add_app_user(db_session, OTHER_USER_ID)
    for user_id, ticker, shares in [
        (USER_ID, "OWN", 1),
        (USER_ID, "SOLD", 0),
        (OTHER_USER_ID, "PRIVATE", 1),
    ]:
        db_session.add(
            Holding(
                user_id=user_id,
                ticker=ticker,
                shares=shares,
                name=ticker,
                asset_type="STOCK",
                cost_basis=1,
                first_purchase_date=date(2025, 1, 1),
            )
        )
    db_session.add_all(
        [
            InvestmentPreferences(user_id=USER_ID, sector_avoid_list=["Energy"]),
            InvestmentPreferences(user_id=OTHER_USER_ID, sector_avoid_list=["Technology"]),
        ]
    )
    db_session.commit()
    with patch("app.db.SessionLocal", app_session_local):
        holdings, avoided = runner._user_inputs(USER_ID)
    assert [holding.ticker for holding in holdings] == ["OWN"] and avoided == ["Energy"]


def test_ideas_return_only_owners_pending_discovery_and_latest_scan(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    for user_id, source, status, ticker in [
        (USER_ID, "discovery", "PENDING", "OWN"),
        (USER_ID, "manual", "PENDING", "MANUAL"),
        (USER_ID, "discovery", "SUPERSEDED", "OLD"),
        (OTHER_USER_ID, "discovery", "PENDING", "PRIVATE"),
    ]:
        db_session.add(
            Recommendation(
                user_id=user_id,
                source=source,
                status=status,
                ticker=ticker,
                asset_type="STOCK",
                action="BUY",
                reasoning=["test"],
            )
        )
    for user_id, summary in [(USER_ID, "Own scan"), (OTHER_USER_ID, "Private scan")]:
        db_session.add(
            ScanRun(
                user_id=user_id,
                status="completed",
                universe_size=600,
                eligible=0,
                shortlisted=0,
                researched=0,
                outcome="none",
                summary=summary,
                excluded=[],
                rejected_mentions=[],
                coverage_summary={"nearest_misses": []},
            )
        )
    db_session.commit()
    response = client.get("/discovery/ideas")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    data = response.json()
    assert [rec["ticker"] for rec in data["recommendations"]] == ["OWN"]
    assert data["latest_scan"]["summary"] == "Own scan"
    assert data["latest_scan"]["opportunities"] is None
    assert data["latest_scan"]["set_aside"] is None
    assert "PRIVATE" not in response.text and "Private scan" not in response.text


def test_empty_ideas_need_no_claude_key(client_no_key):
    response = client_no_key.get("/discovery/ideas")
    assert response.status_code == 200
    assert response.json() == {"recommendations": [], "latest_scan": None}


def test_feed_ranks_before_limiting_and_matches_evaluation_order(client, db_session):
    ideas = []
    for index in range(60):
        idea = sample_idea()
        idea.ticker = ["BRK.A", "BRK-A", "BRKA"][(index // 3) % 3] + f"{index:02d}"
        idea.overall = None if index == 59 else 80 if index < 9 else 70
        idea.risk.risk_level = ["unknown", "high", "medium", "low"][index % 4]
        fit = next(score for score in idea.scores if score.name == "fit")
        fit.score = [None, 0, 50][index % 3]
        # Valid contracts allow arbitrary score order; fit is not always at index two.
        idea.scores.reverse()
        ideas.append(idea)
        db_session.add(
            Recommendation(
                user_id=USER_ID,
                ticker=idea.ticker,
                asset_type="STOCK",
                action="BUY",
                source="discovery",
                status="PENDING",
                reasoning=["test"],
                created_at=datetime(2026, 10, 1, 0, index),
                idea=idea.model_dump(mode="json", exclude={"snapshot", "headline"}),
            )
        )
    # Null payloads from older rows remain readable and sort behind scored ideas.
    db_session.add(
        Recommendation(
            user_id=USER_ID,
            ticker="LEGACY",
            asset_type="STOCK",
            action="BUY",
            source="discovery",
            status="PENDING",
            reasoning=["old"],
        )
    )
    db_session.commit()
    response = client.get("/discovery/ideas")
    assert response.status_code == 200
    records = response.json()["recommendations"]
    assert [row["ticker"] for row in records] == [idea.ticker for idea in rank_ideas(ideas)[:50]]
    assert all(
        row["idea"]["snapshot"] is None and row["idea"]["headline"] is None for row in records
    )


def test_saved_display_fields_round_trip_without_live_enrichment(client_no_key, app_session_local):
    candidate = sample_candidate()
    idea = sample_idea()
    # The candidate's `peers` are comparisons; the snapshot's are the named peer rows.
    snapshot = candidate.model_dump(include=set(IdeaSnapshot.model_fields) - {"peers"})
    snapshot["peers"] = [
        {
            "ticker": "KHC",
            "name": "Kraft Heinz",
            "country": "United States",
            "currency": "USD",
            "market_cap_eur": 35e9,
            "values": {"trailingPE": 17.0, "returnOnEquity": None},
        }
    ]
    idea.snapshot = IdeaSnapshot.model_validate(snapshot)
    idea.competitors = ["Danone", "Unilever"]
    idea.headline = "Saved thesis excerpt."
    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [idea], universe_size=600, eligible=20, shortlisted=1, researched=1)
    with (
        patch(
            "app.agents.market_data.fetch_profile", side_effect=AssertionError("No live profile")
        ),
        patch(
            "app.agents.market_data.fetch_quote_and_history", side_effect=AssertionError("No quote")
        ),
    ):
        response = client_no_key.get("/discovery/ideas")
    assert response.status_code == 200
    saved = response.json()["recommendations"][0]["idea"]
    assert saved == idea.model_dump(mode="json")


def test_feed_treats_legacy_risk_as_unknown_and_breaks_equal_rank_ties_by_date(client, db_session):
    rows = []
    for ticker, risk, day in [
        ("AAA", None, 1),
        ("BBB", "unknown", 1),
        ("CCC", None, 1),
        ("ZZZ", "low", 1),
        ("DUP", "unknown", 3),
        ("DUP", "unknown", 2),
    ]:
        idea = None
        if risk is not None:
            idea = sample_idea()
            idea.ticker, idea.overall, idea.risk.risk_level = ticker, None, risk
            next(score for score in idea.scores if score.name == "fit").score = None
        row = Recommendation(
            user_id=USER_ID,
            ticker=ticker,
            asset_type="STOCK",
            action="BUY",
            source="discovery",
            status="PENDING",
            reasoning=["saved"],
            created_at=datetime(2026, 10, day),
            idea=idea.model_dump(mode="json") if idea is not None else None,
        )
        db_session.add(row)
        rows.append(row)
    db_session.commit()
    response = client.get("/discovery/ideas")
    assert response.status_code == 200
    saved = response.json()["recommendations"]
    assert [row["ticker"] for row in saved] == ["ZZZ", "AAA", "BBB", "CCC", "DUP", "DUP"]
    # The older duplicate has the higher ID; the date must take precedence over that ID.
    assert [row["id"] for row in saved[-2:]] == [rows[-2].id, rows[-1].id]


def test_monthly_cap_prevents_job_creation(client, db_session):
    db_session.get(AppUser, USER_ID).monthly_analysis_limit = 0
    db_session.commit()
    with patch("app.routers.discovery.create_job", AsyncMock()) as created:
        response = client.post("/discovery/run")
    assert response.status_code == 429
    assert client.portal.call(get_usage, "analysis_run", str(USER_ID)) == 0
    created.assert_not_awaited()


def test_discovery_burst_limit_is_two_requests(client):
    with patch("app.routers.discovery.asyncio.create_task", side_effect=close_background):
        assert client.post("/discovery/run").status_code == 202
        assert client.post("/discovery/run").status_code == 409
        assert client.post("/discovery/run").status_code == 429
    assert client.portal.call(get_usage, "analysis_run", str(USER_ID)) == 1


def test_real_manual_job_quant_only_persists_none_and_is_readable(
    client,
    db_session,
    app_session_local,
    monkeypatch,
):
    snapshots = [snap(i, dates=[datetime.now(UTC).date().isoformat()]) for i in range(1, 13)]
    monkeypatch.setattr(runner, "load_universe", lambda: snapshots)
    monkeypatch.setattr(runner, "load_snapshot", AsyncMock(return_value=snapshots))
    monkeypatch.setattr(runner, "_rates", AsyncMock(return_value={"USD": Decimal("0.9")}))
    monkeypatch.setattr(settings, "tavily_api_key", None)
    monkeypatch.setattr("app.db.SessionLocal", app_session_local)

    async def wait_for_job(job_id):
        async with asyncio.timeout(10):
            while True:
                status = await jobs.get_job_status(job_id, USER_ID)
                if status["status"] != "RUNNING":
                    return status
                await asyncio.sleep(0.01)

    response = client.post("/discovery/run")
    assert response.status_code == 202
    state = client.portal.call(wait_for_job, response.json()["job_id"])
    assert state["status"] == "DONE" and state["done"] == 8
    assert state["scan"]["outcome"] == "none" and len(state["results"]) == 8
    assert all(idea["confidence"] == "low" for idea in state["results"])
    assert len(state["scan"]["coverage_summary"]["nearest_misses"]) == 3
    assert db_session.query(ScanRun).count() == 1 and db_session.query(Recommendation).count() == 0
    feed = client.get("/discovery/ideas").json()
    assert feed["recommendations"] == [] and feed["latest_scan"]["id"] == state["scan"]["id"]
