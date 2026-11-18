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
