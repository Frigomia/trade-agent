"""Shared contracts of the market-discovery feature (plan 2026-10-14-market-discovery, 4.5).

This module is the seam between the two lanes: lane A produces the portfolio, candidate and
admission models; lane B produces the research, scoring and output models. Keep it minimal. A
field belongs here only when something named consumes it, and a change is a change for both lanes:
make it in its own small PR.

Conventions:
- Every model rejects unknown fields, so a misspelled field fails loudly across the seam.
- A value that could not be found is `None`, never a default. A missing number is never replaced
  by 0 or a guess (plan rule 5).
- Qualitative judgements are text. Only deterministic metrics are numbers.
"""

from datetime import date, datetime
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

AssetType = Literal["STOCK", "ETF"]
Origin = Literal["universe", "tavily", "reddit", "industry_research"]
MentionOrigin = Literal["tavily", "reddit", "industry_research"]
SizeBucket = Literal["micro", "small", "mid", "large", "unknown"]
RiskLevel = Literal["low", "medium", "high", "unknown"]

# A share of the total value: never negative, never above the whole.
Weight = Annotated[float, Field(ge=0, le=1)]

# One line of disclosure for the reader: not blank, not a page.
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


def _http_url(value: str) -> str:
    """Accept an http(s) address that has a host, and return it unchanged.

    A prefix test lets through `https:///x`, `https://#f` and `https://?q=1`, which name no host.
    """
    if any(character.isspace() for character in value):
        raise ValueError("a citation must not contain whitespace")
    parts = urlsplit(value)  # raises ValueError for a malformed address such as an open [ host
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("a citation must be an http(s) address with a host")
    return value


# A usable citation: an http(s) address with a host. The text is kept exactly as given.
Url = Annotated[str, AfterValidator(_http_url)]


class Contract(BaseModel):
    # NaN and infinity are rejected rather than serialised to JSON null: "unavailable" is an
    # explicit None, and a bad number must not silently turn into one across the seam.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


# ---- Portfolio (lane A) ---------------------------------------------------------------------
# Consumers: the portfolio analytics screen, and the fit dimension of an idea.


class Exposure(Contract):
    label: str  # "Technology", "USD", "Japan"; "Unclassified" when unknown
    weight: Weight


class PositionValue(Contract):
    ticker: str
    name: str
    value_eur: float
    weight: Weight
    currency: str
    price: float
    price_as_of: datetime | None  # None: the quote carried no timestamp
    stale: bool


class PortfolioExposure(Contract):
    as_of: datetime
    total_value_eur: float | None  # None: no holdings
    positions: list[PositionValue]
    by_sector: list[Exposure]
    by_industry: list[Exposure]
    by_country: list[Exposure]
    by_currency: list[Exposure]
    top_position_weight: Weight | None
    hhi: float | None  # sum of squared weights, 0..1
    effective_n: float | None  # 1 / hhi: the number of equal-sized positions it is equivalent to
    volatility_annualized: float | None
    # None: fewer than 60 overlapping days, so the pair cannot be estimated
    correlation: dict[str, dict[str, float | None]]
    skipped: dict[str, str]  # ticker -> why it could not be valued
    notes: list[str]  # partial valuation, history/FX limitations and ETF proxy exposures


class CandidateFit(Contract):
    """What adding a candidate would do to the user's portfolio. Context, never a reason to buy."""

    ticker: str
    applicable: bool  # False: no holdings, or too few to compare
    avg_correlation_to_portfolio: float | None
    portfolio_vol_before: float | None
    portfolio_vol_after: float | None  # with the candidate at `hypothetical_weight`
    hhi_before: float | None
    hhi_after: float | None
    sector_weight_before: float | None
    sector_weight_after: float | None
    hypothetical_weight: Weight
    notes: list[str]


# ---- Candidates (lane A) --------------------------------------------------------------------
# Consumers: peer scoring and evaluation (lane B), the idea detail screen.


