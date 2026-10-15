"""The static discovery universe: a committed CSV of stocks and ETFs, and the region of each.

The file is only the starting point. Companies found through research can enter the pipeline
too (Phase 5); this file just makes routine screening affordable.
"""

import csv
from dataclasses import dataclass
from pathlib import Path

UNIVERSE_PATH = Path(__file__).with_name("universe.csv")

COLUMNS = (
    "ticker",
    "name",
    "asset_type",
    "exchange",
    "country",
    "currency",
    "sector",
    "industry",
    "size_bucket",
    "notes",
)
ASSET_TYPES = frozenset({"STOCK", "ETF"})
SIZE_BUCKETS = frozenset({"micro", "small", "mid", "large", "unknown"})

# Region labels used by the coverage report. Targets, not quotas (plan section 6, Phase 3).
REGIONS = ("north_america", "europe", "asia_pacific", "other_emerging", "global_etf")

_NORTH_AMERICA = frozenset({"United States", "Canada"})
_EUROPE = frozenset(
    {
        "Austria",
        "Belgium",
        "Czech Republic",
        "Denmark",
        "Finland",
        "France",
        "Germany",
        "Greece",
        "Hungary",
        "Ireland",
        "Italy",
        "Luxembourg",
        "Netherlands",
        "Norway",
        "Poland",
        "Portugal",
        "Spain",
        "Sweden",
        "Switzerland",
        "United Kingdom",
    }
)
_ASIA_PACIFIC = frozenset(
    {
        "Australia",
        "China",
        "Hong Kong",
        "India",
        "Indonesia",
        "Japan",
        "Malaysia",
        "New Zealand",
        "Philippines",
        "Singapore",
        "South Korea",
        "Taiwan",
        "Thailand",
        "Vietnam",
    }
)
_OTHER_EMERGING = frozenset(
    {
        "Argentina",
        "Brazil",
        "Chile",
        "Colombia",
        "Egypt",
        "Israel",
        "Kuwait",
        "Mexico",
        "Peru",
        "Qatar",
        "Saudi Arabia",
        "South Africa",
        "Turkey",
        "United Arab Emirates",
    }
)


class UniverseFileError(ValueError):
    """The universe file is malformed. The message names the offending row or column."""


@dataclass(frozen=True)
class UniverseRow:
    ticker: str
    name: str
    asset_type: str
    exchange: str
    country: str
    currency: str
    sector: str
    industry: str
    size_bucket: str
    notes: str


def region_of(country: str, asset_type: str) -> str:
    """The reporting region of a security; ETFs are one global group whatever their domicile."""
    if asset_type == "ETF":
        return "global_etf"
    if country in _NORTH_AMERICA:
        return "north_america"
    if country in _EUROPE:
        return "europe"
    if country in _ASIA_PACIFIC:
        return "asia_pacific"
    if country in _OTHER_EMERGING:
        return "other_emerging"
    return "unknown"


def load_universe(path: Path = UNIVERSE_PATH) -> list[UniverseRow]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise UniverseFileError(f"columns must be exactly: {','.join(COLUMNS)}")
        rows: list[UniverseRow] = []
        seen: set[str] = set()
        for line_number, raw in enumerate(reader, start=2):
            row = UniverseRow(**{column: (raw[column] or "").strip() for column in COLUMNS})
            if not row.ticker:
                raise UniverseFileError(f"line {line_number}: ticker is empty")
            if row.ticker in seen:
                raise UniverseFileError(f"line {line_number}: duplicate ticker {row.ticker}")
            if row.asset_type not in ASSET_TYPES:
                raise UniverseFileError(
                    f"line {line_number}: asset_type {row.asset_type!r} is not STOCK or ETF"
                )
            if row.size_bucket not in SIZE_BUCKETS:
                raise UniverseFileError(
                    f"line {line_number}: size_bucket {row.size_bucket!r} is not one of "
                    f"{sorted(SIZE_BUCKETS)}"
                )
            seen.add(row.ticker)
            rows.append(row)
    return rows
