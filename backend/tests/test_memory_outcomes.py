import asyncio
from datetime import date
from unittest.mock import AsyncMock, patch

from app.memory.outcomes import compute_outcome


def test_compute_outcome_calculates_forward_return():
    with patch(
        "app.memory.outcomes.fetch_price_history",
        AsyncMock(return_value=[160.0, 162.0, 165.0]),
    ):
        result = asyncio.run(compute_outcome("AAPL", 150.0, date(2024, 1, 1), lookback_days=20))

    assert result == (165.0 - 150.0) / 150.0
