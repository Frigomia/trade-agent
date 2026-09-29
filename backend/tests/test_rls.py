import pytest
from sqlalchemy import Table, create_engine, delete, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from app import rls
from app.db import Base, open_user_session
from app.models import Holding
from tests.auth_support import OTHER_USER_ID, ROW_FACTORIES, USER_ID


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _seed_both_users(engine, table_name: str) -> None:
    owner_session = sessionmaker(bind=engine)()
    try:
        owner_session.add_all(
            [ROW_FACTORIES[table_name](USER_ID), ROW_FACTORIES[table_name](OTHER_USER_ID)]
        )
        owner_session.commit()
    finally:
        owner_session.close()


def test_user_tables_are_exactly_the_models_with_a_user_id_column():
    with_user_id = {name for name, t in Base.metadata.tables.items() if "user_id" in t.columns}
    assert with_user_id == set(rls.USER_TABLES)


def test_runtime_tables_cover_every_table():
    assert set(Base.metadata.tables) == set(rls.RUNTIME_TABLES)


def test_every_user_table_has_a_row_factory_in_this_file():
    assert set(ROW_FACTORIES) == set(rls.USER_TABLES)


@pytest.mark.parametrize("table_name", rls.USER_TABLES)
def test_user_sees_only_own_rows(engine, app_session_local, table_name):
    _seed_both_users(engine, table_name)
    table = _table(table_name)

    with open_user_session(app_session_local, USER_ID) as session:
        owners = session.execute(select(table.c.user_id)).scalars().all()

    assert owners == [USER_ID]


@pytest.mark.parametrize("table_name", rls.USER_TABLES)
def test_user_cannot_update_or_delete_other_users_rows(engine, app_session_local, table_name):
    _seed_both_users(engine, table_name)
    table = _table(table_name)

    with open_user_session(app_session_local, USER_ID) as session:
        updated = session.execute(
            update(table).where(table.c.user_id == OTHER_USER_ID).values(user_id=OTHER_USER_ID)
        )
        deleted = session.execute(delete(table).where(table.c.user_id == OTHER_USER_ID))
        session.commit()

    assert updated.rowcount == 0
    assert deleted.rowcount == 0
    with sessionmaker(bind=engine)() as owner_session:
        remaining = owner_session.execute(select(table.c.user_id)).scalars().all()
    assert sorted(remaining) == sorted([USER_ID, OTHER_USER_ID])


@pytest.mark.parametrize("table_name", rls.USER_TABLES)
def test_user_cannot_reassign_own_row_to_another_user(engine, app_session_local, table_name):
    _seed_both_users(engine, table_name)
    table = _table(table_name)

    with (
        open_user_session(app_session_local, USER_ID) as session,
        pytest.raises(DBAPIError, match="row-level security"),
    ):
        session.execute(
            update(table).where(table.c.user_id == USER_ID).values(user_id=OTHER_USER_ID)
        )


@pytest.mark.parametrize("table_name", rls.USER_TABLES)
def test_insert_for_another_user_is_rejected(app_session_local, table_name):
    with open_user_session(app_session_local, USER_ID) as session:
        session.add(ROW_FACTORIES[table_name](OTHER_USER_ID))
        with pytest.raises(DBAPIError, match="row-level security"):
            session.flush()


@pytest.mark.parametrize("table_name", rls.USER_TABLES)
def test_session_with_no_user_sees_no_rows(engine, app_session_local, table_name):
    _seed_both_users(engine, table_name)
    table = _table(table_name)

    with app_session_local() as session:
        rows = session.execute(select(table.c.user_id)).scalars().all()

    assert rows == []


def test_user_setting_is_reapplied_after_commit_and_rollback(app_session_local):
    with open_user_session(app_session_local, USER_ID) as session:
        session.add(ROW_FACTORIES["holdings"](USER_ID))
        session.commit()
        # commit() ended the transaction; the next one must re-apply the setting or RLS
        # would hide the row this user just wrote.
        assert session.query(Holding).count() == 1
        session.rollback()
        assert session.query(Holding).count() == 1


def test_user_setting_does_not_leak_across_pooled_connections(engine, app_engine):
    _seed_both_users(engine, "holdings")
    single_connection_engine = create_engine(app_engine.url, pool_size=1, max_overflow=0)
    factory = sessionmaker(bind=single_connection_engine)
    try:
        with open_user_session(factory, USER_ID) as session_a:
            assert [h.user_id for h in session_a.query(Holding)] == [USER_ID]
        with open_user_session(factory, OTHER_USER_ID) as session_b:
            assert [h.user_id for h in session_b.query(Holding)] == [OTHER_USER_ID]
        with factory() as unscoped:
            assert unscoped.query(Holding).count() == 0
    finally:
        single_connection_engine.dispose()
