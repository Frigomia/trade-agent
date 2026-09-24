import asyncio
from unittest.mock import AsyncMock, patch

from app.memory.outcomes import compute_outcome


def test_compute_outcome_calculates_forward_return():
    with patch(
        "app.memory.outcomes.fetch_quote_and_history",
        AsyncMock(return_value={"price": 165.0, "closes": [165.0]}),
    ):
        result = asyncio.run(compute_outcome("AAPL", 150.0))

    assert result == (165.0 - 150.0) / 150.0
