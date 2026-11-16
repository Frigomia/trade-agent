from pathlib import Path

import pytest

from app.discovery.universe import (
    UniverseFileError,
    UniverseRow,
    is_valid_isin,
    load_universe,
    region_of,
)

HEADER = (
    "ticker,name,asset_type,exchange,country,currency,sector,industry,size_bucket,notes,"
    "isin,ucits,ter,size_eur_m\n"
)


def write_csv(tmp_path: Path, body: str, header: str = HEADER) -> Path:
    path = tmp_path / "universe.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_load_universe_reads_every_column(tmp_path: Path) -> None:
    path = write_csv(
        tmp_path,
        "SAP.DE,SAP SE,STOCK,XETRA,Germany,EUR,Technology,Software - Application,large,,,no,,\n",
    )

    assert load_universe(path) == [
        UniverseRow(
            ticker="SAP.DE",
            name="SAP SE",
            asset_type="STOCK",
            exchange="XETRA",
            country="Germany",
            currency="EUR",
            sector="Technology",
            industry="Software - Application",
            size_bucket="large",
            notes="",
            isin="",
            ucits=False,
            ter=None,
            size_eur_m=None,
        )
    ]


ETF_PREFIX = "IWDA.AS,iShares Core MSCI World,ETF,Amsterdam,,EUR,,World Equity,unknown,"
BLANK_INDUSTRY = "IWDA.AS,iShares Core MSCI World,ETF,Amsterdam,,EUR,,,unknown,"
STOCK = "SAP.DE,SAP SE,STOCK,XETRA,Germany,EUR,Technology,Software,large,"


@pytest.mark.parametrize("isin", ["IE00B4L5Y983", "IE00B53SZB19", "IE00BKM4GZ66"])
def test_is_valid_isin_accepts_real_isins(isin: str) -> None:
    assert is_valid_isin(isin)


@pytest.mark.parametrize(
    "isin", ["IE00B4L5Y984", "IE00B4L5Y98", "", "1E00B4L5Y983", "ie00b4l5y983"]
)
def test_is_valid_isin_rejects_bad_check_digit_length_and_country(isin: str) -> None:
    assert not is_valid_isin(isin)


def test_load_universe_reads_an_ucits_etf_with_ter_and_size(tmp_path: Path) -> None:
    path = write_csv(tmp_path, f"{ETF_PREFIX},IE00B4L5Y983,yes,0.002,50000\n")

    (row,) = load_universe(path)

    assert (row.isin, row.ucits, row.ter, row.size_eur_m) == ("IE00B4L5Y983", True, 0.002, 50000.0)


@pytest.mark.parametrize(
    ("line", "message"),
    [
        (f"{ETF_PREFIX},US0378331005,yes,,", "line 2"),  # a US ISIN is not UCITS
        (f"{ETF_PREFIX},,yes,,", "line 2"),  # blank ISIN
        (f"{ETF_PREFIX},IE00B4L5Y984,yes,,", "line 2"),  # bad check digit
        (f"{STOCK},IE00B4L5Y983,yes,,", "line 2"),  # a stock cannot be UCITS
        (f"{BLANK_INDUSTRY},IE00B4L5Y983,yes,,", "industry"),  # a UCITS fund needs a category
        (f"{ETF_PREFIX},,,,", "ucits"),  # blank ucits is an error
        (f"{ETF_PREFIX},,maybe,,", "ucits"),
        (f"{ETF_PREFIX},,no,0,", "ter"),
        (f"{ETF_PREFIX},,no,0.06,", "ter"),
        (f"{ETF_PREFIX},,no,abc,", "ter"),
        (f"{ETF_PREFIX},,no,,0", "size_eur_m"),
        (f"{ETF_PREFIX},,no,,-5", "size_eur_m"),
    ],
)
def test_load_universe_rejects_bad_etf_cells(tmp_path: Path, line: str, message: str) -> None:
    path = write_csv(tmp_path, line + "\n")

    with pytest.raises(UniverseFileError, match=message):
        load_universe(path)


def test_load_universe_rejects_a_duplicate_ticker(tmp_path: Path) -> None:
    row = "SAP.DE,SAP SE,STOCK,XETRA,Germany,EUR,Technology,Software,large,,,no,,\n"
    path = write_csv(tmp_path, row + row)

    with pytest.raises(UniverseFileError, match="SAP.DE"):
        load_universe(path)


def test_load_universe_rejects_an_unknown_asset_type(tmp_path: Path) -> None:
    path = write_csv(
        tmp_path, "SAP.DE,SAP SE,BOND,XETRA,Germany,EUR,Technology,Software,large,,,no,,\n"
    )

    with pytest.raises(UniverseFileError, match="asset_type"):
        load_universe(path)


def test_load_universe_rejects_a_missing_column(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "SAP.DE,SAP SE\n", header="ticker,name\n")

    with pytest.raises(UniverseFileError, match="columns"):
        load_universe(path)


@pytest.mark.parametrize(
    ("country", "asset_type", "region"),
    [
        ("United States", "STOCK", "north_america"),
        ("Canada", "STOCK", "north_america"),
        ("Germany", "STOCK", "europe"),
        ("Switzerland", "STOCK", "europe"),
        ("Japan", "STOCK", "asia_pacific"),
        ("Australia", "STOCK", "asia_pacific"),
        ("India", "STOCK", "asia_pacific"),
        ("Brazil", "STOCK", "other_emerging"),
        ("South Africa", "STOCK", "other_emerging"),
        ("Germany", "ETF", "global_etf"),
        ("Atlantis", "STOCK", "unknown"),
    ],
)
def test_region_of_maps_a_country_to_a_region(country: str, asset_type: str, region: str) -> None:
    assert region_of(country, asset_type) == region
