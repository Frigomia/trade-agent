import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Date, DateTime, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("user_id", "ticker", name="uq_holdings_user_ticker"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    asset_type: Mapped[str] = mapped_column(String(10))  # "ETF" | "STOCK"
    shares: Mapped[float] = mapped_column(Numeric(18, 6))
    cost_basis: Mapped[float] = mapped_column(Numeric(18, 6))
    first_purchase_date: Mapped[date] = mapped_column(Date)
    target_weight: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(100), nullable=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "ticker", name="uq_watchlist_user_ticker"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10))
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    date: Mapped[date] = mapped_column(Date)
    ticker: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(4))  # "BUY" | "SELL"
    shares: Mapped[float] = mapped_column(Numeric(18, 6))
    price: Mapped[float] = mapped_column(Numeric(18, 6))


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ticker: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10))
    action: Mapped[str] = mapped_column(String(6))  # BUY|ADD|HOLD|TRIM|SELL|WATCH
    reasoning: Mapped[list[str]] = mapped_column(JSON)
    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_position_pct: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="PENDING")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    price_at_recommendation: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    outcome_forward_return_pct: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    outcome_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1024), nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    session_id: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(10))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)


class BacktestResult(Base):
    __tablename__ = "backtest_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ticker: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    final_value: Mapped[float] = mapped_column(Numeric(18, 2))
    buy_and_hold_value: Mapped[float] = mapped_column(Numeric(18, 2))
    excess_return_pct: Mapped[float] = mapped_column(Numeric(8, 4))
    hit_rate_by_signal: Mapped[dict[str, dict[str, float]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10))  # "DONE" -- only successful runs persist a row
