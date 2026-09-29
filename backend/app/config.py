from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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

    default_monthly_analysis_limit: int = 100
    default_monthly_chat_limit: int = 500

    max_single_position_pct: float = 0.15
    rsi_oversold: float = 30.0
    fundamental_buy_threshold: float = 60.0


settings = Settings()
