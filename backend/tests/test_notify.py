import asyncio
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest

import app.redis_client as redis_client_module
from app import notify
from app.models import Holding, Recommendation, TelegramLink, WatchlistItem
from app.redis_client import get_redis
from app.telegram import TelegramBlocked, TelegramBot, TelegramError, TelegramUncertain
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

MONDAY = datetime(2026, 10, 5, 6, 0, tzinfo=UTC)
FOOT = "Advisory only. Nothing is sent to a broker."


def test_build_message_full():
    text = notify.build_message(
        [("AAPL", "ADD"), ("MSFT", "HOLD")],
        [("NVDA", 5.44), ("AAPL", -6.21)],
        "https://app.example.com/",
    )
    assert text == (
        "2 new: AAPL ADD, MSFT HOLD\n"
        "Moved: AAPL -6.2%, NVDA +5.4%\n"
        "Open Today: https://app.example.com/today\n"
        "Advisory only. Nothing is sent to a broker."
    )


def test_build_message_parts_are_optional_and_nothing_means_none():
    assert notify.build_message([], [], "https://x") is None
    only_moves = notify.build_message([], [("AAPL", -7.0)], None)
    assert only_moves == "Moved: AAPL -7.0%\nAdvisory only. Nothing is sent to a broker."


def test_long_lists_are_cut():
    recs = [(f"T{i}", "ADD") for i in range(13)]
    text = notify.build_message(recs, [], None)
    assert text is not None
    assert text.splitlines()[0].endswith("+3 more") and "T9 ADD" in text and "T10 ADD" not in text


class FakeBot:
    def __init__(self, error=None):
        self.sent, self.error = [], error

    async def send_message(self, chat_id, text):
        if self.error:
            raise self.error
        self.sent.append((chat_id, text))


@pytest.fixture()
def env(session_local, app_session_local):
    with patch("app.db.SessionLocal", app_session_local), session_local() as owner:
        yield owner


def _arun(coro):
    try:
        return asyncio.run(coro)
    finally:
        redis_client_module._redis = None  # each asyncio.run is its own event loop


def _user(db, user_id=USER_ID, chat_id=1001, user_status="active", **link):
    add_app_user(db, user_id, status=user_status)
    db.add(TelegramLink(user_id=user_id, chat_id=chat_id, **link))
    db.commit()


