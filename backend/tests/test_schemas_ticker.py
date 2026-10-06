import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import Ticker

_ticker = TypeAdapter(Ticker)


@pytest.mark.parametrize(
    "value", ["AAPL", "BRK.B", "^GSPC", "SAP.DE", "EUNL.DE", "RDS-A", "a" * 20]
)
def test_valid_tickers(value):
    assert _ticker.validate_python(value) == value.upper()


@pytest.mark.parametrize("value", ["..", ".", "a..b", "-x", "", "a" * 21, "a/b", ".A", "A^B"])
def test_invalid_tickers(value):
    with pytest.raises(ValidationError):
        _ticker.validate_python(value)
