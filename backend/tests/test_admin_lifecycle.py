import asyncio
import uuid
from unittest.mock import patch

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

import app.redis_client as redis_client_module
from app import rls, telegram
from app.db import Base
from app.models import AppUser, TelegramLink
from app.user_data import delete_user_data
from tests.auth_support import (
    ADMIN_ID,
    OTHER_USER_ID,
    ROW_FACTORIES,
    USER_ID,
    add_app_user,
    auth_headers,
)


def _row(db_session, user_id) -> AppUser | None:
    db_session.expire_all()
    return db_session.get(AppUser, user_id)


def _count(engine, table_name: str, user_id) -> int:
    table = Base.metadata.tables[table_name]
    with sessionmaker(bind=engine)() as session:
        return session.execute(
            select(func.count()).select_from(table).where(table.c.user_id == user_id)
        ).scalar_one()


# ---- disable / enable ------------------------------------------------------------------------
def test_disable_bans_the_user_and_locks_them_out_immediately(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active")
    token_headers = auth_headers(USER_ID)
    assert admin_client.get("/portfolio/holdings", headers=token_headers).status_code == 200

    response = admin_client.post(f"/admin/users/{USER_ID}/disable")

    assert response.status_code == 200
    assert response.json()["status"] == "disabled"
    assert fake_supabase.calls == [("ban", USER_ID)]
    # Same unexpired token, now refused.
    assert admin_client.get("/portfolio/holdings", headers=token_headers).status_code == 403
    assert admin_client.get("/me", headers=token_headers).status_code == 403


def test_disable_supabase_failure_is_502_and_changes_nothing(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active")
    fake_supabase.fail_on.add("ban")

    assert admin_client.post(f"/admin/users/{USER_ID}/disable").status_code == 502
    assert _row(db_session, USER_ID).status == "active"


def test_an_admin_cannot_disable_themselves(admin_client, db_session, fake_supabase):
    assert admin_client.post(f"/admin/users/{ADMIN_ID}/disable").status_code == 409
    assert fake_supabase.calls == []
    assert _row(db_session, ADMIN_ID).status == "active"


def test_disabling_another_admin_leaves_the_caller_an_active_admin(admin_client, db_session):
    add_app_user(db_session, OTHER_USER_ID, role="admin")

    assert admin_client.post(f"/admin/users/{OTHER_USER_ID}/disable").status_code == 200

    assert _row(db_session, OTHER_USER_ID).status == "disabled"
    assert _row(db_session, ADMIN_ID).status == "active"  # at least one active admin remains


def test_disable_only_applies_to_active_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="invited")
    add_app_user(db_session, OTHER_USER_ID, status="disabled")

    assert admin_client.post(f"/admin/users/{USER_ID}/disable").status_code == 409
    assert admin_client.post(f"/admin/users/{OTHER_USER_ID}/disable").status_code == 409
    assert admin_client.post(f"/admin/users/{uuid.uuid4()}/disable").status_code == 404


def test_enable_unbans_and_reactivates(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="disabled")

    response = admin_client.post(f"/admin/users/{USER_ID}/enable")

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert fake_supabase.calls == [("unban", USER_ID)]


def test_enable_supabase_failure_is_502_and_keeps_the_user_disabled(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="disabled")
    fake_supabase.fail_on.add("unban")

    assert admin_client.post(f"/admin/users/{USER_ID}/enable").status_code == 502
    assert _row(db_session, USER_ID).status == "disabled"


def test_enable_only_applies_to_disabled_users(admin_client, db_session):
    add_app_user(db_session, USER_ID, status="active")

    assert admin_client.post(f"/admin/users/{USER_ID}/enable").status_code == 409


# ---- remove ----------------------------------------------------------------------------------
def _remove(admin_client, user_id, email):
    return admin_client.request("DELETE", f"/admin/users/{user_id}", json={"confirm_email": email})


def test_remove_requires_the_matching_email_and_changes_nothing_otherwise(
    admin_client, db_session, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")

    response = _remove(admin_client, USER_ID, "wrong@example.com")

    assert response.status_code == 422
    assert fake_supabase.calls == []
    assert _row(db_session, USER_ID).status == "active"


def test_remove_deletes_only_the_targets_data_and_accounts(
    admin_client, db_session, engine, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    add_app_user(db_session, OTHER_USER_ID, status="active")
    for table_name in rls.USER_TABLES:
        db_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
    db_session.commit()

    response = _remove(admin_client, USER_ID, "target@example.com")

    assert response.status_code == 204
    assert fake_supabase.calls == [("ban", USER_ID), ("delete", USER_ID)]
    assert _row(db_session, USER_ID) is None
    for table_name in rls.USER_TABLES:
        assert _count(engine, table_name, USER_ID) == 0, table_name
        assert _count(engine, table_name, OTHER_USER_ID) == 1, table_name
    assert _row(db_session, OTHER_USER_ID) is not None


def test_a_remove_that_fails_at_supabase_leaves_the_user_disabled_and_a_retry_completes_it(
    admin_client, db_session, engine, fake_supabase
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    db_session.add(ROW_FACTORIES["holdings"](USER_ID))
    db_session.commit()
    fake_supabase.fail_on.add("delete")

    first = _remove(admin_client, USER_ID, "target@example.com")

    assert first.status_code == 502
    assert _row(db_session, USER_ID).status == "disabled"  # access is already cut
    assert _count(engine, "holdings", USER_ID) == 0

    fake_supabase.fail_on.clear()
    second = _remove(admin_client, USER_ID, "target@example.com")

    assert second.status_code == 204
    assert _row(db_session, USER_ID) is None


def test_an_admin_cannot_remove_themselves(admin_client, db_session, fake_supabase):
    response = _remove(admin_client, ADMIN_ID, "admin@example.com")

    assert response.status_code == 409
    assert fake_supabase.calls == []
    assert _row(db_session, ADMIN_ID) is not None


def test_remove_unknown_user_is_404(admin_client):
    assert _remove(admin_client, uuid.uuid4(), "a@example.com").status_code == 404


def test_remove_works_for_a_pending_invitation(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="invited", email="pending@example.com")

    assert _remove(admin_client, USER_ID, "pending@example.com").status_code == 204
    assert _row(db_session, USER_ID) is None


def test_lifecycle_routes_require_admin(client, anon_client):
    assert client.post(f"/admin/users/{USER_ID}/disable").status_code == 403
    assert (
        client.request(
            "DELETE", f"/admin/users/{USER_ID}", json={"confirm_email": "a@b.co"}
        ).status_code
        == 403
    )
    assert anon_client.post(f"/admin/users/{USER_ID}/enable").status_code == 401


def test_delete_user_data_only_touches_the_target_even_when_rls_is_bypassed(
    db_session, engine, session_local
):
    # `session_local` is bound to the owner engine, which bypasses RLS: only the explicit
    # user_id filter can keep the other user's rows.
    add_app_user(db_session, USER_ID)
    add_app_user(db_session, OTHER_USER_ID)
    for table_name in rls.USER_TABLES:
        db_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
    db_session.commit()

    delete_user_data(session_local, USER_ID)

    for table_name in rls.USER_TABLES:
        assert _count(engine, table_name, USER_ID) == 0, table_name
        assert _count(engine, table_name, OTHER_USER_ID) == 1, table_name


def test_remove_deletes_data_written_between_the_two_passes(
    admin_client, db_session, engine, fake_supabase, monkeypatch
):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    real_delete = fake_supabase.delete

    def delete_then_simulate_a_late_job_write(user_id):
        real_delete(user_id)
        db_session.add(ROW_FACTORIES["holdings"](USER_ID))
        db_session.commit()

    monkeypatch.setattr(fake_supabase, "delete", delete_then_simulate_a_late_job_write)

    assert _remove(admin_client, USER_ID, "target@example.com").status_code == 204

    assert _count(engine, "holdings", USER_ID) == 0
    assert _row(db_session, USER_ID) is None


def _redis_run(coro_fn):
    # The cached Redis client is bound to one event loop: drop it before and after each run.
    redis_client_module._redis = None
    try:
        return asyncio.run(coro_fn())
    finally:
        redis_client_module._redis = None


def test_remove_forgets_the_targets_chat_mapping_only(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    add_app_user(db_session, OTHER_USER_ID, status="active")
    db_session.add_all(
        [
            TelegramLink(user_id=USER_ID, chat_id=5005),
            TelegramLink(user_id=OTHER_USER_ID, chat_id=6006),
        ]
    )
    db_session.commit()
    _redis_run(lambda: telegram.remember_chat(5005, USER_ID))
    _redis_run(lambda: telegram.remember_chat(6006, OTHER_USER_ID))

    assert _remove(admin_client, USER_ID, "target@example.com").status_code == 204

    assert _redis_run(lambda: telegram.user_for_chat(5005)) is None
    assert _redis_run(lambda: telegram.user_for_chat(6006)) == OTHER_USER_ID


def test_a_failed_remove_still_forgets_the_chat_mapping(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=5005))
    db_session.commit()
    _redis_run(lambda: telegram.remember_chat(5005, USER_ID))
    fake_supabase.fail_on.add("delete")

    assert _remove(admin_client, USER_ID, "target@example.com").status_code == 502

    # The link row is gone already, so a retry could not find the chat id again.
    assert _redis_run(lambda: telegram.user_for_chat(5005)) is None


def test_a_redis_failure_does_not_fail_remove(admin_client, db_session, fake_supabase):
    add_app_user(db_session, USER_ID, status="active", email="target@example.com")
    db_session.add(TelegramLink(user_id=USER_ID, chat_id=5005))
    db_session.commit()

    async def broken(chat_id):
        raise ConnectionError("redis down")

    with patch("app.telegram.forget_chat", broken):
        response = _remove(admin_client, USER_ID, "target@example.com")

    assert response.status_code == 204
    assert _row(db_session, USER_ID) is None