class Coverage(Contract):
    core_metrics_present: int = Field(ge=0)
    core_metrics_total: int = Field(ge=0)
    missing: list[str]  # the core fields without a finite value, so len == total - present

    @model_validator(mode="after")
    def _counts_are_consistent(self) -> Self:
        # Also rejects present > total: the difference is then negative, never a list length.
        if len(self.missing) != self.core_metrics_total - self.core_metrics_present:
            raise ValueError("missing must list exactly total - present core metrics")
        return self


class PeerComparison(Contract):
    metric: str
    value: float | None
    peer_group: Literal["industry", "sector", "none"]
    peer_count: int = Field(ge=0)
    peer_median: float | None
    peer_p25: float | None
    peer_p75: float | None
    # "unavailable": too few suitable peers or no value. The raw value is still shown.
    position: Literal["below", "within", "above", "unavailable"]


class PeerRow(Contract):
    """A named peer saved with the idea at scan time. Identity and figures come from the universe
    snapshot, never from the model; `values` use the metric names of PeerComparison."""

    ticker: str
    name: str
    country: str | None  # listing country
    currency: str | None  # major quote unit (GBP rather than GBp)
    market_cap_eur: float | None = Field(ge=0)
    values: dict[str, float | None]


class RiskProfile(Contract):
    """Measured and displayed. No eligibility gate or score penalty; risk breaks score ties."""

    market_cap_eur: float | None
    avg_daily_value_eur: float | None
    size_bucket: SizeBucket
    volatility_annualized: float | None
    max_drawdown_1y: float | None
    risk_flags: list[str]
    risk_level: RiskLevel


class CandidateMetrics(Contract):
    ticker: str
    name: str
    asset_type: AssetType
    exchange: str | None
    country: str | None  # listing country
    sector: str | None
    industry: str | None
    currency: str | None
    price: float | None
    price_as_of: datetime | None
    fundamentals: dict[str, float | None]  # raw values, shown when a peer comparison is unavailable
    coverage: Coverage
    peers: list[PeerComparison]
    # Saved on the idea's snapshot. Left out of a dump, so the model's prompts never carry it.
    named_peers: list[PeerRow] = Field(default_factory=list, exclude=True)
    risk: RiskProfile
    origin: Origin
    # Why it was found. Untrusted text from the web: zero scoring weight, and a prompt may only
    # carry it inside an untrusted-data block.
    origin_note: Note | None
    # What the reader should know about the data: an uncertain price date, a dimension that could
    # not be scored. Disclosure only; it never changes a score.
    data_notes: list[Note]


class Mention(Contract):
    """A company named by research. Lane A resolves and validates it before it is a candidate."""

    name: str
    ticker_hint: str | None
    exchange_hint: str | None
    origin: MentionOrigin
    reason: str
    url: Url | None


class RejectedMention(Contract):
    mention: Mention
    reason: Literal[
        "ambiguous",
        "unresolved",
        "no_price",
        "currency_unsupported",
        "insufficient_data",
        "cap_reached",
        "duplicate",
    ]


# ---- Research and output (lane B) -----------------------------------------------------------
# Consumers: the evaluation graph and the idea detail screen.


class Claim(Contract):
    text: str
    kind: Literal["fact", "opinion", "forecast", "forum"]
    stance: Literal["bull", "bear", "neutral"]
    materiality: Literal["high", "medium", "low"]
    source_tier: Literal["official", "reliable_reporting", "other", "forum"]
    event_id: str  # claims about the same underlying event share one id
    url: Url
    published_at: date | None

    @model_validator(mode="after")
    def _forum_is_always_forum(self) -> Self:
        # Forum content is a hypothesis, never evidence: kind and source tier must agree.
        if (self.kind == "forum") != (self.source_tier == "forum"):
            raise ValueError("a forum claim must have source_tier 'forum', and only forum claims")
        return self


class NegativeDevelopment(Contract):
    summary: str  # what happened
    occurred_on: date | None  # and when
    evidence: list[Url]  # claim urls
    thesis_impact: str  # how it affects the thesis
    status: Literal["confirmed", "disputed", "unverified"]
    invalidates_thesis: bool


