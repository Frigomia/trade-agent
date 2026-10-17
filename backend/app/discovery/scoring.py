"""Turn a candidate's peer comparisons into a 0-100 score per dimension (plan 4.3).

Each scored metric is placed on a scale that runs from one interquartile range below the peers'
first quartile (0) to one above the third (1), reversed where lower is better. Clamping at the
quartiles themselves would tie the whole top quarter; this way only real outliers saturate. The
dimension is the mean of those places, and only exists when at least `MIN_SCORED` metrics have a
valid comparison. Otherwise it is None: "peer comparison unavailable", never zero and never a guess.
"""

from collections.abc import Sequence
from statistics import mean
from typing import Literal

from app.discovery.peers import METRIC_SETS
from app.schemas_discovery import PeerComparison

MIN_SCORED = 2
_COARSE = {"below": 0.0, "within": 0.5, "above": 1.0}  # when the peers' quartiles coincide


def dimension_score(
    comparisons: Sequence[PeerComparison], group: str, dimension: Literal["quality", "valuation"]
) -> int | None:
    # None: not in this dimension, or shown but never scored
    direction = {s.name: s.higher_is_better for s in METRIC_SETS[group] if s.dimension == dimension}
    parts: list[float] = []
    for c in comparisons:
        up = direction.get(c.metric)
        if up is None or c.position == "unavailable" or c.value is None:
            continue
        if c.peer_p25 is None or c.peer_p75 is None:
            continue
        span = c.peer_p75 - c.peer_p25
        place = (c.value - c.peer_p25 + span) / (3 * span) if span > 0 else _COARSE[c.position]
        place = min(max(place, 0.0), 1.0)
        parts.append(place if up else 1 - place)
    return round(100 * mean(parts)) if len(parts) >= MIN_SCORED else None
