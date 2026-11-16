"""Known sector types and aliases shared with the frontend; unknown labels stay valid."""

import json
from pathlib import Path
from typing import Literal, get_args

type Sector = Literal[
    "Basic Materials",
    "Communication Services",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Energy",
    "Financial Services",
    "Healthcare",
    "Industrials",
    "Real Estate",
    "Technology",
    "Utilities",
]

UNCLASSIFIED = "Unclassified"
FUNDS = "Funds"  # country label of an ETF: no look-through, so no country exposure


def clean_label(value: str | None) -> str:
    """A display label: spaces collapsed, at most 100 characters, Unclassified when blank."""
    return " ".join(value.split())[:100] if value and value.strip() else UNCLASSIFIED


SECTOR_NAMES: tuple[str, ...] = get_args(Sector.__value__)
with Path(__file__).with_suffix(".json").open(encoding="utf-8") as _catalog_file:
    SECTOR_CATALOG: dict[str, list[str]] = json.load(_catalog_file)

SECTOR_ALIASES = {
    alias.casefold(): name for name, aliases in SECTOR_CATALOG.items() for alias in (name, *aliases)
}
SECTOR_ALIASES[UNCLASSIFIED.casefold()] = UNCLASSIFIED
