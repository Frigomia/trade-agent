import uuid
from datetime import UTC, datetime, timedelta

from app.discovery.withdrawal import successor_id, withdrawal_for
from app.models import CompanyAnalysis, Recommendation, ScanRun
from tests.auth_support import OTHER_USER_ID, USER_ID
from tests.discovery_fixtures import sample_idea


def now():
    return datetime.now(UTC).replace(tzinfo=None)


def rec(db, ticker="NESN.SW", *, status="SUPERSEDED", source="discovery", age=10, user_id=USER_ID):
    row = Recommendation(
        user_id=user_id,
        ticker=ticker,
        asset_type="STOCK",
        action="BUY",
        reasoning=["r"],
        source=source,
        status=status,
        # a complete idea, so the same row also passes the API's response model
        idea=sample_idea().model_copy(update={"ticker": ticker}).model_dump(mode="json")
        if source == "discovery"
        else None,
        created_at=now() - timedelta(days=age),
    )
    db.add(row)
    db.commit()
    return row


def scan(db, *, excluded=None, set_aside=None, age=5, user_id=USER_ID):
    row = ScanRun(
        user_id=user_id,
        created_at=now() - timedelta(days=age),
        status="completed",
        universe_size=600,
        eligible=100,
        shortlisted=10,
        researched=0,
        outcome="none",
        summary="s",
        excluded=excluded or [],
        rejected_mentions=[],
        coverage_summary={"set_aside_ideas": [{"ticker": t} for t in set_aside or []]},
    )
    db.add(row)
    db.commit()
    return row


def invalidated(ticker="NESN.SW", explanation="The recall changed the thesis."):
    return {
        "ticker": ticker,
        "name": "Nestle",
        "reason": "thesis_invalidated",
        "explanation": explanation,
        "evidence": [],
    }


def analysis(db, ticker="NESN.SW", *, status="no_opportunity", researched=True, age=5):
    row = CompanyAnalysis(
        user_id=USER_ID,
        ticker=ticker,
        job_id=str(uuid.uuid4()),
        created_at=now() - timedelta(days=age),
        status=status,
        researched=researched,
        reason="Valuation is no longer attractive.",
        fingerprint="f",
    )
    db.add(row)
    db.commit()
    return row


def test_a_superseded_idea_with_a_newer_one_points_at_the_newest(db_session):
    old = rec(db_session, age=10)
    rec(db_session, status="SUPERSEDED", age=6)
    newest = rec(db_session, status="PENDING", age=2)
    rec(db_session, "OTHER", status="PENDING", age=1)  # another ticker is not a successor

    assert successor_id(db_session, old) == newest.id


def test_a_later_manual_recommendation_is_the_successor(db_session):
    old = rec(db_session, age=10)
    manual = rec(db_session, source="manual", status="PENDING", age=2)
    rec(db_session, "OTHER", source="manual", status="PENDING", age=1)  # another ticker
    rec(db_session, status="PENDING", age=1, user_id=OTHER_USER_ID)  # another user

    assert successor_id(db_session, old) == manual.id


def test_the_successor_may_already_be_decided(db_session):
    old = rec(db_session, age=10)
    newest = rec(db_session, status="APPROVED", age=2)

    assert successor_id(db_session, old) == newest.id


def test_no_successor_and_a_later_invalidated_exclusion_gives_its_explanation(db_session):
    old = rec(db_session)
    run = scan(db_session, excluded=[invalidated()], age=5)

    out = withdrawal_for(db_session, old)

    assert out.kind == "invalidated"
    assert out.reason == "The recall changed the thesis."
    assert out.as_of == run.created_at


def test_a_later_company_analysis_with_no_opportunity_gives_its_reason(db_session):
    old = rec(db_session)
    row = analysis(db_session, age=5)

    out = withdrawal_for(db_session, old)

    assert out.kind == "not_compelling"
    assert out.reason == "Valuation is no longer attractive."
    assert out.as_of == row.created_at


def test_a_later_set_aside_entry_gives_no_reason(db_session):
    old = rec(db_session)
    run = scan(db_session, set_aside=["NESN.SW"], age=5)

    out = withdrawal_for(db_session, old)

    assert out.kind == "not_compelling"
    assert out.reason is None
    assert out.as_of == run.created_at


def test_nothing_saved_gives_a_generic_withdrawal_without_a_date(db_session):
    old = rec(db_session)
    scan(db_session, excluded=[{**invalidated("OTHER")}], set_aside=["OTHER"])
    analysis(db_session, "OTHER")
    analysis(db_session, status="report")  # a report is not a withdrawal
    analysis(db_session, researched=False)  # an unresearched refusal is not evidence

    out = withdrawal_for(db_session, old)

    assert (out.kind, out.reason, out.as_of) == ("not_compelling", None, None)


def test_evidence_older_than_the_idea_is_ignored(db_session):
    old = rec(db_session, age=10)
    scan(db_session, excluded=[invalidated()], set_aside=["NESN.SW"], age=20)
    analysis(db_session, age=15)

    out = withdrawal_for(db_session, old)

    assert (out.kind, out.reason, out.as_of) == ("not_compelling", None, None)


def test_the_latest_candidate_wins(db_session):
    old = rec(db_session, age=10)
    scan(db_session, excluded=[invalidated()], age=8)
    row = analysis(db_session, age=4)
    scan(db_session, set_aside=["NESN.SW"], age=6)

    out = withdrawal_for(db_session, old)

    assert out.kind == "not_compelling"
    assert out.reason == "Valuation is no longer attractive."
    assert out.as_of == row.created_at


def test_other_kinds_get_neither_field(db_session):
    newer = rec(db_session, status="PENDING", age=1)
    for row in (
        rec(db_session, status="PENDING", age=10),
        rec(db_session, status="APPROVED", age=10),
        rec(db_session, status="SUPERSEDED", source="manual", age=10),
    ):
        assert successor_id(db_session, row) is None
        assert withdrawal_for(db_session, row) is None
    assert newer.id  # the discovery rows above did have a newer idea to point at


def test_another_users_scan_and_ideas_are_never_used(db_session):
    old = rec(db_session, age=10)
    rec(db_session, status="PENDING", age=2, user_id=OTHER_USER_ID)
    scan(db_session, excluded=[invalidated()], set_aside=["NESN.SW"], age=5, user_id=OTHER_USER_ID)

    assert successor_id(db_session, old) is None
    out = withdrawal_for(db_session, old)
    assert (out.kind, out.reason, out.as_of) == ("not_compelling", None, None)


def test_malformed_scan_json_is_ignored(db_session):
    old = rec(db_session)
    row = scan(db_session, excluded=["NESN.SW", None, 7])
    row.coverage_summary = {"set_aside_ideas": [3, "NESN.SW", None]}
    db_session.commit()
    row = scan(db_session, age=4)
    row.excluded = "not a list"
    row.coverage_summary = {"set_aside_ideas": 5}
    db_session.commit()

    out = withdrawal_for(db_session, old)

    assert (out.kind, out.reason, out.as_of) == ("not_compelling", None, None)
