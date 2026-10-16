"""Compare a candidate's fundamentals with economically comparable peers (plan 4.3).

Pure functions over the universe snapshot. No scores: it reports where a value sits against its
peers and lets the scoring step decide what that means. Region is not a peer dimension, and a
missing value stays missing: nothing is estimated or swapped in.

Metric values are expected as fractions (the snapshot divides dividend yield by 100) and
`fcfMargin` is free cash flow over revenue, also computed by the snapshot.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from statistics import quantiles
from typing import Any, Literal

from app.schemas_discovery import PeerComparison

MIN_PEERS = 8  # approved: fewer suitable peers means "peer comparison unavailable"


@dataclass(frozen=True)
class MetricSpec:
    name: str
    dimension: Literal["quality", "valuation"]
    higher_is_better: bool | None  # None: shown, never scored
    positive_only: bool = False  # zero or less is undefined (negative earnings, negative equity)
    obtainable: bool = True  # False: Yahoo has no such field; reported as unavailable


def _q(
    name: str, better: bool | None = True, positive: bool = False, obtainable: bool = True
) -> MetricSpec:
    return MetricSpec(name, "quality", better, positive, obtainable)


def _v(name: str, better: bool = False, obtainable: bool = True) -> MetricSpec:
    return MetricSpec(name, "valuation", better, name != "dividendYield", obtainable)


_ROE, _PE, _PB, _YIELD = (
    _q("returnOnEquity"),
    _v("trailingPE"),
    _v("priceToBook"),
    _v("dividendYield", True),
)
_DE = _q("debtToEquity", False, positive=True)

METRIC_SETS: dict[str, tuple[MetricSpec, ...]] = {
    "general": (
        _ROE,
        _q("operatingMargins"),
        _q("revenueGrowth"),
        _DE,
        _q("fcfMargin"),
        _PE,
        _v("enterpriseToEbitda"),
        _v("pegRatio"),
        _v("priceToSalesTrailing12Months"),
    ),
    "bank": (_ROE, _q("returnOnAssets"), _PB, _PE, _YIELD),
    "insurer": (_ROE, _PB, _PE, _YIELD),
    "financial_other": (_ROE, _PE, _PB),
    # No P/E and no payout ratio for REITs: both are earnings-based and not comparable. FFO is the
    # right measure and Yahoo does not provide it, so it is reported unavailable.
    "reit": (_DE, _PB, _YIELD, _v("priceToFfo", obtainable=False)),
    "utility": (
        _ROE,
        _DE,
        _q("payoutRatio", None),
        _q("interestCoverage", obtainable=False),
        _PE,
        _v("enterpriseToEbitda"),
        _YIELD,
    ),
    "etf": (),
}


@dataclass(frozen=True)
class PeerRecord:
    ticker: str
    asset_type: str
    sector: str | None
    industry: str | None
    metrics: dict[str, Any]

    @property
    def group(self) -> str:
        return metric_group(self.sector, self.industry, self.asset_type)


def metric_group(sector: str | None, industry: str | None, asset_type: str) -> str:
    industry = industry or ""
    if asset_type == "ETF":
        return "etf"
    if industry.startswith("Banks"):
        return "bank"
    if industry.startswith("Insurance -"):  # not "Insurance Brokers", which are fee businesses
        return "insurer"
    if industry.startswith("REIT"):
        return "reit"
    if sector == "Utilities":
        return "utility"
    return "financial_other" if sector == "Financial Services" else "general"


def _usable(spec: MetricSpec, value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return None if spec.positive_only and value <= 0 else float(value)


def compare_to_peers(candidate: PeerRecord, universe: Sequence[PeerRecord]) -> list[PeerComparison]:
    group = candidate.group
    peers = [p for p in universe if p.ticker != candidate.ticker and p.group == group]
    return [_compare(spec, candidate, peers) for spec in METRIC_SETS[group]]


def _no_peers(spec: MetricSpec, value: float | None, peer_count: int) -> PeerComparison:
    return PeerComparison(
        metric=spec.name,
        value=value,
        peer_group="none",
        peer_count=peer_count,
        peer_median=None,
        peer_p25=None,
        peer_p75=None,
        position="unavailable",
    )


def _compare(spec: MetricSpec, candidate: PeerRecord, peers: list[PeerRecord]) -> PeerComparison:
    if not spec.obtainable:
        return _no_peers(spec, None, 0)
    value = _usable(spec, candidate.metrics.get(spec.name))

    def values(same: Callable[[PeerRecord], bool]) -> list[float]:
        # ponytail: rescans peers per metric, fine at ~600 symbols; index by industry if it grows
        found = (_usable(spec, p.metrics.get(spec.name)) for p in peers if same(p))
        return [v for v in found if v is not None]

    in_industry = values(
        lambda p: candidate.industry is not None and p.industry == candidate.industry
    )
    in_sector = values(lambda p: candidate.sector is not None and p.sector == candidate.sector)
    level: Literal["industry", "sector"]
    if len(in_industry) >= MIN_PEERS:
        level, pool = "industry", in_industry
    elif len(in_sector) >= MIN_PEERS:
        level, pool = "sector", in_sector
    else:
        return _no_peers(spec, value, len(in_sector))
    p25, median, p75 = quantiles(pool, n=4, method="inclusive")
    position: Literal["below", "within", "above", "unavailable"] = "within"
    if value is None:
        position = "unavailable"
    elif value < p25:
        position = "below"
    elif value > p75:
        position = "above"
    return PeerComparison(
        metric=spec.name,
        value=value,
        peer_group=level,
        peer_count=len(pool),
        peer_median=median,
        peer_p25=p25,
        peer_p75=p75,
        position=position,
    )
