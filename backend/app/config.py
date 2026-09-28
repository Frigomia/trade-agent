from uuid import UUID

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
    default_user_id: UUID = UUID("00000000-0000-0000-0000-000000000001")

    max_single_position_pct: float = 0.15
    rsi_oversold: float = 30.0
    fundamental_buy_threshold: float = 60.0


settings = Settings()
