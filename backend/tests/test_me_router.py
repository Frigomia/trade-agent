from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

import app.redis_client as redis_client_module
from app import rls
from app.config import settings
from app.db import Base
from app.models import AppUser, InvestmentPreferences
from tests.auth_support import OTHER_USER_ID, ROW_FACTORIES, USER_ID, add_app_user, auth_headers


def test_me_returns_the_callers_own_state(client):
    body = client.get("/me").json()

    assert body["id"] == str(USER_ID)
    assert body["email"] == "user@example.com"
    assert body["role"] == "user"
    assert body["status"] == "active"


def test_an_invited_user_can_read_me_but_nothing_else(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).json()["status"] == "invited"
    assert client.get("/portfolio/holdings", headers=headers).status_code == 403
    assert client.get("/preferences", headers=headers).status_code == 403


def test_a_disabled_user_is_refused_on_me_and_accept(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="disabled")
    headers = auth_headers(OTHER_USER_ID)

    assert client.get("/me", headers=headers).status_code == 403
    assert (
        client.post("/me/accept", json={"accept_terms": True}, headers=headers).status_code == 403
    )


def test_an_unknown_user_is_refused_on_me(client):
    assert client.get("/me", headers=auth_headers(OTHER_USER_ID)).status_code == 403


def test_me_requires_authentication(anon_client):
    assert anon_client.get("/me").status_code == 401
    assert anon_client.post("/me/accept", json={"accept_terms": True}).status_code == 401


def test_accepting_activates_an_invited_user_and_records_the_terms(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited", invited_at=datetime(2026, 9, 28))
    headers = auth_headers(OTHER_USER_ID)

    response = client.post("/me/accept", json={"accept_terms": True}, headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert response.json()["accepted_terms_at"] is not None
    # Now a normal active user: regular routes work.
    assert client.get("/portfolio/holdings", headers=headers).status_code == 200


def test_accepting_without_ticking_the_terms_changes_nothing(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    assert (
        client.post("/me/accept", json={"accept_terms": False}, headers=headers).status_code == 422
    )
    assert client.post("/me/accept", json={}, headers=headers).status_code == 422

    db_session.expire_all()
    stored = db_session.get(AppUser, OTHER_USER_ID)
    assert stored.status == "invited"
    assert stored.accepted_terms_at is None


def test_accepting_twice_is_idempotent(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)

    first = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()
    second = client.post("/me/accept", json={"accept_terms": True}, headers=headers).json()

    assert second["status"] == "active"
    assert second["accepted_terms_at"] == first["accepted_terms_at"]


def _count(engine, table_name: str, user_id) -> int:
    table = Base.metadata.tables[table_name]
    with sessionmaker(bind=engine)() as session:
        return session.execute(
            select(func.count()).select_from(table).where(table.c.user_id == user_id)
        ).scalar_one()


def test_usage_starts_at_zero_with_the_default_limits(client):
    from app.config import settings

    response = client.get("/me/usage")

    assert response.status_code == 200
    body = response.json()
    assert body["analysis_runs"] == {
        "used": 0,
        "limit": settings.default_monthly_analysis_limit,
    }
    assert body["chat_messages"] == {"used": 0, "limit": settings.default_monthly_chat_limit}


def test_usage_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.get("/me/usage", headers=auth_headers(OTHER_USER_ID))
    assert response.status_code == 403


def test_usage_reflects_real_calls_and_matches_the_admin_view(
    client, admin_client, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "anthropic_api_key", None)  # fast 503 per call, no mocking

    def _close_coro(coro):
        coro.close()
        return MagicMock()

    with (
        patch("app.routers.analysis.create_job", AsyncMock(return_value="job-1")),
        patch("app.routers.analysis.run_job", AsyncMock()),
        patch("app.routers.analysis.asyncio.create_task", side_effect=_close_coro),
    ):
        client.post("/analysis/run", json={})

    client.post("/chat", json={"session_id": "s1", "message": "hi"})
    client.post("/chat", json={"session_id": "s1", "message": "hi"})

    usage = client.get("/me/usage").json()
    assert usage["analysis_runs"]["used"] == 1
    assert usage["chat_messages"]["used"] == 2

    # `client` and `admin_client` are two separate TestClients, each with its own event-loop
    # portal; the module-level Redis client is a singleton bound to whichever loop created it,
    # so it must be dropped before switching portals or the admin_client calls below raise
    # "attached to a different loop" (same reason conftest's _reset_redis_client resets it
    # between tests, just needed mid-test here too).
    redis_client_module._redis = None

    admin_row = next(u for u in admin_client.get("/admin/users").json() if u["id"] == str(USER_ID))
    assert admin_row["monthly_analysis_used"] == 1
    assert admin_row["monthly_chat_used"] == 2


def test_export_returns_only_the_callers_own_rows(client, db_session):
    add_app_user(db_session, OTHER_USER_ID)
    # investment_preferences is a singular object in ExportOut, and its Out schema exposes no
    # user_id (nor does chat_messages'/portfolio_snapshots'), so give those a value that differs
    # per user to prove isolation; every other table's Out schema exposes user_id directly.
    for table_name in rls.USER_TABLES:
        if table_name == "investment_preferences":
            continue
        caller_row = ROW_FACTORIES[table_name](USER_ID)
        other_row = ROW_FACTORIES[table_name](OTHER_USER_ID)
        if table_name == "chat_messages":
            other_row.content = "other user's message"
        elif table_name == "portfolio_snapshots":
            other_row.total_market_value = 999
        db_session.add_all([caller_row, other_row])
    db_session.add(InvestmentPreferences(user_id=USER_ID, notes="caller-notes"))
    db_session.add(InvestmentPreferences(user_id=OTHER_USER_ID, notes="other-notes"))
    db_session.commit()

    response = client.get("/me/export")

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["id"] == str(USER_ID)

    rows_with_user_id = set(rls.USER_TABLES) - {
        "investment_preferences",
        "chat_messages",
        "portfolio_snapshots",
    }
    for table_name in rows_with_user_id:
        rows = body[table_name]
        assert len(rows) == 1, table_name
        assert rows[0]["user_id"] == str(USER_ID), table_name

    assert len(body["chat_messages"]) == 1
    assert body["chat_messages"][0]["content"] == "hi"
    assert len(body["portfolio_snapshots"]) == 1
    assert body["portfolio_snapshots"][0]["total_market_value"] == 1
    assert body["investment_preferences"]["notes"] == "caller-notes"


def test_export_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.get("/me/export", headers=auth_headers(OTHER_USER_ID))
    assert response.status_code == 403


def test_delete_my_data_wipes_only_the_callers_rows(client, db_session, engine):
    add_app_user(db_session, OTHER_USER_ID)
    for table_name in rls.USER_TABLES:
        db_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
    db_session.commit()

    response = client.request("DELETE", "/me/data", json={"confirm": True})

    assert response.status_code == 204
    for table_name in rls.USER_TABLES:
        assert _count(engine, table_name, USER_ID) == 0, table_name
        assert _count(engine, table_name, OTHER_USER_ID) == 1, table_name


def test_delete_my_data_requires_confirm(client):
    assert client.request("DELETE", "/me/data", json={}).status_code == 422
    assert client.request("DELETE", "/me/data", json={"confirm": False}).status_code == 422


def test_delete_my_data_is_403_for_an_invited_user(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    response = client.request(
        "DELETE", "/me/data", json={"confirm": True}, headers=auth_headers(OTHER_USER_ID)
    )
    assert response.status_code == 403
