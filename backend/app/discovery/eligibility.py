"""Whether a symbol can be researched at all (plan 4.1).

Four safeguards, each with a recorded reason. There is no market-cap, liquidity or broker gate, and
missing some metrics never excludes a company.
"""

import math
from typing import Literal, get_args

from app.discovery.snapshot import SymbolSnapshot, coverage_of
from app.fx import SUPPORTED
from app.schemas_discovery import AssetType, Exclusion

MIN_CORE_METRICS = 3  # proposed default: fewer cannot be evaluated meaningfully
ExcludedFor = Literal[
    "unreliable_price", "ambiguous_identity", "currency_unsupported", "insufficient_data"
]


def _out(snap: SymbolSnapshot, reason: ExcludedFor, explanation: str) -> tuple[bool, Exclusion]:
    return False, Exclusion(
        ticker=snap.ticker, name=snap.name, reason=reason, explanation=explanation, evidence=[]
    )


def is_eligible(
    snap: SymbolSnapshot, stale: str | None = None, profile: str = "broad"
) -> tuple[bool, Exclusion | None]:
    """`stale` is the reason `check_freshness` gave for this ticker, if any.

    `profile` is where a future risk profile plugs in (plan 1.4); it has no effect yet.
    """
    if not snap.name or not snap.exchange or snap.asset_type not in get_args(AssetType):
        return _out(
            snap, "ambiguous_identity", "name, exchange or asset type is missing or unknown"
        )
    if snap.asset_type == "ETF":
        return _out(
            snap,
            "insufficient_data",
            "an ETF needs separate criteria; company fundamentals do not describe it",
        )
    if snap.currency not in SUPPORTED:
        return _out(
            snap, "currency_unsupported", f"quote currency {snap.currency} cannot be converted"
        )
    price = snap.price
    if price is None or not math.isfinite(price) or price <= 0:
        return _out(snap, "unreliable_price", "the price is missing or not a positive number")
    if not snap.closes or not all(math.isfinite(c) and c > 0 for c in snap.closes):
        return _out(snap, "unreliable_price", "no price history, or it holds an invalid close")
    if stale:
        return _out(snap, "unreliable_price", f"the price is out of date: {stale}")
    present = coverage_of(snap.metrics).core_metrics_present
    if present < MIN_CORE_METRICS:
        return _out(
            snap,
            "insufficient_data",
            f"{present} core fundamentals available, at least {MIN_CORE_METRICS} are needed",
        )
    return True, None
