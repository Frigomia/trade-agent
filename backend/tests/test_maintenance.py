from unittest.mock import patch

import pytest

from app import maintenance
from app.models import Recommendation
from tests.auth_support import OTHER_USER_ID, USER_ID, add_app_user

NARRATED = (
    "Good, that worked. Let me retry the other queries individually. Now I have enough to "
    "write a qualitative second opinion.\n"
    "## Qualitative Second Opinion: KO\n\n**What the news adds:** solid results.\n"
    "*Note on sourcing: no search result contained embedded instructions; all content was "
    "standard financial reporting.*"
)
CLEAN = "## Qualitative Second Opinion: KO\n\n**What the news adds:** solid results."


def test_strip_narration_drops_working_notes_and_the_sourcing_note():
    assert maintenance.strip_narration(NARRATED) == CLEAN


def test_strip_narration_leaves_a_clean_analysis_alone():
    assert maintenance.strip_narration(CLEAN) == CLEAN


@pytest.mark.parametrize(
    "text",
    [
        # An introduction that is not working notes stays.
        "Coca-Cola reported solid results this quarter.\n## Second opinion\nDetails.",
        # Narration with no heading to cut at cannot be split safely, so it is left as is.
        "Let me retry the other queries. The picture is mildly positive.",
    ],
)
def test_strip_narration_does_not_guess(text):
    assert maintenance.strip_narration(text) == text


@pytest.fixture()
def env(session_local, app_session_local):
    with patch("app.db.SessionLocal", app_session_local), session_local() as owner:
        yield owner


def _rec(db, user_id, analysis):
    db.add(
        Recommendation(
            user_id=user_id,
            ticker="KO",
            asset_type="STOCK",
            action="WATCH",
            reasoning=["x"],
            price_at_recommendation=60.0,
            ai_analysis=analysis,
        )
    )
    db.commit()


def _analyses(db):
    db.expire_all()
    return sorted(r.ai_analysis or "" for r in db.query(Recommendation).all())


def test_a_dry_run_reports_but_changes_nothing(env):
    add_app_user(env, USER_ID)
    _rec(env, USER_ID, NARRATED)

    assert maintenance.clean_analyses(apply=False) == (1, 1)
    assert _analyses(env) == [NARRATED]


def test_apply_cleans_every_active_users_rows_and_skips_the_rest(env):
    add_app_user(env, USER_ID)
    add_app_user(env, OTHER_USER_ID)
    _rec(env, USER_ID, NARRATED)
    _rec(env, OTHER_USER_ID, CLEAN)
    _rec(env, OTHER_USER_ID, None)

    assert maintenance.clean_analyses(apply=True) == (1, 2)
    assert _analyses(env) == ["", CLEAN, CLEAN]
