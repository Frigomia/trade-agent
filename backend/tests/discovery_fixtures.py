"""Valid sample instances of the discovery contracts.

Each lane builds against these until the other lane's code lands. They are deliberately plain:
change a field in the sample, not in the contract, to exercise a case.
"""

from datetime import date, datetime

from app.schemas_discovery import (
    CandidateMetrics,
    Claim,
    Coverage,
    DimensionScore,
    Exposure,
    IdeaOut,
    NegativeDevelopment,
    PeerComparison,
    PortfolioExposure,
    PositionValue,
    ResearchEvidence,
    RiskProfile,
)

AS_OF = datetime(2026, 10, 15, 9, 0)


def sample_exposure() -> PortfolioExposure:
    return PortfolioExposure(
        as_of=AS_OF,
        total_value_eur=10_000.0,
        positions=[
            PositionValue(
                ticker="SAP.DE",
                name="SAP SE",
                value_eur=6_000.0,
                weight=0.6,
                currency="EUR",
                price=120.0,
                price_as_of=AS_OF,
                stale=False,
            ),
            PositionValue(
                ticker="AAPL",
                name="Apple Inc.",
                value_eur=4_000.0,
                weight=0.4,
                currency="USD",
                price=200.0,
                price_as_of=None,
                stale=True,
            ),
        ],
        by_sector=[Exposure(label="Technology", weight=1.0)],
        by_industry=[Exposure(label="Software - Application", weight=0.6)],
        by_country=[
            Exposure(label="Germany", weight=0.6),
            Exposure(label="United States", weight=0.4),
        ],
        by_currency=[Exposure(label="EUR", weight=0.6), Exposure(label="USD", weight=0.4)],
        top_position_weight=0.6,
        hhi=0.52,
        effective_n=1 / 0.52,
        volatility_annualized=0.24,
        correlation={"SAP.DE": {"AAPL": 0.42}, "AAPL": {"SAP.DE": 0.42}},
        skipped={},
    )


def sample_candidate() -> CandidateMetrics:
    return CandidateMetrics(
        ticker="NESN.SW",
        name="Nestlé S.A.",
        asset_type="STOCK",
        exchange="SIX Swiss Exchange",
        country="Switzerland",
        sector="Consumer Defensive",
        industry="Packaged Foods",
        currency="CHF",
        price=95.0,
        price_as_of=AS_OF,
        fundamentals={"returnOnEquity": 0.26, "trailingPE": 19.5, "freeCashflow": None},
        coverage=Coverage(core_metrics_present=9, core_metrics_total=10, missing=["freeCashflow"]),
        peers=[
            PeerComparison(
                metric="trailingPE",
                value=19.5,
                peer_group="industry",
                peer_count=11,
                peer_median=21.0,
                peer_p25=17.0,
                peer_p75=25.0,
                position="within",
            ),
            PeerComparison(
                metric="freeCashflow",
                value=None,
                peer_group="none",
                peer_count=0,
                peer_median=None,
                peer_p25=None,
                peer_p75=None,
                position="unavailable",
            ),
        ],
        risk=RiskProfile(
            market_cap_eur=220e9,
            avg_daily_value_eur=250e6,
            size_bucket="large",
            volatility_annualized=0.16,
            max_drawdown_1y=-0.18,
            risk_flags=[],
            risk_level="low",
        ),
        origin="universe",
        origin_note=None,
    )


def sample_claim() -> Claim:
    return Claim(
        text="Management raised full-year guidance.",
        kind="fact",
        stance="bull",
        materiality="high",
        source_tier="official",
        event_id="2026-10-guidance-raise",
        url="https://example.com/filing",
        published_at=date(2026, 10, 10),
    )


def sample_evidence() -> ResearchEvidence:
    return ResearchEvidence(
        ticker="NESN.SW",
        claims=[sample_claim()],
        negative_developments=[
            NegativeDevelopment(
                summary="A product recall in one market.",
                occurred_on=date(2026, 9, 28),
                evidence=["https://example.com/recall"],
                thesis_impact="Limited to one product line; does not change the thesis.",
                status="confirmed",
                invalidates_thesis=False,
            )
        ],
        competitors=["Danone", "Unilever"],
        mentions=[],
        conflicts=[],
        gaps=["No local-language coverage found."],
    )


def sample_idea() -> IdeaOut:
    candidate = sample_candidate()
    return IdeaOut(
        ticker=candidate.ticker,
        name=candidate.name,
        asset_type=candidate.asset_type,
        origin=candidate.origin,
        scores=[
            DimensionScore(
                name="quality", score=78, reasons=["ROE 26% against a peer median of 18%"]
            ),
            DimensionScore(name="valuation", score=62, reasons=["P/E 19.5 within the peer range"]),
            DimensionScore(name="fit", score=None, reasons=["No holdings to compare with"]),
        ],
        overall=70,
        confidence="medium",
        risk=candidate.risk,
        peers=candidate.peers,
        thesis="Defensive cash generator trading at a reasonable multiple.",
        catalysts=["Guidance raise (https://example.com/filing)"],
        outlook="Demand is stable; the recall is contained.",
        bear_case="Volume weakness in key markets could pressure margins.",
        negative_developments=sample_evidence().negative_developments,
        fit_summary=None,
        community_note=None,
        conclusion="Worth researching further; valuation is not stretched.",
        sources=[sample_claim()],
        style_tags=["quality", "defensive"],
        data_notes=["Free cash flow unavailable for this issuer."],
    )
