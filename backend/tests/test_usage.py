import asyncio
import uuid

import pytest

from app.auth.deps import CurrentUser
from app.config import Settings
from app.usage import (
    UsageLimitExceeded,
    _usage_key,
    check_and_increment_usage,
    effective_limit,
    get_usage,
)


def test_check_and_increment_usage_allows_up_to_the_limit():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        for _ in range(3):
            await check_and_increment_usage("test_kind", user_id, limit=3)

    asyncio.run(_run())  # no exception


def test_check_and_increment_usage_raises_on_the_call_past_the_limit():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        for _ in range(3):
            await check_and_increment_usage("test_kind", user_id, limit=3)
        with pytest.raises(UsageLimitExceeded) as exc_info:
            await check_and_increment_usage("test_kind", user_id, limit=3)
        assert exc_info.value.kind == "test_kind"
        assert exc_info.value.limit == 3

    asyncio.run(_run())


def test_check_and_increment_usage_rejects_even_the_first_call_when_limit_is_zero():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        with pytest.raises(UsageLimitExceeded):
            await check_and_increment_usage("test_kind", user_id, limit=0)

    asyncio.run(_run())


def test_check_and_increment_usage_does_not_inflate_the_counter_on_rejection():
    user_id = str(uuid.uuid4())

    async def _run() -> None:
        for _ in range(3):
            await check_and_increment_usage("test_kind", user_id, limit=3)
        # Two more rejected attempts must not push the counter past 3.
        for _ in range(2):
            with pytest.raises(UsageLimitExceeded):
                await check_and_increment_usage("test_kind", user_id, limit=3)
        assert await get_usage("test_kind", user_id) == 3
        # Raising the limit by 1 must now unblock the very next call.
        await check_and_increment_usage("test_kind", user_id, limit=4)

    asyncio.run(_run())


def test_get_usage_reads_without_incrementing():
    user_id = str(uuid.uuid4())

    async def _run() -> int:
        await check_and_increment_usage("test_kind", user_id, limit=10)
        await check_and_increment_usage("test_kind", user_id, limit=10)
        return await get_usage("test_kind", user_id)

    assert asyncio.run(_run()) == 2


def test_get_usage_is_zero_for_a_user_with_no_calls_yet():
    assert asyncio.run(get_usage("test_kind", str(uuid.uuid4()))) == 0


def test_usage_key_is_scoped_to_the_calendar_month():
    key = _usage_key("chat", "user-1")
    prefix, kind, user_id, year_month = key.split(":")
    assert (prefix, kind, user_id) == ("usage", "chat", "user-1")
    assert len(year_month) == 7  # "YYYY-MM"


def _current_user(*, monthly_analysis_limit=None, monthly_chat_limit=None) -> CurrentUser:
    return CurrentUser(
        id=uuid.uuid4(),
        email="u@example.com",
        role="user",
        monthly_analysis_limit=monthly_analysis_limit,
        monthly_chat_limit=monthly_chat_limit,
    )


def test_effective_limit_uses_the_override_when_set():
    user = _current_user(monthly_analysis_limit=7)
    test_settings = Settings(default_monthly_analysis_limit=100, default_monthly_chat_limit=500)
    assert effective_limit(user, "analysis_run", test_settings) == 7


def test_effective_limit_falls_back_to_the_default_when_not_set():
    user = _current_user()
    test_settings = Settings(default_monthly_analysis_limit=100, default_monthly_chat_limit=500)
    assert effective_limit(user, "chat", test_settings) == 500


def test_effective_limit_rejects_an_unknown_kind():
    user = _current_user()
    with pytest.raises(ValueError, match="Unknown usage kind"):
        effective_limit(user, "not_a_kind", Settings())
