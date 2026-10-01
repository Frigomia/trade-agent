import pytest
from sqlalchemy import create_engine, text

from app.db import UnsafeRuntimeRoleError, check_runtime_role
from tests.conftest import ADMIN_DATABASE_URL, TEST_DATABASE_URL


def test_owner_superuser_is_refused(engine):
    # The test owner role is a superuser that owns every table.
    with engine.connect() as conn, pytest.raises(UnsafeRuntimeRoleError):
        check_runtime_role(conn)


def test_restricted_runtime_role_passes(app_engine):
    with app_engine.connect() as conn:
        check_runtime_role(conn)


def test_a_member_of_the_table_owner_role_counts_as_owner(engine):
    # Membership with inheritance gives the owner's rights, including bypassing RLS.
    admin = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text("DROP ROLE IF EXISTS member_of_owner_test"))
        conn.execute(text("CREATE ROLE member_of_owner_test LOGIN PASSWORD 'pw'"))
        conn.execute(text("GRANT trading_agent TO member_of_owner_test"))
    member_engine = create_engine(
        TEST_DATABASE_URL.replace("trading_agent:trading_agent@", "member_of_owner_test:pw@")
    )
    try:
        with member_engine.connect() as conn, pytest.raises(UnsafeRuntimeRoleError, match="owns"):
            check_runtime_role(conn)
    finally:
        member_engine.dispose()
        with admin.connect() as conn:
            conn.execute(text("DROP ROLE IF EXISTS member_of_owner_test"))
        admin.dispose()


class _FakeConn:
    def __init__(
        self, rolsuper: bool, rolbypassrls: bool, owned: int, postgres_member: bool = False
    ) -> None:
        self._rows = [(rolsuper, rolbypassrls), owned, postgres_member]

    def execute(self, statement, *args, **kwargs):
        value = self._rows.pop(0)
        return _FakeResult(value)


class _FakeResult:
    def __init__(self, value) -> None:
        self._value = value

    def one(self):
        return self._value

    def scalar_one(self):
        return self._value


@pytest.mark.parametrize(
    ("rolsuper", "rolbypassrls", "owned", "postgres_member", "reason"),
    [
        (True, False, 0, False, "superuser"),
        (False, True, 0, False, "BYPASSRLS"),
        (False, False, 2, False, "owns"),
        (False, False, 0, True, "member of postgres"),
    ],
)
def test_each_unsafe_condition_is_refused_without_leaking_secrets(
    rolsuper, rolbypassrls, owned, postgres_member, reason
):
    with pytest.raises(UnsafeRuntimeRoleError, match=reason) as excinfo:
        check_runtime_role(_FakeConn(rolsuper, rolbypassrls, owned, postgres_member))
    assert "://" not in str(excinfo.value)


def test_safe_role_passes():
    check_runtime_role(_FakeConn(False, False, 0))
