"""Helpers for minting test JWTs and creating app users. Test-only."""

import time
import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.orm import Session

from app.auth.supabase_admin import SupabaseAdminError, SupabaseUserExists
from app.db import Base
from app.models import (
    AppUser,
    BacktestResult,
    ChatMessage,
    Holding,
    InvestmentPreferences,
    PortfolioSnapshot,
    Recommendation,
    TelegramLink,
    Trade,
    UserApiKey,
    WatchlistItem,
)

TEST_SUPABASE_URL = "https://test-project.supabase.co"
TEST_ISSUER = f"{TEST_SUPABASE_URL}/auth/v1"

USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
OTHER_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
ADMIN_ID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
PUBLIC_KEY = _PRIVATE_KEY.public_key()
OTHER_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def make_token(
    sub: str | uuid.UUID = USER_ID,
    *,
    expires_in: int = 3600,
    audience: str = "authenticated",
    issuer: str = TEST_ISSUER,
    key: Any = None,
    algorithm: str = "ES256",
    email: str = "user@example.com",
    drop_claims: tuple[str, ...] = (),
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(sub),
        "aud": audience,
        "iss": issuer,
        "iat": now,
        "exp": now + expires_in,
        "email": email,
    }
    for name in drop_claims:
        claims.pop(name, None)
    return jwt.encode(claims, key or _PRIVATE_KEY, algorithm=algorithm, headers={"kid": "test-key"})


def auth_headers(sub: str | uuid.UUID = USER_ID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub)}"}


def resolve_test_key(token: str) -> Any:
    """Stand-in for the JWKS lookup: always returns the test public key."""
    return PUBLIC_KEY


def add_app_user(
    session: Session,
    user_id: uuid.UUID = USER_ID,
    *,
    role: str = "user",
    status: str = "active",
    email: str | None = None,
    invited_at: datetime | None = None,
    monthly_analysis_limit: int | None = None,
    monthly_chat_limit: int | None = None,
) -> AppUser:
    user = AppUser(
        id=user_id,
        email=email or f"{user_id}@example.com",
        role=role,
        status=status,
        invited_at=invited_at,
        monthly_analysis_limit=monthly_analysis_limit,
        monthly_chat_limit=monthly_chat_limit,
    )
    session.add(user)
    session.commit()
    return user


ROW_FACTORIES: dict[str, Callable[[uuid.UUID], Base]] = {
    "holdings": lambda uid: Holding(
        user_id=uid,
        ticker="AAPL",
        name="Apple",
        asset_type="STOCK",
        shares=1,
        cost_basis=1,
        first_purchase_date=date(2024, 1, 1),
    ),
    "watchlist_items": lambda uid: WatchlistItem(user_id=uid, ticker="AAPL", asset_type="STOCK"),
    "trades": lambda uid: Trade(
        user_id=uid, date=date(2024, 1, 1), ticker="AAPL", action="BUY", shares=1, price=1
    ),
    "recommendations": lambda uid: Recommendation(
        user_id=uid, ticker="AAPL", asset_type="STOCK", action="BUY", reasoning=["x"]
    ),
    "chat_messages": lambda uid: ChatMessage(
        user_id=uid, session_id="s", role="user", content="hi"
    ),
    "backtest_results": lambda uid: BacktestResult(
        user_id=uid,
        ticker="AAPL",
        start_date=date(2020, 1, 1),
        end_date=date(2024, 1, 1),
        final_value=1,
        buy_and_hold_value=1,
        excess_return_pct=0,
        hit_rate_by_signal={},
        status="DONE",
    ),
    "investment_preferences": lambda uid: InvestmentPreferences(user_id=uid, sector_avoid_list=[]),
    "portfolio_snapshots": lambda uid: PortfolioSnapshot(
        user_id=uid, total_market_value=1, total_cost_basis=1
    ),
    "telegram_links": lambda uid: TelegramLink(user_id=uid, chat_id=uid.int % 10**12 + 1),
    "user_api_keys": lambda uid: UserApiKey(
        user_id=uid, ciphertext=b"x" * 40, key_version=1, last4="abcd", status="ok"
    ),
}


class FakeSupabaseAdmin:
    """Stands in for SupabaseAdmin in API tests: records calls and can be told to fail."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.fail_on: set[str] = set()  # method names that should raise SupabaseAdminError
        self.existing_emails: set[str] = set()  # invite raises SupabaseUserExists for these
        self.next_id: uuid.UUID | None = None  # the id the next new invite returns
        self.ids_by_email: dict[str, uuid.UUID] = {}

    def _maybe_fail(self, name: str) -> None:
        if name in self.fail_on:
            raise SupabaseAdminError(f"{name} failed")

    def invite(self, email: str, redirect_to: str | None) -> uuid.UUID:
        self.calls.append(("invite", email))
        self._maybe_fail("invite")
        if email in self.existing_emails:
            raise SupabaseUserExists("email_exists")
        if email not in self.ids_by_email:
            self.ids_by_email[email] = self.next_id or uuid.uuid4()
        return self.ids_by_email[email]

    def ban(self, user_id: uuid.UUID) -> None:
        self.calls.append(("ban", user_id))
        self._maybe_fail("ban")

    def unban(self, user_id: uuid.UUID) -> None:
        self.calls.append(("unban", user_id))
        self._maybe_fail("unban")

    def delete(self, user_id: uuid.UUID) -> None:
        self.calls.append(("delete", user_id))
        self._maybe_fail("delete")
