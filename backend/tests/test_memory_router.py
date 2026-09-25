from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models import Recommendation


def test_embed_recommendations_without_api_key_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", None)
    response = client.post("/memory/embed")
    assert response.status_code == 503


def test_embed_recommendations_embeds_pending_rows(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
    )
    db_session.add(rec)
    db_session.commit()

    fake_embedding = [0.1] * 1024
    with patch("app.routers.memory.embed_text", AsyncMock(return_value=fake_embedding)):
        response = client.post("/memory/embed")

    assert response.status_code == 200
    assert response.json() == {"embedded": 1, "remaining": 0}


def test_evaluate_outcomes_evaluates_due_rows(client, db_session, monkeypatch):
    old_date = datetime.now(UTC) - timedelta(days=21)
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        price_at_recommendation=150.0,
        created_at=old_date,
    )
    db_session.add(rec)
    db_session.commit()

    with patch("app.routers.memory.compute_outcome", AsyncMock(return_value=0.05)):
        response = client.post("/memory/evaluate-outcomes")

    assert response.status_code == 200
    assert response.json() == {"evaluated": 1, "remaining": 0}


def test_embed_recommendations_skips_failed_row_and_continues(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")
    rec1 = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
    )
    rec2 = Recommendation(
        user_id=settings.default_user_id,
        ticker="MSFT",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.2"],
    )
    db_session.add_all([rec1, rec2])
    db_session.commit()

    with patch(
        "app.routers.memory.embed_text",
        AsyncMock(side_effect=[RuntimeError("boom"), [0.1] * 1024]),
    ):
        response = client.post("/memory/embed")

    assert response.status_code == 200
    body = response.json()
    assert body["embedded"] == 1
    assert body["remaining"] == 1


def test_evaluate_outcomes_skips_failed_row_and_continues(client, db_session, monkeypatch):
    old_date = datetime.now(UTC) - timedelta(days=21)
    rec1 = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        price_at_recommendation=150.0,
        created_at=old_date,
    )
    rec2 = Recommendation(
        user_id=settings.default_user_id,
        ticker="MSFT",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.2"],
        price_at_recommendation=250.0,
        created_at=old_date,
    )
    db_session.add_all([rec1, rec2])
    db_session.commit()

    with patch(
        "app.routers.memory.compute_outcome",
        AsyncMock(side_effect=[RuntimeError("boom"), 0.05]),
    ):
        response = client.post("/memory/evaluate-outcomes")

    assert response.status_code == 200
    body = response.json()
    assert body["evaluated"] == 1
    # rec1's failure is permanent (no price history) -> stamped resolved, not
    # re-counted as still due, so remaining is 0 not 1.
    assert body["remaining"] == 0


def test_evaluate_outcomes_marks_permanently_failed_row_resolved(client, db_session, monkeypatch):
    old_date = datetime.now(UTC) - timedelta(days=21)
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="DELISTED",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        price_at_recommendation=150.0,
        created_at=old_date,
    )
    db_session.add(rec)
    db_session.commit()

    with patch(
        "app.routers.memory.compute_outcome",
        AsyncMock(side_effect=ValueError("No price history for DELISTED")),
    ):
        first = client.post("/memory/evaluate-outcomes")
        second = client.post("/memory/evaluate-outcomes")

    assert first.json() == {"evaluated": 0, "remaining": 0}
    # Second call must not re-select the same permanently-failing row --
    # this is the actual regression test for the "stuck batch" bug.
    assert second.json() == {"evaluated": 0, "remaining": 0}

    db_session.refresh(rec)
    assert rec.outcome_evaluated_at is not None
    assert rec.outcome_forward_return_pct is None


def test_similar_recommendations_without_api_key_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", None)
    response = client.post("/memory/similar", json={"query": "AAPL oversold"})
    assert response.status_code == 503


def test_similar_recommendations_returns_matches(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "voyage_api_key", "test-key")
    rec = Recommendation(
        user_id=settings.default_user_id,
        ticker="AAPL",
        asset_type="STOCK",
        action="BUY",
        reasoning=["PEG 1.1"],
        embedding=[0.1] * 1024,
    )
    db_session.add(rec)
    db_session.commit()

    with patch("app.routers.memory.embed_text", AsyncMock(return_value=[0.1] * 1024)):
        response = client.post("/memory/similar", json={"query": "AAPL oversold"})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["ticker"] == "AAPL"
