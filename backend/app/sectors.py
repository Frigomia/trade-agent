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

SECTOR_NAMES: tuple[str, ...] = get_args(Sector.__value__)
with Path(__file__).with_suffix(".json").open(encoding="utf-8") as _catalog_file:
    SECTOR_CATALOG: dict[str, list[str]] = json.load(_catalog_file)

SECTOR_ALIASES = {
    alias.casefold(): name for name, aliases in SECTOR_CATALOG.items() for alias in (name, *aliases)
}
SECTOR_ALIASES["unclassified"] = "Unclassified"