def _hold(db, user_id, ticker):
    db.add(
        Holding(
            user_id=user_id,
            ticker=ticker,
            name=ticker,
            asset_type="STOCK",
            shares=5,
            cost_basis=100.0,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    db.commit()


def _rec(db, user_id, ticker, action="ADD", source="scheduled", status="PENDING", days_old=0):
    created = MONDAY.replace(tzinfo=None) - timedelta(days=days_old)
    db.add(
        Recommendation(
            user_id=user_id,
            ticker=ticker,
            asset_type="STOCK",
            action=action,
            reasoning=["x"],
            source=source,
            status=status,
            created_at=created,
        )
    )
    db.commit()


def _quotes(closes_by_ticker):
    async def fetch(ticker):
        closes = closes_by_ticker[ticker]  # an unknown ticker raises KeyError: a failing lookup
        return {"price": closes[-1] if closes else None, "closes": closes}

    return AsyncMock(side_effect=fetch)


def _notify(user_id=USER_ID, bot=None, quotes=None, now=MONDAY):
    bot = bot or FakeBot()
    with patch("app.notify.fetch_quote_and_history", quotes or _quotes({})):
        return _arun(notify.notify_user(user_id, now, bot)), bot


def _seed_day(db, user_id=USER_ID):
    _hold(db, user_id, "AAPL")
    _hold(db, user_id, "NVDA")
    _rec(db, user_id, "MSFT")  # today, scheduled, pending: listed
    _rec(db, user_id, "AAPL", days_old=3)  # an older day: not today's
    _rec(db, user_id, "NVDA", source="manual")  # manual: not listed
    _rec(db, user_id, "TSLA", status="APPROVED")  # decided: not listed


QUOTES = {"AAPL": [100.0, 94.0], "NVDA": [100.0, 101.0]}


def test_a_linked_user_gets_todays_scheduled_calls_and_the_big_movers(env):
    _user(env)
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert outcome == "sent"
    assert bot.sent == [(1001, f"1 new: MSFT ADD\nMoved: AAPL -6.0%\n{FOOT}")]


def test_digest_off_keeps_only_the_moves(env):
    _user(env, digest_enabled=False)
    _seed_day(env)
    _, bot = _notify(quotes=_quotes(QUOTES))
    assert bot.sent == [(1001, f"Moved: AAPL -6.0%\n{FOOT}")]


def test_moves_off_keeps_only_the_digest(env):
    _user(env, moves_enabled=False)
    _seed_day(env)
    _, bot = _notify(quotes=_quotes(QUOTES))
    assert bot.sent == [(1001, f"1 new: MSFT ADD\n{FOOT}")]


def test_nothing_to_say_sends_nothing_and_sets_no_marker(env):
    _user(env)
    _hold(env, USER_ID, "NVDA")
    outcome, bot = _notify(quotes=_quotes({"NVDA": [100.0, 101.0]}))
    assert (outcome, bot.sent) == ("skipped", [])
    assert _arun(get_redis().exists(f"telegram:sent:{USER_ID}:2026-10-05")) == 0


def test_a_second_run_the_same_day_sends_nothing(env):
    _user(env)
    _seed_day(env)
    first, bot = _notify(quotes=_quotes(QUOTES))
    second, _ = _notify(bot=bot, quotes=_quotes(QUOTES))
    assert (first, second, len(bot.sent)) == ("sent", "skipped", 1)


def test_a_failed_send_clears_the_marker_so_a_retry_can_send(env):
    _user(env)
    _seed_day(env)
    outcome, _ = _notify(bot=FakeBot(TelegramError("x")), quotes=_quotes(QUOTES))
    assert outcome == "failed"
    retry, bot = _notify(quotes=_quotes(QUOTES))
    assert (retry, len(bot.sent)) == ("sent", 1)


def test_a_blocked_chat_is_marked_blocked_and_not_tried_again(env):
    _user(env)
    _seed_day(env)
    outcome, _ = _notify(bot=FakeBot(TelegramBlocked("x")), quotes=_quotes(QUOTES))
    assert outcome == "blocked"
    env.expire_all()
    assert env.query(TelegramLink).one().status == "blocked"
    again, bot = _notify(quotes=_quotes(QUOTES))
    assert (again, bot.sent) == ("skipped", [])


def test_a_user_without_a_link_gets_nothing(env):
    add_app_user(env, USER_ID)
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_a_blocked_link_gets_nothing(env):
    _user(env, status="blocked")
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_a_disabled_user_gets_nothing(env):
    _user(env, user_status="disabled")
    _seed_day(env)
    outcome, bot = _notify(quotes=_quotes(QUOTES))
    assert (outcome, bot.sent) == ("skipped", [])


def test_failing_quotes_still_send_the_digest(env):
    _user(env)
    _seed_day(env)
    outcome, bot = _notify(quotes=AsyncMock(side_effect=RuntimeError("yahoo down")))
    assert (outcome, bot.sent) == ("sent", [(1001, f"1 new: MSFT ADD\n{FOOT}")])


def test_one_users_message_never_contains_another_users_tickers(env):
    _user(env, USER_ID, 1001)
    _user(env, OTHER_USER_ID, 1002)
    _rec(env, USER_ID, "MSFT")
    _rec(env, OTHER_USER_ID, "TSLA")
    _hold(env, OTHER_USER_ID, "NVDA")
    _, bot = _notify(USER_ID, quotes=_quotes({"NVDA": [100.0, 80.0]}))
    text = bot.sent[0][1]
    assert "MSFT" in text and "TSLA" not in text and "NVDA" not in text


def test_the_threshold_is_the_users_own(env):
    _user(env, USER_ID, 1001, move_threshold_pct=5.0)
    _user(env, OTHER_USER_ID, 1002, move_threshold_pct=10.0)
    for uid in (USER_ID, OTHER_USER_ID):
        _hold(env, uid, "AAPL")
    quotes = _quotes({"AAPL": [100.0, 94.0]})
    assert _notify(USER_ID, quotes=quotes)[0] == "sent"
    assert _notify(OTHER_USER_ID, quotes=quotes)[0] == "skipped"


@pytest.mark.parametrize("closes", [[], [100.0], [0.0, 5.0]])
def test_short_or_zero_history_is_ignored(env, closes):
    _user(env)
    _hold(env, USER_ID, "AAPL")
    outcome, _ = _notify(quotes=_quotes({"AAPL": closes}))
    assert outcome == "skipped"


def test_open_holdings_and_the_watchlist_are_both_checked_for_moves(env):
    _user(env)
    env.add(WatchlistItem(user_id=USER_ID, ticker="NVDA", asset_type="STOCK"))
    _hold(env, USER_ID, "AAPL")
    env.commit()
    _, bot = _notify(quotes=_quotes({"AAPL": [100.0, 94.0], "NVDA": [100.0, 70.0]}))
    assert bot.sent == [(1001, f"Moved: NVDA -30.0%, AAPL -6.0%\n{FOOT}")]


def test_a_closed_position_is_not_checked(env):
    _user(env)
    env.add(
        Holding(
            user_id=USER_ID,
            ticker="OLD",
            name="OLD",
            asset_type="STOCK",
            shares=0,
            cost_basis=100.0,
            first_purchase_date=date(2024, 1, 1),
        )
    )
    env.commit()
    outcome, _ = _notify(quotes=_quotes({"OLD": [100.0, 50.0]}))
    assert outcome == "skipped"


def test_an_uncertain_send_keeps_the_marker_so_a_rerun_cannot_send_twice(env):
    _user(env)
    _seed_day(env)
    outcome, _ = _notify(bot=FakeBot(TelegramUncertain("x")), quotes=_quotes(QUOTES))
    assert outcome == "failed"
    assert _arun(get_redis().exists(f"telegram:sent:{USER_ID}:2026-10-05")) == 1
    again, bot = _notify(quotes=_quotes(QUOTES))
    assert (again, bot.sent) == ("skipped", [])


def _real_bot(handler):
    return TelegramBot("123:tok", transport=httpx.MockTransport(handler))


def test_a_read_timeout_from_the_transport_keeps_the_marker(env):
    _user(env)
    _seed_day(env)

    def handler(request):
        raise httpx.ReadTimeout("slow")

    outcome, _ = _notify(bot=_real_bot(handler), quotes=_quotes(QUOTES))
    assert outcome == "failed"
    again, bot = _notify(quotes=_quotes(QUOTES))
    assert (again, bot.sent) == ("skipped", [])


@pytest.mark.parametrize("failure", [429, 500, "connect"])
def test_a_definite_failure_clears_the_marker_so_a_retry_sends(env, failure):
    _user(env)
    _seed_day(env)

    def handler(request):
        if failure == "connect":
            raise httpx.ConnectError("down")
        return httpx.Response(failure, json={})

    outcome, _ = _notify(bot=_real_bot(handler), quotes=_quotes(QUOTES))
    assert outcome == "failed"
    retry, bot = _notify(quotes=_quotes(QUOTES))
    assert (retry, len(bot.sent)) == ("sent", 1)


def test_a_move_of_exactly_the_threshold_is_included(env):
    _user(env, move_threshold_pct=5.0)
    _hold(env, USER_ID, "AAPL")
    outcome, bot = _notify(quotes=_quotes({"AAPL": [110.0, 104.5]}))
    assert (outcome, bot.sent) == ("sent", [(1001, f"Moved: AAPL -5.0%\n{FOOT}")])


def test_a_relink_during_the_send_keeps_the_new_chat_ok(env, session_local):
    _user(env)
    _seed_day(env)

    class RelinkingBot:
        async def send_message(self, chat_id, text):
            # The person connects a new chat after the chat id was read and before the failure.
            with session_local() as other:
                other.query(TelegramLink).filter_by(user_id=USER_ID).update({"chat_id": 2002})
                other.commit()
            raise TelegramBlocked("x")

    outcome, _ = _notify(bot=RelinkingBot(), quotes=_quotes(QUOTES))
    assert outcome == "blocked"
    env.expire_all()
    link = env.query(TelegramLink).one()
    assert (link.chat_id, link.status) == (2002, "ok")
