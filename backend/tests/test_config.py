import pytest

from app.config import InsecureConfigError, Settings

SECURE_DB = "postgresql+psycopg://u:secretpw@db.example.com:5432/app?sslmode=require"
SECURE_REDIS = "rediss://default:redispw@redis.example.com:6379"


def _settings(**overrides):
    # _env_file=None keeps a developer's local .env out of the test.
    return Settings(_env_file=None, **overrides)


def test_development_accepts_plain_local_urls():
    settings = _settings(
        app_env="development",
        database_url="postgresql+psycopg://u:p@localhost:5432/app",
        redis_url="redis://localhost:6379/0",
    )
    assert settings.app_env == "development"


def test_production_accepts_tls_urls():
    settings = _settings(
        app_env="production",
        database_url=SECURE_DB,
        migration_database_url=SECURE_DB.replace("secretpw", "ownerpw"),
        redis_url=SECURE_REDIS,
    )
    assert settings.app_env == "production"


@pytest.mark.parametrize("mode", ["require", "verify-ca", "verify-full"])
def test_production_accepts_every_strict_sslmode(mode):
    _settings(
        app_env="production",
        database_url=f"postgresql+psycopg://u:p@h/app?sslmode={mode}",
        redis_url=SECURE_REDIS,
    )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://u:secretpw@h/app",
        "postgresql+psycopg://u:secretpw@h/app?sslmode=disable",
        "postgresql+psycopg://u:secretpw@h/app?sslmode=prefer",
    ],
)
def test_production_rejects_a_database_url_without_tls(database_url):
    with pytest.raises(InsecureConfigError, match="DATABASE_URL"):
        _settings(app_env="production", database_url=database_url, redis_url=SECURE_REDIS)


def test_production_rejects_an_insecure_migration_url():
    with pytest.raises(InsecureConfigError, match="MIGRATION_DATABASE_URL"):
        _settings(
            app_env="production",
            database_url=SECURE_DB,
            migration_database_url="postgresql+psycopg://owner:ownerpw@h/app",
            redis_url=SECURE_REDIS,
        )


def test_production_rejects_a_plain_redis_url():
    with pytest.raises(InsecureConfigError, match="REDIS_URL"):
        _settings(
            app_env="production", database_url=SECURE_DB, redis_url="redis://r:redispw@h:6379"
        )


def test_the_error_never_contains_a_url_or_password():
    with pytest.raises(InsecureConfigError) as caught:
        _settings(
            app_env="production",
            database_url="postgresql+psycopg://u:secretpw@h/app",
            redis_url="redis://default:redispw@h:6379",
        )

    text = str(caught.value)
    assert "secretpw" not in text and "redispw" not in text
    assert "postgresql" not in text and "redis://" not in text
