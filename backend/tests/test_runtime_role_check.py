import pytest

from app.db import UnsafeRuntimeRoleError, check_runtime_role


def test_owner_superuser_is_refused(engine):
    # The test owner role is a superuser that owns every table.
    with engine.connect() as conn, pytest.raises(UnsafeRuntimeRoleError):
        check_runtime_role(conn)


def test_restricted_runtime_role_passes(app_engine):
    with app_engine.connect() as conn:
        check_runtime_role(conn)


class _FakeConn:
    def __init__(self, rolsuper: bool, rolbypassrls: bool, owned: int) -> None:
        self._rows = [(rolsuper, rolbypassrls), owned]

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
    ("rolsuper", "rolbypassrls", "owned", "reason"),
    [(True, False, 0, "superuser"), (False, True, 0, "BYPASSRLS"), (False, False, 2, "owns")],
)
def test_each_unsafe_condition_is_refused_without_leaking_secrets(
    rolsuper, rolbypassrls, owned, reason
):
    with pytest.raises(UnsafeRuntimeRoleError, match=reason) as excinfo:
        check_runtime_role(_FakeConn(rolsuper, rolbypassrls, owned))
    assert "postgres" not in str(excinfo.value)


def test_safe_role_passes():
    check_runtime_role(_FakeConn(False, False, 0))
