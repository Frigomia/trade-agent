"""Discovery scan writes run through the real restricted Postgres role."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.config import settings
from app.db import open_user_session
from app.discovery.persistence import save_scan
from app.discovery.screen import SHORTLIST_SIZE
from app.models import Recommendation, ScanRun
from app.schemas import ScanRunOut
from app.schemas_discovery import Exclusion, IdeaOut, IdeaSnapshot, Mention, RejectedMention
from app.user_data import delete_user_data
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user
from tests.discovery_fixtures import sample_candidate, sample_idea

COUNTS = {"universe_size": 600, "eligible": 100, "shortlisted": 10, "researched": 2}


def _idea(*, ticker="NESN.SW", overall=70, confidence="medium") -> IdeaOut:
    data = sample_idea().model_dump()
    data.update(ticker=ticker, overall=overall, confidence=confidence)
    # Keep deterministic dimensions consistent with the overall supplied by the test.
    for dimension in data["scores"]:
        if dimension["name"] != "fit":
            dimension["score"] = overall
    return IdeaOut.model_validate(data)


def _rec(user_id=USER_ID, *, source="discovery", status="PENDING") -> Recommendation:
    return Recommendation(
        user_id=user_id,
        ticker="NESN.SW",
        asset_type="STOCK",
        action="BUY",
        reasoning=["Earlier analysis"],
        source=source,
        status=status,
    )


@pytest.mark.parametrize(("score", "fraction"), [(70, 0.5), (80, 1.0)])
def test_save_persists_full_idea_and_existing_position_sizing(
    db_session, app_session_local, score, fraction
):
    add_app_user(db_session)
    idea = _idea(overall=score)

    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(USER_ID, [idea], **COUNTS)

    assert scan is not None
    assert scan.id > 0 and scan.created_at is not None
    assert scan.outcome == "ideas" and scan.status == "completed"
    assert scan.universe_size == 600 and scan.researched == 2
    assert ScanRunOut.model_validate(scan).opportunities == 1
    assert ScanRunOut.model_validate(scan).set_aside == 1
    saved = db_session.query(Recommendation).one()
    assert saved.source == "discovery" and saved.action == "BUY" and saved.status == "PENDING"
    assert IdeaOut.model_validate(saved.idea) == idea
    assert float(saved.suggested_position_pct) == pytest.approx(
        settings.max_single_position_pct * fraction
    )


def test_scan_saves_the_researched_ideas_that_missed_the_bar_best_first(
    db_session, app_session_local
):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(
            USER_ID,
            [_idea(ticker="LOW", overall=10), _idea(ticker="WIN", overall=90)],
            **COUNTS,
        )

    assert scan is not None and scan.outcome == "ideas"
    saved = scan.coverage_summary["set_aside_ideas"]
    assert [item["ticker"] for item in saved] == ["LOW"]
    assert set(saved[0]) == {"ticker", "name", "overall", "confidence"}
    assert saved[0]["overall"] == 10
    # The nearest misses stay a no-opportunity-only record, as before.
    assert "nearest_misses" not in scan.coverage_summary


def test_set_aside_ideas_are_bounded_by_the_shortlist_size(db_session, app_session_local):
    add_app_user(db_session)
    ideas = [_idea(ticker=f"T{i:02d}", overall=5) for i in range(SHORTLIST_SIZE + 3)]
    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(USER_ID, ideas, **{**COUNTS, "researched": len(ideas)})

    assert scan is not None
    assert len(scan.coverage_summary["set_aside_ideas"]) == SHORTLIST_SIZE
    assert scan.coverage_summary["nearest_misses"] == scan.coverage_summary["set_aside_ideas"][:3]


def test_superseding_preserves_manual_scheduled_reviewed_and_other_users_rows(
    db_session, app_session_local
):
    add_app_user(db_session)
    previous = _rec()
    preserved = [
        _rec(source="manual"),
        _rec(source="scheduled"),
        _rec(status="APPROVED"),
        _rec(status="REJECTED"),
        _rec(OTHER_USER_ID),
    ]
    db_session.add_all([previous, *preserved])
    db_session.commit()

    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [_idea()], **COUNTS)

    db_session.expire_all()
    assert previous.status == "SUPERSEDED"
    assert [row.status for row in preserved] == [
        "PENDING",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PENDING",
    ]
    assert (
        db_session.query(Recommendation)
        .filter_by(user_id=USER_ID, source="discovery", status="PENDING")
        .count()
        == 1
    )


def test_no_opportunity_retains_nearest_misses_exclusions_and_rejected_mentions(
    db_session, app_session_local
):
    add_app_user(db_session)
    exclusion = Exclusion(
        ticker="FAIL",
        name="Failed Issuer",
        reason="thesis_invalidated",
        explanation="The regulator revoked the licence on 2026-10-15.",
        evidence=["https://example.com/regulator"],
    )
    rejected = RejectedMention(
        mention=Mention(
            name="Orange",
            ticker_hint=None,
            exchange_hint=None,
            origin="reddit",
            reason="Unverified discussion",
            url=None,
        ),
        reason="ambiguous",
    )
    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(
            USER_ID,
            [
                _idea(ticker="LOW", overall=59),
                _idea(ticker="UNCERTAIN", overall=90, confidence="low"),
            ],
            excluded=[exclusion],
            rejected_mentions=[rejected],
            coverage_summary={"missing_prices": 4},
            **COUNTS,
        )

    assert scan is not None and scan.outcome == "none"
    assert "No compelling opportunity" in scan.summary
    assert scan.coverage_summary["missing_prices"] == 4
    assert ScanRunOut.model_validate(scan).opportunities == 0
    assert ScanRunOut.model_validate(scan).set_aside == 2
    assert all(
        miss["name"] == sample_idea().name for miss in scan.coverage_summary["nearest_misses"]
    )
    assert {miss["ticker"] for miss in scan.coverage_summary["nearest_misses"]} == {
        "LOW",
        "UNCERTAIN",
    }
    assert scan.excluded == [exclusion.model_dump(mode="json")]
    assert scan.rejected_mentions == [rejected.model_dump(mode="json")]
    assert db_session.query(Recommendation).count() == 0


def test_empty_shortlist_is_a_completed_no_opportunity_scan(db_session, app_session_local):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(USER_ID, [], **{**COUNTS, "shortlisted": 0, "researched": 0})
    assert scan is not None and scan.outcome == "none"
    assert scan.coverage_summary["nearest_misses"] == []
    assert db_session.query(ScanRun).count() == 1


@pytest.mark.parametrize("outcome", ["invalidated", "low_score", "low_confidence"])
def test_later_rejection_retires_the_earlier_pending_buy(
    db_session,
    app_session_local,
    outcome,
):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [_idea()], **COUNTS)
        excluded = (
            [
                Exclusion(
                    ticker="NESN.SW",
                    name="Nestle",
                    reason="thesis_invalidated",
                    explanation="The regulator revoked its operating licence.",
                    evidence=["https://www.sec.gov/report"],
                )
            ]
            if outcome == "invalidated"
            else []
        )
        ideas = (
            []
            if excluded
            else [
                _idea(
                    overall=59 if outcome == "low_score" else 70,
                    confidence="low" if outcome == "low_confidence" else "medium",
                )
            ]
        )
        scan = save_scan(USER_ID, ideas, excluded=excluded, **COUNTS)
    assert scan is not None and scan.outcome == "none"
    expected = "PENDING" if outcome == "low_confidence" else "SUPERSEDED"
    assert db_session.query(Recommendation).one().status == expected
    assert db_session.query(ScanRun).count() == 2


@pytest.mark.parametrize("reason", ["unreliable_price", "insufficient_data", "ambiguous_identity"])
def test_screening_failure_preserves_previous_researched_buy(db_session, app_session_local, reason):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [_idea()], **COUNTS)
        exclusion = Exclusion(
            ticker="NESN.SW",
            name="Nestle",
            reason=reason,
            explanation="Snapshot unavailable for screening.",
            evidence=[],
        )
        save_scan(USER_ID, [], excluded=[exclusion], **COUNTS)
    assert db_session.query(Recommendation).one().status == "PENDING"


def test_failed_scan_rolls_back_recommendations_and_supersession(db_session, app_session_local):
    add_app_user(db_session)
    previous = _rec()
    db_session.add(previous)
    db_session.commit()

    with (
        patch("app.db.SessionLocal", app_session_local),
        pytest.raises(TypeError, match="not JSON serializable"),
    ):
        save_scan(USER_ID, [_idea()], coverage_summary={"not_json": object()}, **COUNTS)

    db_session.expire_all()
    assert db_session.query(ScanRun).count() == 0
    assert db_session.query(Recommendation).count() == 1
    assert previous.status == "PENDING"


@pytest.mark.parametrize("status", ["disabled", "invited", None])
def test_scan_cannot_write_for_an_inactive_or_removed_user(db_session, app_session_local, status):
    if status is not None:
        add_app_user(db_session, status=status)
    previous = _rec()
    db_session.add(previous)
    db_session.commit()
    with patch("app.db.SessionLocal", app_session_local):
        assert save_scan(USER_ID, [_idea()], **COUNTS) is None
    db_session.expire_all()
    assert previous.status == "PENDING"
    assert db_session.query(Recommendation).count() == 1
    assert db_session.query(ScanRun).count() == 0


def test_export_and_delete_include_scan_results_and_idea_json(
    client, db_session, app_session_local
):
    add_app_user(db_session, OTHER_USER_ID)
    idea = _idea()
    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [idea], **COUNTS)
        save_scan(OTHER_USER_ID, [], **COUNTS)

    response = client.get("/me/export")
    assert response.status_code == 200
    export = response.json()
    assert len(export["scan_runs"]) == 1
    assert export["scan_runs"][0]["user_id"] == str(USER_ID)
    assert export["recommendations"][0]["idea"] == idea.model_dump(mode="json")

    delete_user_data(app_session_local, USER_ID)
    assert db_session.query(ScanRun).filter_by(user_id=USER_ID).count() == 0
    assert db_session.query(Recommendation).filter_by(user_id=USER_ID).count() == 0
    assert db_session.query(ScanRun).filter_by(user_id=OTHER_USER_ID).count() == 1
    with open_user_session(app_session_local, USER_ID) as scoped:
        assert scoped.query(ScanRun).count() == 0


def test_duplicate_candidates_are_rejected_before_writing(db_session, app_session_local):
    add_app_user(db_session)
    with (
        patch("app.db.SessionLocal", app_session_local),
        pytest.raises(ValueError, match="duplicate"),
    ):
        save_scan(USER_ID, [_idea(), _idea()], **COUNTS)
    assert db_session.query(ScanRun).count() == 0
    assert db_session.query(Recommendation).count() == 0


def test_scan_counts_do_not_change_when_an_idea_is_reviewed(client, db_session, app_session_local):
    with patch("app.db.SessionLocal", app_session_local):
        scan = save_scan(USER_ID, [_idea()], coverage_summary={"opportunities": 999}, **COUNTS)
    saved = db_session.query(Recommendation).one()
    assert client.post(f"/analysis/recommendations/{saved.id}/reject").status_code == 200
    response = client.get("/discovery/ideas").json()
    assert response["recommendations"] == []
    assert response["latest_scan"]["id"] == scan.id
    assert response["latest_scan"]["opportunities"] == 1
    assert response["latest_scan"]["set_aside"] == 1


def test_opportunities_cannot_exceed_researched_candidates(db_session, app_session_local):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local), pytest.raises(ValueError, match="exceed"):
        save_scan(USER_ID, [_idea()], **{**COUNTS, "researched": 0})
    assert db_session.query(ScanRun).count() == 0


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (None, None),
        (True, None),
        (False, None),
        (-1, None),
        (3, None),
        (1.5, None),
        ("1", None),
        (0, 0),
        (1, 1),
        (2, 2),
    ],
)
def test_scan_count_requires_an_integer_within_researched_bounds(count, expected):
    scan = ScanRunOut(
        id=1,
        user_id=USER_ID,
        created_at=datetime(2026, 10, 21),
        status="completed",
        **COUNTS,
        outcome="ideas",
        summary="Saved scan",
        excluded=[],
        rejected_mentions=[],
        coverage_summary={} if count is None else {"opportunities": count},
    )
    data = scan.model_dump()
    assert data["opportunities"] == expected
    assert data["set_aside"] == (None if expected is None else COUNTS["researched"] - expected)


def _idea_priced(price_as_of, *, price=95.0) -> IdeaOut:
    candidate = sample_candidate()
    snapshot = IdeaSnapshot(
        exchange=candidate.exchange,
        country=candidate.country,
        sector=candidate.sector,
        industry=candidate.industry,
        currency="CHF",
        price=price,
        price_as_of=price_as_of,
        fundamentals=candidate.fundamentals,
        coverage=candidate.coverage,
    )
    return _idea().model_copy(update={"snapshot": snapshot})


def _saved_entry(db_session, app_session_local, idea):
    add_app_user(db_session)
    with patch("app.db.SessionLocal", app_session_local):
        save_scan(USER_ID, [idea], **COUNTS)
    return db_session.query(Recommendation).one()


def test_an_idea_keeps_the_price_and_day_it_was_issued_at(db_session, app_session_local):
    as_of = datetime.now(UTC) - timedelta(days=3)

    saved = _saved_entry(db_session, app_session_local, _idea_priced(as_of))

    assert float(saved.price_at_recommendation) == 95.0
    assert saved.price_as_of == datetime(as_of.year, as_of.month, as_of.day)


@pytest.mark.parametrize("days", [-2, 11, 400])
def test_a_price_dated_in_the_future_or_too_old_is_not_kept(db_session, app_session_local, days):
    saved = _saved_entry(
        db_session, app_session_local, _idea_priced(datetime.now(UTC) - timedelta(days=days))
    )

    assert saved.price_at_recommendation is None and saved.price_as_of is None


def test_an_idea_with_no_price_date_or_snapshot_is_left_unmeasured(db_session, app_session_local):
    saved = _saved_entry(db_session, app_session_local, _idea_priced(None))

    assert saved.price_at_recommendation is None and saved.price_as_of is None
