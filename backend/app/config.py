from uuid import UUID

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./trading_agent.db"
    redis_url: str = "redis://localhost:6379/0"
    default_user_id: UUID = UUID("00000000-0000-0000-0000-000000000001")

    max_single_position_pct: float = 0.15
    rsi_oversold: float = 30.0
    fundamental_buy_threshold: float = 60.0


settings = Settings()
