from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models import ChatMessage


def test_chat_without_api_key_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
    assert response.status_code == 503


def test_chat_rejects_oversized_message(client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    response = client.post("/chat", json={"session_id": "s1", "message": "x" * 4001})
    assert response.status_code == 422


def test_chat_persists_both_turns_and_returns_reply(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="Here's your answer.")):
        response = client.post("/chat", json={"session_id": "s1", "message": "how's AAPL?"})

    assert response.status_code == 200
    assert response.json() == {"session_id": "s1", "message": "Here's your answer."}

    rows = (
        db_session.query(ChatMessage)
        .filter_by(session_id="s1")
        .order_by(ChatMessage.created_at)
        .all()
    )
    assert len(rows) == 2
    assert rows[0].role == "user"
    assert rows[0].content == "how's AAPL?"
    assert rows[1].role == "assistant"
    assert rows[1].content == "Here's your answer."


def test_chat_second_call_passes_prior_turns_as_history(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="first reply")) as mock_run:
        client.post("/chat", json={"session_id": "s1", "message": "first message"})

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="second reply")) as mock_run:
        client.post("/chat", json={"session_id": "s1", "message": "second message"})

    call_kwargs = mock_run.call_args.kwargs
    assert len(call_kwargs["history"]) == 2  # first user turn + first assistant reply


def test_chat_sessions_are_isolated(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="reply for s1")):
        client.post("/chat", json={"session_id": "s1", "message": "message in s1"})

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="reply for s2")) as mock_run:
        client.post("/chat", json={"session_id": "s2", "message": "message in s2"})

    # s2's call must not see s1's history, even though s1 has rows already
    call_kwargs = mock_run.call_args.kwargs
    assert call_kwargs["history"] == []
