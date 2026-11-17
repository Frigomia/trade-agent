"""Invariants of the committed universe file. Offline: no network."""

from collections import Counter

from app.discovery.etf import ETF_MAX_EXPENSE_RATIO
from app.discovery.universe import etf_category_for, load_universe, region_of
from app.discovery.validate_universe import REGION_TARGETS
from app.fx import SUPPORTED


def test_the_committed_universe_loads_and_has_no_duplicate_tickers() -> None:
    rows = load_universe()

    assert len(rows) == len({row.ticker for row in rows})


def test_every_region_is_close_to_its_target() -> None:
    rows = load_universe()
    counts = Counter(region_of(row.country, row.asset_type) for row in rows)

    # Targets, not quotas: allow a tenth either way (plan section 6, Phase 3).
    for region, target in REGION_TARGETS.items():
        if region == "global_etf":
            continue  # about 100 to 150 UCITS funds, grown in batches: checked below
        assert abs(counts[region] - target) <= target * 0.1, (region, counts[region], target)
    assert counts["unknown"] == 0


def test_the_etf_lane_has_a_first_batch_of_ucits_funds_with_unique_isins() -> None:
    funds = [row for row in load_universe() if row.ucits]

    assert len(funds) >= 20
    assert len({row.isin for row in funds}) == len(funds)
    assert all(row.asset_type == "ETF" and row.isin for row in funds)


def test_every_etf_in_the_committed_file_is_a_ucits_fund() -> None:
    # US-listed funds cannot be bought by an EU retail investor: keep them out of the file.
    etfs = [row for row in load_universe() if row.asset_type == "ETF"]
    assert [row.ticker for row in etfs if not row.ucits] == []


def test_every_listed_fund_cost_can_pass_the_etf_cost_filter() -> None:
    # The file's TER beats Yahoo's, so a fund above the limit could never be recommended.
    funds = [r for r in load_universe() if r.ter is not None]
    assert [r.ticker for r in funds if r.ter > ETF_MAX_EXPENSE_RATIO] == []


def test_every_currency_in_the_file_can_be_converted_to_eur() -> None:
    unsupported = {row.currency for row in load_universe()} - SUPPORTED

    assert unsupported == set()


def test_the_universe_is_not_only_large_caps() -> None:
    stocks = [row for row in load_universe() if row.asset_type == "STOCK"]
    sizes = Counter(row.size_bucket for row in stocks)

    small_or_less = sizes["micro"] + sizes["small"]
    assert small_or_less / len(stocks) >= 0.15
    assert sizes["large"] / len(stocks) <= 0.55


def test_a_sector_fund_carries_a_sector_the_stock_rows_use_and_a_broad_fund_none() -> None:
    rows = {row.ticker: row for row in load_universe()}
    stock_sectors = {row.sector for row in rows.values() if row.asset_type == "STOCK"}
    fund_sectors = {row.sector for row in rows.values() if row.asset_type == "ETF" and row.sector}

    assert fund_sectors <= stock_sectors
    assert rows["QDVE.DE"].sector == "Technology" and rows["ISOE.AS"].sector == "Basic Materials"
    assert rows["IWDA.AS"].sector == "" and rows["SXR8.DE"].sector == ""


def test_every_ucits_sector_fund_has_a_stock_sector_so_avoided_sectors_apply() -> None:
    # Yahoo gives these funds no sector, so the row's is the only way an avoided sector skips one.
    rows = load_universe()
    stock_sectors = {row.sector for row in rows if row.asset_type == "STOCK" and row.sector}
    sector_funds = [row for row in rows if row.ucits and row.industry.startswith("Sector Equity")]

    assert sector_funds
    assert [row.ticker for row in sector_funds if row.sector not in stock_sectors] == []


def test_etf_category_for_reads_the_etf_row_industry_case_insensitively() -> None:
    assert etf_category_for("IS3N.DE") == "Global Emerging Markets Equity"
    assert etf_category_for("is3n.de") == "Global Emerging Markets Equity"


def test_etf_category_for_is_none_for_a_stock_or_an_unknown_ticker() -> None:
    assert etf_category_for("AAON") is None
    assert etf_category_for("NOPE.XX") is None


def test_etf_category_for_falls_back_to_the_isin_for_another_listing_of_a_universe_fund() -> None:
    # The owner's holdings are other listings (.SW, .L) of funds the file lists on XETRA/Amsterdam.
    assert etf_category_for("CSNDX.SW", "IE00B53SZB19") == "US Large-Cap Growth Equity"
    assert etf_category_for("EIMI.L", "IE00BKM4GZ66") == "Global Emerging Markets Equity"
    assert etf_category_for("IWDA.L", "IE00B4L5Y983") == "Global Large-Cap Blend Equity"


def test_etf_category_for_isin_match_ignores_case_and_whitespace() -> None:
    assert etf_category_for("EIMI.L", "  ie00bkm4gz66 ") == "Global Emerging Markets Equity"


def test_etf_category_for_ticker_match_wins_over_a_different_isin() -> None:
    assert etf_category_for("IS3N.DE", "IE00B53SZB19") == "Global Emerging Markets Equity"


def test_etf_category_for_is_none_for_an_unknown_ticker_with_an_unknown_or_missing_isin() -> None:
    assert etf_category_for("NOPE.XX", "IE0000000000") is None
    assert etf_category_for("NOPE.XX", None) is None
    assert etf_category_for("NOPE.XX", "") is None


def test_etf_category_for_never_matches_a_stock_rows_isin() -> None:
    stock_isins = [row.isin for row in load_universe() if row.asset_type == "STOCK" and row.isin]
    for isin in stock_isins[:5]:
        assert etf_category_for("NOPE.XX", isin) is None
