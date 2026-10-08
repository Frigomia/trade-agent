import pytest

from app.isin import is_valid_isin


@pytest.mark.parametrize(
    "isin", ["US0378331005", "IE00BKM4GZ66", "IE00B4L5Y983", "US5949181045", "IE00B53SZB19"]
)
def test_real_isins_pass(isin):
    assert is_valid_isin(isin)


@pytest.mark.parametrize(
    "isin",
    [
        "US0378331006",
        "IE00BKM4GZ65",
        "us0378331005",
        "US037833100",
        "US03783310055",
        "1E00BKM4GZ66",
        "",
    ],
)
def test_bad_isins_fail(isin):
    assert not is_valid_isin(isin)
