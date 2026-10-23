"""The backend type, shared catalog, and committed universe must agree."""

from app.analysis.portfolio import _sector
from app.discovery.universe import load_universe
from app.sectors import SECTOR_CATALOG, SECTOR_NAMES


def test_sector_type_matches_shared_catalog_and_covers_universe() -> None:
    assert set(SECTOR_NAMES) == set(SECTOR_CATALOG)
    assert len(SECTOR_NAMES) == 11
    assert {row.sector for row in load_universe() if row.sector} <= set(SECTOR_NAMES)


def test_mock_aliases_and_unknown_sector_fallback() -> None:
    assert _sector("Software") == "Technology"
    assert _sector("Health Care") == "Healthcare"
    assert _sector(" Consumer   Staples ") == "Consumer Defensive"
    assert _sector("New provider sector") == "New provider sector"
    assert _sector(None) == "Unclassified"
