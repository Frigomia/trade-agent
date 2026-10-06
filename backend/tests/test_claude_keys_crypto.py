import base64
import uuid

import pytest

from app.claude_keys import KeyEncryptionError, check_master_secret, decrypt_key, encrypt_key
from app.config import settings

USER = uuid.UUID("00000000-0000-0000-0000-000000000001")
OTHER = uuid.UUID("00000000-0000-0000-0000-000000000002")
KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"
GOOD_SECRET = base64.b64encode(bytes(range(32))).decode()


def test_round_trip():
    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY


def test_the_ciphertext_does_not_contain_the_key():
    blob = encrypt_key(USER, KEY)

    assert KEY.encode() not in blob
    assert b"sk-ant" not in blob


def test_every_save_uses_a_new_nonce():
    assert encrypt_key(USER, KEY) != encrypt_key(USER, KEY)


def test_another_users_id_cannot_decrypt_it():
    blob = encrypt_key(USER, KEY)

    with pytest.raises(KeyEncryptionError):
        decrypt_key(OTHER, blob)


def test_a_tampered_ciphertext_fails():
    blob = bytearray(encrypt_key(USER, KEY))
    blob[-1] ^= 1

    with pytest.raises(KeyEncryptionError):
        decrypt_key(USER, bytes(blob))


def test_a_failure_message_carries_no_key_material():
    blob = bytearray(encrypt_key(USER, KEY))
    blob[-1] ^= 1

    with pytest.raises(KeyEncryptionError) as excinfo:
        decrypt_key(USER, bytes(blob))

    assert KEY not in str(excinfo.value)
    assert excinfo.value.__cause__ is None


def test_a_different_master_secret_cannot_decrypt(monkeypatch):
    blob = encrypt_key(USER, KEY)
    monkeypatch.setattr(settings, "key_encryption_secret", GOOD_SECRET)

    with pytest.raises(KeyEncryptionError):
        decrypt_key(USER, blob)


def test_development_works_without_any_configuration(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "key_encryption_secret", None)

    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY


def test_production_without_a_secret_refuses_to_encrypt_and_to_start(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", None)

    with pytest.raises(KeyEncryptionError, match="KEY_ENCRYPTION_SECRET"):
        encrypt_key(USER, KEY)
    with pytest.raises(KeyEncryptionError, match="KEY_ENCRYPTION_SECRET"):
        check_master_secret()


@pytest.mark.parametrize(
    "secret",
    ["not base64 !!!", base64.b64encode(b"too short").decode()],
    ids=["not-base64", "wrong-length"],
)
def test_production_rejects_a_malformed_secret_without_printing_it(monkeypatch, secret):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", secret)

    with pytest.raises(KeyEncryptionError) as excinfo:
        check_master_secret()

    assert secret not in str(excinfo.value)


def test_production_accepts_a_valid_secret(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "key_encryption_secret", GOOD_SECRET)

    check_master_secret()
    assert decrypt_key(USER, encrypt_key(USER, KEY)) == KEY
