from unittest.mock import patch

import pytest

from app import claude_keys
from app.claude_keys import ClaudeKeyRequired, encrypt_key, mark_needs_attention, resolve_client
from app.config import settings
from app.models import AppUser, UserApiKey
from tests.auth_support import USER_ID, add_app_user

KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"


def _give_key(db, user_id=USER_ID, status="ok"):
    db.add(
        UserApiKey(
            user_id=user_id,
            ciphertext=encrypt_key(user_id, KEY),
            key_version=1,
            last4=KEY[-4:],
            status=status,
        )
    )
    db.commit()


def test_a_user_with_a_key_gets_a_client_built_from_it(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic") as constructor:
        client = resolve_client(db_session, USER_ID, "user")

    constructor.assert_called_once_with(api_key=KEY)
    assert client is constructor.return_value


def test_a_user_without_a_key_must_connect_one(db_session):
    add_app_user(db_session, USER_ID, role="user")

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, "user")

    assert excinfo.value.needs_attention is False


def test_a_user_never_falls_back_to_the_server_key(db_session, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-the-servers-own-key")
    add_app_user(db_session, USER_ID, role="user")

    with pytest.raises(ClaudeKeyRequired):
        resolve_client(db_session, USER_ID, "user")


def test_an_admin_without_a_personal_key_uses_the_server_key(db_session):
    add_app_user(db_session, USER_ID, role="admin")

    assert resolve_client(db_session, USER_ID, "admin") is None  # None: the server's own client


def test_an_admins_personal_key_takes_precedence(db_session):
    add_app_user(db_session, USER_ID, role="admin")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic") as constructor:
        client = resolve_client(db_session, USER_ID, "admin")

    assert client is constructor.return_value


@pytest.mark.parametrize("role", ["user", "admin"])
def test_a_flagged_key_asks_for_a_reconnect_and_never_falls_back(db_session, role):
    add_app_user(db_session, USER_ID, role=role)
    _give_key(db_session, status="needs_attention")

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, role)

    assert excinfo.value.needs_attention is True


def test_a_key_that_cannot_be_decrypted_asks_for_a_reconnect(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)
    db_session.query(UserApiKey).update({"ciphertext": b"not a real ciphertext at all......"})
    db_session.commit()

    with pytest.raises(ClaudeKeyRequired) as excinfo:
        resolve_client(db_session, USER_ID, "user")

    assert excinfo.value.needs_attention is True


def test_mark_needs_attention_flips_the_row_and_the_admin_visible_state(
    db_session, app_session_local
):
    add_app_user(db_session, USER_ID, role="user")
    db_session.query(AppUser).update({"claude_key_state": "ok"})
    _give_key(db_session)

    with patch("app.db.SessionLocal", app_session_local):
        mark_needs_attention(USER_ID)

    db_session.expire_all()
    assert db_session.query(UserApiKey).one().status == "needs_attention"
    assert db_session.get(AppUser, USER_ID).claude_key_state == "needs_attention"


def test_mark_needs_attention_is_harmless_without_a_key(db_session, app_session_local):
    add_app_user(db_session, USER_ID, role="user")

    with patch("app.db.SessionLocal", app_session_local):
        mark_needs_attention(USER_ID)

    assert db_session.get(AppUser, USER_ID).claude_key_state == "none"


def test_the_decrypted_key_is_not_kept_in_a_module_global(db_session):
    add_app_user(db_session, USER_ID, role="user")
    _give_key(db_session)

    with patch("app.claude_keys.Anthropic"):
        resolve_client(db_session, USER_ID, "user")

    for name, value in vars(claude_keys).items():
        assert not (isinstance(value, str) and KEY in value), name
        assert not (isinstance(value, bytes) and KEY.encode() in value), name


def test_the_error_message_is_fixed_text():
    assert "Connect Claude" in str(ClaudeKeyRequired())
    assert "reconnect" in str(ClaudeKeyRequired(needs_attention=True)).lower()
