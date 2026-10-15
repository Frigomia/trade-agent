from pathlib import Path

import pytest

from app.discovery.universe import UniverseFileError, UniverseRow, load_universe, region_of

HEADER = "ticker,name,asset_type,exchange,country,currency,sector,industry,size_bucket,notes\n"


def write_csv(tmp_path: Path, body: str, header: str = HEADER) -> Path:
    path = tmp_path / "universe.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_load_universe_reads_every_column(tmp_path: Path) -> None:
    path = write_csv(
        tmp_path,
        "SAP.DE,SAP SE,STOCK,XETRA,Germany,EUR,Technology,Software - Application,large,\n",
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
        )
    ]


def test_load_universe_rejects_a_duplicate_ticker(tmp_path: Path) -> None:
    row = "SAP.DE,SAP SE,STOCK,XETRA,Germany,EUR,Technology,Software,large,\n"
    path = write_csv(tmp_path, row + row)

    with pytest.raises(UniverseFileError, match="SAP.DE"):
        load_universe(path)


def test_load_universe_rejects_an_unknown_asset_type(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "SAP.DE,SAP SE,BOND,XETRA,Germany,EUR,Technology,Software,large,\n")

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
