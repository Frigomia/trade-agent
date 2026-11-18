"""The pure logic of the dev-only replay script (no network, no model)."""

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "replay_scan_cost.py"
_spec = importlib.util.spec_from_file_location("replay_scan_cost", SCRIPT)
replay = importlib.util.module_from_spec(_spec)
sys.modules["replay_scan_cost"] = replay
_spec.loader.exec_module(replay)

LICENCE = "The regulator revoked the company's sole operating licence on 10 October 2026."


def claim(url, text="Revenue grew five percent in the reported year.", **overrides):
    return {
        "url": url,
        "text": text,
        "kind": "fact",
        "source_tier": "official",
        "materiality": "high",
        "event_id": "e",
        **overrides,
    }


def test_retention_counts_protected_and_ordinary_claims_separately():
    old = [
        claim("https://sec.gov/a", LICENCE),  # protected: cited by a development
        claim("https://sec.gov/b", "Margins widened to nine percent."),  # ordinary
        claim("https://x.example/c", "An analyst thinks so.", kind="opinion"),  # not measured
    ]
    result = replay.retention(old, list(old), protected_urls={"https://sec.gov/a"})
    assert (result.protected_total, result.protected_kept) == (1, 1)
    assert (result.ordinary_total, result.ordinary_kept) == (1, 1)
    assert result.ok


def test_a_claim_with_an_explicit_full_event_date_is_protected():
    old = [claim("https://sec.gov/d", "The hearing is set for 12 November 2026 in Zurich.")]
    result = replay.retention(old, [], protected_urls=set())
    assert (result.protected_total, result.protected_kept) == (1, 0)
    assert not result.ok


def test_retention_matches_by_url_and_excerpt_overlap_not_event_id():
    old = [claim("https://sec.gov/a", "Revenue grew five percent in the reported fiscal year.")]
    reworded = [
        claim(
            "https://sec.gov/a",
            "Revenue grew five percent in the reported fiscal year.",
            event_id="another-id",
        )
    ]
    other_url = [claim("https://sec.gov/z", old[0]["text"])]
    other_text = [claim("https://sec.gov/a", "Completely different statement about debt levels.")]
    assert replay.retention(old, reworded, set()).ordinary_kept == 1
    assert replay.retention(old, other_url, set()).ordinary_kept == 0
    assert replay.retention(old, other_text, set()).ordinary_kept == 0


def test_a_company_over_the_cap_is_reported_not_silently_passed():
    old = [
        claim(f"https://sec.gov/{i}", f"Distinct statement number {i} about the business.")
        for i in range(30)
    ]
    result = replay.retention(old, old[:14], protected_urls=set())
    assert (result.ordinary_total, result.ordinary_kept) == (30, 14)
    assert round(result.ordinary_pct, 1) == 46.7  # retained over baseline, no allowance for a cap
    assert not result.ok
    assert "14/30" in result.detail


def test_acceptance_share_is_zero_when_nothing_was_attempted():
    assert replay.acceptance_share(0, 0) == 0.0
    assert replay.acceptance_share(10, 8) == pytest.approx(0.8)


def case(*, output_tokens=1000, stop="end_turn", exclusion=None, accepted=10, attempted=10):
    return {
        "company": "TEST",
        "calls": [
            {
                "step": "research",
                "input_tokens": 12000,
                "output_tokens": output_tokens,
                "seconds": 40.0,
                "stop_reason": stop,
            }
        ],
        "attempted_claims": attempted,
        "accepted_claims": accepted,
        "claims": [],
        "cited_urls": [],
        "developments": [],
        "catalysts": [],
        "exclusion": exclusion,
    }


def checks(old_case, new_case):
    result = replay.compare_runs(
        {"label": "old", "cases": {"c": old_case}}, {"label": "new", "cases": {"c": new_case}}
    )
    return {c.name: c for c in result}


def test_compare_fails_on_any_truncation():
    assert checks(case(), case(output_tokens=600))["truncation"].ok
    assert not checks(case(), case(output_tokens=600, stop="max_tokens"))["truncation"].ok


def test_compare_fails_when_an_exclusion_outcome_differs():
    assert checks(case(exclusion="thesis_invalidated"), case(exclusion="thesis_invalidated"))[
        "exclusion:c"
    ].ok
    assert not checks(case(exclusion="thesis_invalidated"), case(exclusion=None))["exclusion:c"].ok
    assert not checks(case(exclusion=None), case(exclusion="thesis_invalidated"))["exclusion:c"].ok


def test_compare_fails_when_output_tokens_do_not_fall_by_thirty_percent():
    assert not checks(case(output_tokens=1000), case(output_tokens=800))["output_tokens"].ok
    assert checks(case(output_tokens=1000), case(output_tokens=690))["output_tokens"].ok


def test_compare_fails_when_the_share_of_accepted_claims_drops():
    assert not checks(case(accepted=9, attempted=10), case(accepted=5, attempted=10))[
        "acceptance"
    ].ok
    assert checks(case(accepted=9, attempted=10), case(accepted=9, attempted=10))["acceptance"].ok


