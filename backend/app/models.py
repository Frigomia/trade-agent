import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import expression

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
    # PENDING | APPROVED | REJECTED | SUPERSEDED (a newer run replaced an unreviewed one; exactly
    # 10 characters, so it fits String(10))
    status: Mapped[str] = mapped_column(String(10), default="PENDING")
    # "manual" (Run analysis) | "scheduled" (the weekday job); shown as an Automatic tag on Today.
    source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    price_at_recommendation: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    fundamental_score: Mapped[int | None] = mapped_column(nullable=True)
    technical_signal: Mapped[str | None] = mapped_column(String(20), nullable=True)
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
    # {"strategy": [...], "buy_and_hold": [...]}, <= 250 points each; NULL for older runs
    equity_curve: Mapped[dict[str, list[float]] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(10))  # "DONE" -- only successful runs persist a row


class InvestmentPreferences(Base):
    __tablename__ = "investment_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    risk_tolerance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sector_avoid_list: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Opt-in weekday analysis (see app/scheduled.py); off until the user turns it on.
    auto_analysis: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=expression.false()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class UserApiKey(Base):
    """A user's own Claude API key, encrypted by the application (see app.claude_keys). The
    plaintext never reaches this table; `last4` is the only readable part."""

    __tablename__ = "user_api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, index=True)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[int] = mapped_column(default=1)
    last4: Mapped[str] = mapped_column(String(4))
    status: Mapped[str] = mapped_column(String(20), default="ok")  # "ok" | "needs_attention"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    total_market_value: Mapped[float] = mapped_column(Numeric(18, 2))
    total_cost_basis: Mapped[float] = mapped_column(Numeric(18, 2))


class AppUser(Base):
    """Who may use the service, and as what. Read on every request by the auth path.

    Deliberately has no user_id column and no RLS policy: it is never joined to
    user-data tables, and only the auth path and (later) the admin API touch it.
    """

    __tablename__ = "app_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)  # equals the Supabase auth uid
    email: Mapped[str] = mapped_column(String(320), unique=True)
    role: Mapped[str] = mapped_column(String(10))  # "admin" | "user"
    # "invited" | "active" | "disabled"
    status: Mapped[str] = mapped_column(String(10), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    accepted_terms_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # NULL means "use Settings.default_monthly_*_limit". Set only by the admin API.
    monthly_analysis_limit: Mapped[int | None] = mapped_column(nullable=True)
    monthly_chat_limit: Mapped[int | None] = mapped_column(nullable=True)
    # Mirrors user_api_keys (which the admin cannot read: it is row-level secured): "none" | "ok"
    # | "needs_attention". Written in the same transaction as every change to the key row.
    claude_key_state: Mapped[str] = mapped_column(String(20), default="none", server_default="none")


class AppSettings(Base):
    """System-wide settings an admin can change, kept as exactly one row (id = 1).

    A NULL default means "use the matching Settings.default_monthly_*_limit from the environment".
    Like app_users it has no user_id and no RLS policy: only the admin API writes it, and the
    limit checks read it.
    """

    __tablename__ = "app_settings"
    __table_args__ = (CheckConstraint("id = 1", name="app_settings_single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False, default=1)
    default_monthly_analysis_limit: Mapped[int | None] = mapped_column(nullable=True)
    default_monthly_chat_limit: Mapped[int | None] = mapped_column(nullable=True)
