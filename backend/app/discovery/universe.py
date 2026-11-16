"""The static discovery universe: a committed CSV of stocks and ETFs, and the region of each.

The file is only the starting point. Companies found through research can enter the pipeline
too (Phase 5); this file just makes routine screening affordable.
"""

import csv
import math
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
    "isin",
    "ucits",
    "ter",
    "size_eur_m",
)
ASSET_TYPES = frozenset({"STOCK", "ETF"})
SIZE_BUCKETS = frozenset({"micro", "small", "mid", "large", "unknown"})
# A UCITS fund is domiciled in one of these; an ISIN with another prefix (US...) is not UCITS.
UCITS_ISIN_PREFIXES = frozenset({"IE", "LU", "DE", "FR", "NL"})
MAX_TER = 0.05  # 5% a year; anything above is a typo (a percent written as a fraction)

_COUNTRIES_BY_REGION = {
    "north_america": "United States, Canada",
    "europe": (
        "Austria, Belgium, Czech Republic, Denmark, Finland, France, Germany, Greece, Hungary, "
        "Ireland, Italy, Luxembourg, Netherlands, Norway, Poland, Portugal, Spain, Sweden, "
        "Switzerland, United Kingdom"
    ),
    "asia_pacific": (
        "Australia, China, Hong Kong, India, Indonesia, Japan, Malaysia, New Zealand, "
        "Philippines, Singapore, South Korea, Taiwan, Thailand, Vietnam"
    ),
    "other_emerging": (
        "Argentina, Brazil, Chile, Colombia, Egypt, Israel, Kuwait, Mexico, Peru, Qatar, "
        "Saudi Arabia, South Africa, Turkey, United Arab Emirates"
    ),
}
_REGION_BY_COUNTRY = {
    country: region
    for region, names in _COUNTRIES_BY_REGION.items()
    for country in names.split(", ")
}


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
    isin: str
    ucits: bool
    ter: float | None
    size_eur_m: float | None


def is_valid_isin(text: str) -> bool:
    """True for 12 characters: two country letters, nine letters or digits, a Luhn check digit."""
    if len(text) != 12 or not text.isascii():
        return False
    if not (text[:2].isalpha() and text[:2].isupper() and text[11].isdigit()):
        return False
    if not all(char.isdigit() or char.isupper() for char in text):
        return False
    # Letters become two digits (A=10 ... Z=35), then the usual Luhn sum over the whole string.
    digits = "".join(str(int(char, 36)) for char in text)
    total = 0
    for position, char in enumerate(reversed(digits)):
        value = int(char)
        if position % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9  # same as adding the two digits of the product
        total += value
    return total % 10 == 0


def _number_or_none(text: str, column: str, line_number: int) -> float | None:
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        raise UniverseFileError(f"line {line_number}: {column} {text!r} is not a number") from None
    if not math.isfinite(value):
        raise UniverseFileError(f"line {line_number}: {column} {text!r} is not a finite number")
    return value


def region_of(country: str, asset_type: str) -> str:
    """The reporting region of a security; ETFs are one global group whatever their domicile."""
    if asset_type == "ETF":
        return "global_etf"
    return _REGION_BY_COUNTRY.get(country, "unknown")


def load_universe(path: Path = UNIVERSE_PATH) -> list[UniverseRow]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise UniverseFileError(f"columns must be exactly: {','.join(COLUMNS)}")
        rows: list[UniverseRow] = []
        seen: set[str] = set()
        for line_number, raw in enumerate(reader, start=2):
            cells = {column: (raw[column] or "").strip() for column in COLUMNS}
            if cells["ucits"] not in ("yes", "no"):
                raise UniverseFileError(
                    f"line {line_number}: ucits {cells['ucits']!r} must be yes or no"
                )
            ter = _number_or_none(cells["ter"], "ter", line_number)
            size_eur_m = _number_or_none(cells["size_eur_m"], "size_eur_m", line_number)
            row = UniverseRow(
                ticker=cells["ticker"],
                name=cells["name"],
                asset_type=cells["asset_type"],
                exchange=cells["exchange"],
                country=cells["country"],
                currency=cells["currency"],
                sector=cells["sector"],
                industry=cells["industry"],
                size_bucket=cells["size_bucket"],
                notes=cells["notes"],
                isin=cells["isin"],
                ucits=cells["ucits"] == "yes",
                ter=ter,
                size_eur_m=size_eur_m,
            )
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
            if ter is not None and not 0 < ter <= MAX_TER:
                raise UniverseFileError(
                    f"line {line_number}: ter {ter} must be above 0 and at most {MAX_TER}"
                )
            if size_eur_m is not None and size_eur_m <= 0:
                raise UniverseFileError(f"line {line_number}: size_eur_m must be positive")
            if row.ucits and (
                row.asset_type != "ETF"
                or not is_valid_isin(row.isin)
                or row.isin[:2] not in UCITS_ISIN_PREFIXES
            ):
                raise UniverseFileError(
                    f"line {line_number}: ucits=yes needs an ETF with a valid ISIN whose prefix "
                    f"is one of {sorted(UCITS_ISIN_PREFIXES)}"
                )
            seen.add(row.ticker)
            rows.append(row)
    return rows