def test_a_replay_lookup_without_a_recording_raises():
    recording = replay.Recording(
        searches={("news", "q1"): [{"url": "https://a.example/1"}]},
        followups={"T": [{"url": "https://reuters.com/x"}]},
        planted={},
    )
    assert recording.lookup("news", "q1", "T") == [{"url": "https://a.example/1"}]
    # the follow-up query is model-written, so the fixed bundle is served whatever it says
    assert recording.lookup("follow-up", "any wording", "T")[0]["url"] == "https://reuters.com/x"
    with pytest.raises(replay.ReplayMissing):
        recording.lookup("news", "unrecorded query", "T")  # never empty, never a live search
    with pytest.raises(replay.ReplayMissing):
        recording.lookup("follow-up", "q", "NO-BUNDLE")


def test_a_planted_ticker_is_served_its_planted_initial_sources_not_a_live_search():
    live = [{"url": "https://live.example/tavily-result-for-a-fake-company"}]
    planted = [{"url": "https://www.sec.gov/planted/1"}]
    recording = replay.Recording(
        searches={("news", "q"): live},  # what a careless record run could have saved
        followups={"PLANT1.TEST": []},
        planted={"PLANT1.TEST": {"initial": planted}},
    )
    assert recording.lookup("news", "q", "PLANT1.TEST") == planted
    assert recording.lookup("news", "q", "REAL.DE") == live  # a real company still uses its own


def test_claims_for_retention_come_from_the_research_step_not_the_follow_up_merge():
    from types import SimpleNamespace

    def evidence(claim_urls, dev_urls):
        return SimpleNamespace(
            claims=[
                SimpleNamespace(model_dump=lambda mode, u=u: {"url": u, "text": "t"})
                for u in claim_urls
            ],
            negative_developments=[
                SimpleNamespace(model_dump=lambda mode, u=u: {"evidence": [u]}) for u in dev_urls
            ],
        )

    research_ev = evidence(["https://a.example/1"], [])
    final_ev = evidence(
        ["https://a.example/1", "https://forum.example/2"], ["https://forum.example/2"]
    )
    out = replay._dump(research_ev, final_ev, SimpleNamespace(catalysts=[]))
    assert [c["url"] for c in out["claims"]] == ["https://a.example/1"]
    assert out["cited_urls"] == []  # a follow-up-only development is not a protected research claim
    assert [c["url"] for c in out["followup_claims"]] == [
        "https://a.example/1",
        "https://forum.example/2",
    ]


def planted_case(case_id, *, exclusion=None, steps=(), claim_urls=()):
    return {
        **case(exclusion=exclusion),
        "calls": [
            {"step": s, "input_tokens": 1, "output_tokens": 1, "seconds": 1.0, "stop_reason": "x"}
            for s in steps
        ],
        "claims": [claim(u, f"statement about {u}") for u in claim_urls],
    }


def planted_checks(case_id, new_case):
    old = {"label": "old", "cases": {case_id: new_case}}
    new = {"label": "new", "cases": {case_id: new_case}}
    return {c.name: c for c in replay.compare_runs(old, new)}[f"expect:{case_id}"]


def test_planted_cases_must_behave_as_stated_not_just_match_the_old_code():
    starts = "planted:starts_confirmed"
    assert planted_checks(
        starts, planted_case(starts, exclusion="thesis_invalidated", steps=["thesis"])
    ).ok
    # old and new both retained a company that should have been excluded: a vacuous match
    assert not planted_checks(starts, planted_case(starts, exclusion=None)).ok

    forum = "planted:forum_led_confirmed_by_followup"
    assert planted_checks(
        forum, planted_case(forum, exclusion="thesis_invalidated", steps=["follow_up", "thesis"])
    ).ok
    assert not planted_checks(
        forum, planted_case(forum, exclusion="thesis_invalidated", steps=["thesis"])
    ).ok

    none = "planted:unconfirmed_no_authoritative_source"
    assert planted_checks(none, planted_case(none)).ok
    assert not planted_checks(none, planted_case(none, steps=["follow_up"])).ok

    medium = "planted:medium_allegation_trusted_bundle"
    assert planted_checks(medium, planted_case(medium, steps=["follow_up"])).ok
    assert not planted_checks(medium, planted_case(medium)).ok

    support = "planted:supporting_evidence_after_cap"
    urls = ["https://www.sec.gov/planted/5a", "https://www.reuters.com/planted/5b"]
    assert planted_checks(
        support, planted_case(support, exclusion="thesis_invalidated", claim_urls=urls)
    ).ok
    assert not planted_checks(
        support, planted_case(support, exclusion="thesis_invalidated", claim_urls=urls[:1])
    ).ok


def test_a_planted_case_missing_from_the_run_fails_instead_of_passing_silently():
    new = {"label": "new", "cases": {}}  # every planted case dropped, renamed or crashed
    checks = {c.name: c for c in replay.compare_runs({"label": "old", "cases": {}}, new)}
    for cid in ("planted:starts_confirmed", "planted:forum_led_confirmed_by_followup"):
        assert not checks[f"expect:{cid}"].ok
        assert "missing" in checks[f"expect:{cid}"].detail