class ResearchEvidence(Contract):
    ticker: str
    claims: list[Claim]
    negative_developments: list[NegativeDevelopment]
    competitors: list[str]
    mentions: list[Mention]  # other companies discussed; feeds admission only
    conflicts: list[str]  # where sources disagree
    gaps: list[str]  # what could not be found


class Exclusion(Contract):
    """A candidate removed from the shortlist, kept visible with the reason.

    Citations are format-checked here; that they exist in the research and that forum-only
    evidence never suffices are Phase 6 thesis-check rules, tested there.
    """

    ticker: str
    name: str
    reason: Literal[
        "thesis_invalidated",
        "unreliable_price",
        "ambiguous_identity",
        "currency_unsupported",
        "insufficient_data",
    ]
    explanation: str
    evidence: list[Url]

    @model_validator(mode="after")
    def _a_thesis_exclusion_cites_evidence(self) -> Self:
        if self.reason == "thesis_invalidated" and not self.evidence:
            raise ValueError("a thesis_invalidated exclusion must cite evidence urls")
        return self


class DimensionScore(Contract):
    name: Literal["quality", "valuation", "fit"]
    score: int | None = Field(ge=0, le=100)  # required; None means "unavailable", never a default
    reasons: list[str]  # derived from numbers, not from the LLM


class IdeaSnapshot(Contract):
    """Display data captured during evaluation, never refreshed when reading a saved idea."""

    exchange: str | None
    country: str | None  # listing country, not revenue exposure
    sector: str | None
    industry: str | None
    currency: str | None  # major quote unit (GBP rather than GBp)
    price: float | None = Field(gt=0)
    price_as_of: datetime | None
    fundamentals: dict[str, float | None]  # raw provider metrics; no currency conversion
    coverage: Coverage
    # The largest peers the comparison drew on; None on ideas saved before this field, [] when the
    # comparison had too few peers to name.
    peers: list[PeerRow] | None = None


class IdeaOut(Contract):
    ticker: str
    name: str
    asset_type: AssetType
    origin: Origin
    scores: list[DimensionScore]
    overall: int | None = Field(ge=0, le=100)
    confidence: Literal["high", "medium", "low"]
    risk: RiskProfile
    peers: list[PeerComparison]
    thesis: str  # LLM, from the numbers and the evidence
    catalysts: list[str]  # each cites a claim url
    outlook: str  # qualitative; never a score
    bear_case: str
    negative_developments: list[NegativeDevelopment]
    fit_summary: str | None  # None when fit is not applicable
    community_note: str | None  # explicitly unverified
    conclusion: str
    sources: list[Claim]
    style_tags: list[str]  # derived from fundamentals: quality, value, growth, income, defensive
    data_notes: list[str]  # stale prices, missing metrics, unavailable peers, conflicts
    # Older persisted ideas predate these fields; missing data stays explicitly unavailable.
    snapshot: IdeaSnapshot | None = None
    headline: str | None = Field(default=None, min_length=1, max_length=180)
    # Companies the research names. Plain names from the web, shown apart from the measured peers.
    competitors: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] = Field(
        default_factory=list, max_length=8
    )
    # What adding this company would do to the portfolio; None when not applicable (no holdings,
    # or too few to compare) and on ideas saved before this field.
    fit: CandidateFit | None = None

    @model_validator(mode="after")
    def _scores_are_complete_and_back_the_overall(self) -> Self:
        # An unavailable dimension is an explicit entry with score None, never an absent one.
        if sorted(score.name for score in self.scores) != ["fit", "quality", "valuation"]:
            raise ValueError("scores must hold exactly one each of quality, valuation and fit")
        # The overall is built from quality and valuation (plan 4.4); fit alone never produces it.
        built_from = [s.score for s in self.scores if s.name in ("quality", "valuation")]
        if self.overall is not None and all(score is None for score in built_from):
            raise ValueError("overall requires a quality or valuation score")
        return self
