from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models import AppUser, ChatMessage
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user, auth_headers


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


def test_chat_rate_limited_after_20_calls_per_minute(client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)  # fast 503 per call, no mocking

    for _ in range(20):
        response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
        assert response.status_code == 503

    response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
    assert response.status_code == 429


def test_chat_is_429_after_the_monthly_limit(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)  # fast 503 per call, no mocking
    db_session.query(AppUser).filter_by(id=USER_ID).update({"monthly_chat_limit": 2})
    db_session.commit()

    for _ in range(2):
        response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
        assert response.status_code == 503

    response = client.post("/chat", json={"session_id": "s1", "message": "hi"})
    assert response.status_code == 429
    assert "Monthly limit reached" in response.json()["detail"]


def test_chat_requires_authentication(anon_client):
    response = anon_client.post("/chat", json={"session_id": "s", "message": "hi"})
    assert response.status_code == 401


def test_chat_persists_rows_for_the_token_user_not_a_default(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    add_app_user(db_session, OTHER_USER_ID)

    with patch("app.routers.chat.run_chat", AsyncMock(return_value="reply")) as mock_run:
        response = client.post(
            "/chat",
            json={"session_id": "s1", "message": "hi"},
            headers=auth_headers(OTHER_USER_ID),
        )

    assert response.status_code == 200
    rows = db_session.query(ChatMessage).all()
    assert [row.user_id for row in rows] == [OTHER_USER_ID, OTHER_USER_ID]
    assert mock_run.call_args.args[1] == OTHER_USER_ID


def _add_messages(db_session, user_id, session_id, count, start=0):
    base = datetime(2026, 1, 1)
    for i in range(start, start + count):
        db_session.add(
            ChatMessage(
                user_id=user_id,
                session_id=session_id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"m{i}",
                created_at=base + timedelta(minutes=i),
            )
        )
    db_session.commit()


def test_history_is_empty_for_a_new_user(client):
    response = client.get("/chat/messages")

    assert response.status_code == 200
    assert response.json() == []


def test_history_returns_the_caller_session_oldest_first(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    _add_messages(db_session, USER_ID, "main", 3)
    _add_messages(db_session, USER_ID, "elsewhere", 2, start=10)
    _add_messages(db_session, OTHER_USER_ID, "main", 2, start=20)

    body = client.get("/chat/messages").json()

    assert [m["content"] for m in body] == ["m0", "m1", "m2"]
    assert body[0]["role"] == "user" and body[1]["role"] == "assistant"
    assert set(body[0]) == {"id", "session_id", "role", "content", "created_at"}


def test_history_is_capped_at_the_last_50(client, db_session):
    _add_messages(db_session, USER_ID, "main", 55)

    body = client.get("/chat/messages").json()

    assert len(body) == 50
    assert body[0]["content"] == "m5"
    assert body[-1]["content"] == "m54"


def test_history_requires_authentication(anon_client):
    assert anon_client.get("/chat/messages").status_code == 401
    assert anon_client.delete("/chat/messages").status_code == 401


def test_clearing_deletes_only_the_callers_rows_of_that_session(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    _add_messages(db_session, USER_ID, "main", 3)
    _add_messages(db_session, USER_ID, "elsewhere", 2, start=10)
    _add_messages(db_session, OTHER_USER_ID, "main", 2, start=20)

    response = client.delete("/chat/messages")

    assert response.status_code == 204
    db_session.expire_all()
    remaining = {(m.user_id, m.session_id) for m in db_session.query(ChatMessage).all()}
    assert remaining == {(USER_ID, "elsewhere"), (OTHER_USER_ID, "main")}


def test_chat_sends_only_the_last_20_messages_to_claude(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _add_messages(db_session, USER_ID, "main", 25)

    seen: list[str] = []

    async def fake_run_chat(*args, history, **kwargs):
        # read while the request session is still open (the rows detach afterwards)
        seen.extend(m.content for m in history)
        return "ok"

    with patch("app.routers.chat.run_chat", fake_run_chat):
        client.post("/chat", json={"session_id": "main", "message": "hello"})

    assert len(seen) == 20
    assert seen[0] == "m5"
    assert seen[-1] == "m24"
