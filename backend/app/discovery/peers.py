"""Compare a candidate's fundamentals with economically comparable peers (plan 4.3).

Pure functions over the universe snapshot. No scores: it reports where a value sits against its
peers and lets the scoring step decide what that means. Region is not a peer dimension, and a
missing value stays missing: nothing is estimated or swapped in.

Inputs the snapshot must provide, by these names: metric values as fractions (dividend yield is
divided by 100), `fcfMargin` (free cash flow over revenue) and `ebitda` (Yahoo's own, in any unit:
only its sign is read). A multiple is only used when the input that makes it meaningful is positive;
the sign of the ratio itself is not trusted to say so.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from statistics import quantiles
from typing import Any, Literal

from app.schemas_discovery import PeerComparison

MIN_PEERS = 8  # approved: fewer suitable peers means "peer comparison unavailable"


Domain = Literal["any", "positive", "nonnegative"]


@dataclass(frozen=True)
class MetricSpec:
    name: str
    dimension: Literal["quality", "valuation"]
    higher_is_better: bool | None  # None: shown, never scored
    domain: Domain = "any"  # the values that are defined; a multiple of a loss is not
    requires_positive: str | None = None  # another input that must be positive for this to count
    obtainable: bool = True  # False: Yahoo has no such field; reported as unavailable


def _q(name: str, better: bool | None = True, **kw: Any) -> MetricSpec:
    return MetricSpec(name, "quality", better, **kw)


def _v(name: str, better: bool = False, **kw: Any) -> MetricSpec:
    return MetricSpec(name, "valuation", better, **{"domain": "positive", **kw})


_ROE, _PE, _PB = _q("returnOnEquity"), _v("trailingPE"), _v("priceToBook")
_YIELD = _v("dividendYield", True, domain="any")
# Zero debt is a valid value; a negative one means negative equity, which is undefined.
_DE = _q("debtToEquity", False, domain="nonnegative")
# A negative EV (more cash than the company is worth) is a real value. What makes the multiple
# meaningless is a loss, so the check is on EBITDA itself, not on the sign of the ratio.
_EV = _v("enterpriseToEbitda", domain="any", requires_positive="ebitda")
# Negative earnings with negative growth give a positive PEG that means nothing: require earnings.
_PEG = _v("pegRatio", requires_positive="trailingPE")

METRIC_SETS: dict[str, tuple[MetricSpec, ...]] = {
    "general": (
        _ROE,
        _q("operatingMargins"),
        _q("revenueGrowth"),
        _DE,
        _q("fcfMargin"),
        _PE,
        _EV,
        _PEG,
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
        # Shown, never scored: a higher payout is neither better nor worse for a utility.
        _q("payoutRatio", None),
        _q("interestCoverage", obtainable=False),
        _PE,
        _EV,
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


def _number(value: Any) -> float | None:
    ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
    return float(value) if ok else None


def _usable(spec: MetricSpec, metrics: dict[str, Any]) -> float | None:
    value = _number(metrics.get(spec.name))
    if value is None:
        return None
    if (spec.domain == "positive" and value <= 0) or (spec.domain == "nonnegative" and value < 0):
        return None
    if spec.requires_positive is not None:
        base = _number(metrics.get(spec.requires_positive))
        if base is None or base <= 0:
            return None  # validity cannot be established, so the value is not used
    return value


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
    value = _usable(spec, candidate.metrics)

    def values(same: Callable[[PeerRecord], bool]) -> list[float]:
        # ponytail: rescans peers per metric, fine at ~600 symbols; index by industry if it grows
        found = (_usable(spec, p.metrics) for p in peers if same(p))
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
