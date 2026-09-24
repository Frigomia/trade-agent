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
