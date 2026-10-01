from urllib.parse import parse_qs, urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_STRICT_SSLMODES = {"require", "verify-ca", "verify-full"}


class InsecureConfigError(RuntimeError):
    """Production settings that would send data over an unencrypted connection. Deliberately not a
    ValueError: pydantic would wrap that in a ValidationError whose text echoes the input values,
    and these values are connection strings with passwords in them."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"  # "production" turns on the TLS requirements below
    database_url: str = (
        "postgresql+psycopg://trading_agent:trading_agent@localhost:5432/trading_agent"
    )
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"
    voyage_api_key: str | None = None
    supabase_url: str | None = None  # https://<project>.supabase.co; JWKS + issuer derive from it
    migration_database_url: str | None = None  # owner role: Alembic and the bootstrap command only
    supabase_secret_key: str | None = None  # backend-only secret for Supabase Auth admin calls
    invite_redirect_url: str | None = None  # where the emailed invitation link lands (frontend)
    invite_link_hours: int = 24  # display hint only; Supabase enforces the real link expiry
    cors_allowed_origins: str = "http://localhost:3000"  # comma-separated frontend origin(s)

    default_monthly_analysis_limit: int = 100
    default_monthly_chat_limit: int = 500

    max_single_position_pct: float = 0.15
    rsi_oversold: float = 30.0
    fundamental_buy_threshold: float = 60.0

    @model_validator(mode="after")
    def _require_tls_in_production(self) -> "Settings":
        if self.app_env != "production":
            return self
        problems: list[str] = []
        for name, url in (
            ("DATABASE_URL", self.database_url),
            ("MIGRATION_DATABASE_URL", self.migration_database_url),
        ):
            if url is None:
                continue  # migration_database_url is optional
            sslmode = parse_qs(urlparse(url).query).get("sslmode", [""])[0]
            if sslmode not in _STRICT_SSLMODES:
                problems.append(f"{name} must set sslmode=require (or verify-ca / verify-full)")
        if not self.redis_url.startswith("rediss://"):
            problems.append("REDIS_URL must use rediss:// (TLS)")
        if problems:
            raise InsecureConfigError("APP_ENV=production but: " + "; ".join(problems))
        return self


settings = Settings()
