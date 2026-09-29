from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app import rls
from app.db import Base
from app.models import AppUser, Holding
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


def test_export_returns_only_the_callers_own_rows(client, db_session):
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="AAPL",
            name="Apple",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    add_app_user(db_session, OTHER_USER_ID)
    db_session.add(
        Holding(
            user_id=OTHER_USER_ID,
            ticker="MSFT",
            name="Microsoft",
            asset_type="STOCK",
            shares=1,
            cost_basis=1,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db_session.commit()

    response = client.get("/me/export")

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["id"] == str(USER_ID)
    assert [h["ticker"] for h in body["holdings"]] == ["AAPL"]


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
