import copy
from datetime import date, datetime, timedelta
from typing import Any

import pytest
from pydantic import ValidationError

from app import rls
from app.limits import MAX_HOLDINGS, MAX_PLANS, MAX_RECURRING
from app.recurring import today
from app.routers.portfolio import MAX_WATCHLIST
from app.schemas import EXPORT_FORMAT_VERSION
from app.schemas_import import IMPORT_LIST_LIMITS, ImportFile
from tests.auth_support import ROW_FACTORIES, USER_ID

AI_OUTPUT = (
    "recommendations",
    "chat_messages",
    "backtest_results",
    "scan_runs",
    "company_analyses",
)


def valid_file() -> dict[str, Any]:
    """One of everything, linked: trade 10 confirms the occurrence and is the plan line's trade."""
    return {
        "format_version": 1,
        "holdings": [{"ticker": "AAPL", "name": "Apple", "asset_type": "STOCK", "shares": 2}],
        "watchlist_items": [{"ticker": "MSFT", "asset_type": "STOCK"}],
        "trades": [
            {
                "id": 10,
                "date": "2024-01-31",
                "ticker": "AAPL",
                "action": "BUY",
                "shares": 1,
                "price": 100,
            }
        ],
        "portfolio_snapshots": [
            {
                "created_at": "2024-02-01T00:00:00",
                "total_market_value": 100,
                "total_cost_basis": 90,
                "cost_basis_complete": True,
            }
        ],
        "contribution_plans": [
            {
                "id": 40,
                "amount_eur": 500,
                "whole_shares": False,
                "total_before_eur": 0,
                "leftover_eur": 0,
                "lines": [
                    {
                        "placed_trade_id": 10,
                        "ticker": "AAPL",
                        "name": "Apple",
                        "amount_eur": 100,
                        "shares": 1,
                        "price_eur": 100,
                        "currency": "EUR",
                        "rate": 1,
                        "reason": "underweight",
                    }
                ],
            }
        ],
        "recurring_investments": [
            {
                "id": 30,
                "name": "Employer plan",
                "ticker": "AAPL",
                "asset_type": "STOCK",
                "amount": 400,
                "currency": "EUR",
                "start_date": "2024-01-31",
                "next_date": "2024-03-31",
                "status": "active",
            }
        ],
        "recurring_occurrences": [
            {
                "plan_id": 30,
                "scheduled_date": "2024-01-31",
                "ticker": "AAPL",
                "asset_type": "STOCK",
                "amount": 400,
                "currency": "EUR",
                "status": "confirmed",
                "trade_id": 10,
            }
        ],
        "investment_preferences": {"risk_tolerance": "moderate"},
    }


def refusal(data: dict[str, Any]) -> str:
    with pytest.raises(ValidationError) as caught:
        ImportFile.model_validate(data)
    return str(caught.value)


def seed_one_of_everything(db_session) -> None:
    """Every user table, with the trade really linked from an occurrence and a plan line."""
    rows = {name: ROW_FACTORIES[name](USER_ID) for name in rls.USER_TABLES}
    del rows["user_api_keys"]  # the client fixture already saved this person's key
    parents = ("trades", "recurring_investments", "contribution_plans")
    for name in parents:
        db_session.add(rows[name])
    db_session.flush()  # assigns the ids the children point at
    rows["recurring_investments"].next_date = date(
        2026, 2, 28
    )  # after its entry, as the job leaves it
    occurrence = rows["recurring_occurrences"]
    occurrence.plan_id = rows["recurring_investments"].id
    occurrence.status = "confirmed"
    occurrence.trade_id = rows["trades"].id
    line = rows["contribution_plan_lines"]
    line.plan_id = rows["contribution_plans"].id
    line.placed_trade_id = rows["trades"].id
    line.placed_at = datetime(2024, 1, 2)
    for name, row in rows.items():
        if name not in parents:
            db_session.add(row)
    db_session.commit()


def test_a_real_export_validates(client, db_session):
    seed_one_of_everything(db_session)

    body = client.get("/me/export").json()
    parsed = ImportFile.model_validate(body)

    assert parsed.format_version == EXPORT_FORMAT_VERSION
    for name in (
        "holdings",
        "watchlist_items",
        "trades",
        "portfolio_snapshots",
        "contribution_plans",
        "recurring_investments",
        "recurring_occurrences",
    ):
        assert len(getattr(parsed, name)) == 1, name
    assert parsed.investment_preferences is not None
    # the AI output, the profile and Telegram are in the export but not in the model
    for name in (*AI_OUTPUT, "profile", "telegram"):
        assert name in body
        assert name not in ImportFile.model_fields
    # the links survive as the file's own ids
    trade_id = parsed.trades[0].id
    assert parsed.recurring_occurrences[0].trade_id == trade_id
    assert parsed.contribution_plans[0].lines[0].placed_trade_id == trade_id
    assert parsed.recurring_occurrences[0].plan_id == parsed.recurring_investments[0].id


def test_a_real_export_without_the_ai_output_still_validates(client, db_session):
    seed_one_of_everything(db_session)
    body = client.get("/me/export").json()
    for name in AI_OUTPUT:
        del body[name]

    ImportFile.model_validate(body)


@pytest.mark.parametrize(
    "path",
    [
        ("holdings", 0),
        ("watchlist_items", 0),
        ("trades", 0),
        ("portfolio_snapshots", 0),
        ("contribution_plans", 0),
        ("contribution_plans", 0, "lines", 0),
        ("recurring_investments", 0),
        ("recurring_occurrences", 0),
        ("investment_preferences",),
    ],
)
def test_an_unknown_field_in_a_restored_list_is_rejected(path):
    data = valid_file()
    target: Any = data
    for step in path:
        target = target[step]
    target["role"] = "admin"

    assert "role" in refusal(data)


def test_a_made_up_field_in_a_plan_left_out_entry_is_rejected():
    data = valid_file()
    data["contribution_plans"][0]["left_out"] = [
        {"ticker": "X", "name": "X", "kind": "k", "reason": "r", "extra": 1}
    ]

    assert "extra" in refusal(data)


def test_ignored_top_level_keys_are_accepted():
    data = valid_file()
    data["profile"] = {"id": str(USER_ID), "role": "admin", "status": "active"}
    data["telegram"] = {"linked": True}
    data["recommendations"] = [{"anything": "goes"}]

    parsed = ImportFile.model_validate(data)

    assert "profile" not in ImportFile.model_fields
    assert not hasattr(parsed, "profile")
    assert "profile" not in parsed.model_dump()


def test_a_file_without_a_version_is_read_as_the_current_shape():
    data = valid_file()
    del data["format_version"]

    assert ImportFile.model_validate(data).format_version == EXPORT_FORMAT_VERSION


@pytest.mark.parametrize("empty", [{}, {"format_version": 1, "holdings": [], "trades": []}])
def test_nothing_to_restore_is_refused(empty):
    assert "This file has nothing to restore." in refusal(empty)


def test_preferences_alone_are_something_to_restore():
    ImportFile.model_validate({"investment_preferences": {"notes": "kept"}})


@pytest.mark.parametrize("version", [2, 0, "1", 1.5, True, None])
def test_a_future_version_is_refused(version):
    data = valid_file()
    data["format_version"] = version

    assert "different version" in refusal(data)


def test_a_future_version_with_a_new_shape_is_still_reported_as_a_version():
    assert "different version" in refusal({"format_version": 2, "holdings": "not a list"})


def test_duplicate_holding_tickers_are_refused():
    data = valid_file()
    data["holdings"].append({**data["holdings"][0], "ticker": "aapl"})  # same after upper-casing

    assert "same holding" in refusal(data)


def test_duplicate_watchlist_tickers_are_refused():
    data = valid_file()
    data["watchlist_items"].append(copy.deepcopy(data["watchlist_items"][0]))

    assert "same watchlist item" in refusal(data)


def test_duplicate_trade_ids_are_refused():
    data = valid_file()
    data["trades"].append(copy.deepcopy(data["trades"][0]))

    assert "share an id" in refusal(data)


def test_duplicate_occurrence_dates_are_refused():
    data = valid_file()
    data["recurring_occurrences"].append(
        {**data["recurring_occurrences"][0], "status": "scheduled", "trade_id": None}
    )

    assert "same date" in refusal(data)


def test_an_occurrence_pointing_at_a_missing_plan_is_refused():
    data = valid_file()
    data["recurring_occurrences"][0]["plan_id"] = 999

    assert "plan that is not in" in refusal(data)


def test_a_confirmed_occurrence_needs_its_trade_in_the_file():
    data = valid_file()
    data["recurring_occurrences"][0]["trade_id"] = None
    assert "has no trade" in refusal(data)

    data["recurring_occurrences"][0]["trade_id"] = 999
    assert "trade that is not in" in refusal(data)


def test_an_occurrence_that_is_not_confirmed_cannot_have_a_trade():
    data = valid_file()
    data["recurring_occurrences"][0]["status"] = "skipped"

    assert "not confirmed" in refusal(data)


def test_one_trade_cannot_confirm_two_occurrences():
    data = valid_file()
    data["recurring_occurrences"].append(
        {**data["recurring_occurrences"][0], "scheduled_date": "2024-02-29"}
    )

    assert "confirms two" in refusal(data)


def test_a_plan_line_pointing_at_a_missing_trade_is_refused():
    data = valid_file()
    data["contribution_plans"][0]["lines"][0]["placed_trade_id"] = 999

    assert "points at a trade that is not in" in refusal(data)


def test_an_active_recurring_plan_needs_its_next_date():
    data = valid_file()
    data["recurring_investments"][0]["next_date"] = None
    assert "no next date" in refusal(data)

    # the export blanks it for a plan that is not active
    data["recurring_investments"][0]["status"] = "paused"
    ImportFile.model_validate(data)


NOT_FINITE = [float("nan"), float("inf"), float("-inf")]
NUMBERS = [
    ("holdings", 0, "shares"),
    ("holdings", 0, "cost_basis"),
    ("holdings", 0, "target_weight"),
    ("trades", 0, "shares"),
    ("trades", 0, "price"),
    ("portfolio_snapshots", 0, "total_market_value"),
    ("contribution_plans", 0, "amount_eur"),
    ("contribution_plans", 0, "lines", 0, "rate"),
    ("contribution_plans", 0, "lines", 0, "placed_price"),
    ("recurring_investments", 0, "amount"),
    ("recurring_occurrences", 0, "amount"),
    ("investment_preferences", "monthly_contribution"),
    ("investment_preferences", "drift_threshold_pct"),
]


@pytest.mark.parametrize("value", NOT_FINITE)
@pytest.mark.parametrize("path", NUMBERS)
def test_nan_and_infinity_are_refused(path, value):
    data = valid_file()
    target: Any = data
    for step in path[:-1]:
        target = target[step]
    target[path[-1]] = value

    refusal(data)


def test_a_number_beyond_the_column_is_refused():
    data = valid_file()
    data["holdings"][0]["shares"] = 10**13

    refusal(data)


def _set(data: dict[str, Any], path: tuple, value: Any) -> None:
    target: Any = data
    for step in path[:-1]:
        target = target[step]
    target[path[-1]] = value


@pytest.mark.parametrize(
    "path",
    [
        ("recurring_investments", 0, "name"),  # the typed Label rule
        ("watchlist_items", 0, "currency"),
        ("contribution_plans", 0, "lines", 0, "currency"),
    ],
)
@pytest.mark.parametrize("bad", ["two\nlines", "nul\x00byte", "bell\x07"])
def test_control_characters_in_restricted_text_are_refused(path, bad):
    data = valid_file()
    data["watchlist_items"][0]["currency"] = "USD"
    _set(data, path, bad)

    refusal(data)


STORED_TEXT = [
    ("holdings", 0, "name"),
    ("holdings", 0, "sector"),
    ("holdings", 0, "industry"),
    ("watchlist_items", 0, "name"),
    ("watchlist_items", 0, "exchange"),
    ("contribution_plans", 0, "lines", 0, "name"),
    ("contribution_plans", 0, "notes"),
    ("contribution_plans", 0, "left_out"),
    ("contribution_plans", 0, "disclaimer"),
]


def _with_text(path: tuple, text: str) -> dict[str, Any]:
    data = valid_file()
    data["contribution_plans"][0]["left_out"] = [
        {"ticker": "X", "name": "n", "kind": "k", "reason": "r"}
    ]
    if path[-1] == "notes":
        value: Any = [text]
    elif path[-1] == "left_out":
        value = [{"ticker": text, "name": text, "kind": text, "reason": text}]
    else:
        value = text
    _set(data, path, value)
    return data


@pytest.mark.parametrize("path", STORED_TEXT)
def test_a_tab_or_newline_in_stored_text_imports(path):
    ImportFile.model_validate(_with_text(path, "Tab\there\nand a line\x07"))


@pytest.mark.parametrize("path", STORED_TEXT)
def test_a_nul_in_stored_text_is_refused(path):
    refusal(_with_text(path, "nul\x00byte"))


def test_a_nul_in_a_watchlist_note_or_preferences_notes_is_refused():
    data = valid_file()
    data["watchlist_items"][0]["note"] = "bad\x00note"
    refusal(data)

    data = valid_file()
    data["investment_preferences"]["notes"] = "bad\x00note"
    refusal(data)


def test_the_existing_input_rules_still_apply():
    for mutate in (
        lambda d: d["holdings"][0].update(ticker="../etc"),
        lambda d: d["holdings"][0].update(asset_type="CRYPTO"),
        lambda d: d["holdings"][0].update(target_weight=1.5),
        lambda d: d["trades"][0].update(action="HOLD"),
        lambda d: d["trades"][0].update(shares=0),
        lambda d: d["watchlist_items"][0].update(target_price_low=5),  # one end only
        lambda d: d["recurring_investments"][0].update(currency="euro"),
        lambda d: d["recurring_investments"][0].update(start_date="1999-12-31"),
        lambda d: d["recurring_investments"][0].update(frequency="hourly"),
        lambda d: d["investment_preferences"].update(drift_threshold_pct=80),
        lambda d: d["investment_preferences"].update(risk_tolerance="reckless"),
        lambda d: d["holdings"][0].update(isin="not-an-isin"),
    ):
        data = valid_file()
        mutate(data)
        refusal(data)


def test_the_preferences_automation_flags_are_accepted_from_the_file():
    data = valid_file()
    data["investment_preferences"].update(auto_analysis=True, auto_discovery=True)

    prefs = ImportFile.model_validate(data).investment_preferences

    assert prefs is not None
    assert prefs.auto_analysis is True and prefs.auto_discovery is True


def test_the_limits_agree_with_the_caps_the_app_already_has():
    assert IMPORT_LIST_LIMITS["watchlist_items"] == MAX_WATCHLIST
    assert MAX_HOLDINGS == 100
    assert MAX_PLANS == 120
    assert MAX_RECURRING == 100
    assert "recurring_investments" not in IMPORT_LIST_LIMITS


def minimal_plan(i: int) -> dict[str, Any]:
    return {
        "id": i + 1,
        "amount_eur": 500,
        "whole_shares": False,
        "total_before_eur": 0,
        "leftover_eur": 0,
        "lines": [],
    }


def minimal_recurring(i: int) -> dict[str, Any]:
    return {**valid_file()["recurring_investments"][0], "id": i + 1}


LIST_FACTORIES = {
    "holdings": lambda i: {
        "ticker": f"T{i}",
        "name": "x",
        "asset_type": "STOCK",
        "shares": 1,
    },
    "watchlist_items": lambda i: {"ticker": f"T{i}", "asset_type": "STOCK"},
    "trades": lambda i: {**valid_file()["trades"][0], "id": i + 1},
    "portfolio_snapshots": lambda i: valid_file()["portfolio_snapshots"][0],
    "contribution_plans": minimal_plan,
    "recurring_investments": minimal_recurring,
    "recurring_occurrences": lambda i: {
        **valid_file()["recurring_occurrences"][0],
        "scheduled_date": (date(2000, 1, 1) + timedelta(days=i)).isoformat(),
    },
}


# The words the screen shows (COUNT_LABELS in frontend/lib/importFile.ts), not the list names.
UI_WORDS = {
    "holdings": "holdings",
    "watchlist_items": "watchlist companies",
    "trades": "trades",
    "portfolio_snapshots": "saved daily values",
    "contribution_plans": "saved plans",
    "recurring_investments": "recurring plans",
    "recurring_occurrences": "recurring entries",
}


@pytest.mark.parametrize("name", sorted(LIST_FACTORIES))
def test_a_list_over_its_limit_is_refused(name):
    limits = {
        "holdings": MAX_HOLDINGS,
        "contribution_plans": MAX_PLANS,
        "recurring_investments": MAX_RECURRING,
        **IMPORT_LIST_LIMITS,
    }
    limit = limits[name]
    over = {name: [LIST_FACTORIES[name](i) for i in range(limit + 1)]}
    assert f"more {UI_WORDS[name]} than the app keeps ({limit})" in refusal(over)

    at_limit = {name: [LIST_FACTORIES[name](i) for i in range(limit)]}
    # at the limit the lists may still be refused for another reason (links), but not for size
    try:
        ImportFile.model_validate(at_limit)
    except ValidationError as exc:
        assert "than the app keeps" not in str(exc)


def test_a_plan_with_too_many_lines_is_refused():
    data = valid_file()
    line = data["contribution_plans"][0]["lines"][0]
    data["contribution_plans"][0]["lines"] = [line] * 201

    assert "more than 200 lines" in refusal(data)


def test_a_value_just_over_the_money_column_is_refused():
    data = valid_file()
    data["portfolio_snapshots"][0]["total_market_value"] = 99_999_999_999_999.99
    ImportFile.model_validate(data)

    data["portfolio_snapshots"][0]["total_market_value"] = 100_000_000_000_000
    assert "less than or equal" in refusal(data)
    data["portfolio_snapshots"][0]["total_market_value"] = 1e16
    refusal(data)


def test_an_occurrence_dated_in_the_future_is_refused():
    data = valid_file()
    data["recurring_investments"][0]["status"] = "paused"
    data["recurring_occurrences"][0]["scheduled_date"] = (today() + timedelta(days=1)).isoformat()
    assert "in the future" in refusal(data)

    data["recurring_occurrences"][0]["scheduled_date"] = today().isoformat()
    ImportFile.model_validate(data)


def test_an_occurrence_at_or_after_an_active_plans_next_date_is_refused():
    data = valid_file()  # plan 30 is active, next date 2024-03-31
    for day in ("2024-03-31", "2024-04-30"):
        data["recurring_occurrences"][0]["scheduled_date"] = day
        assert "on or after the next date" in refusal(data)

    data["recurring_occurrences"][0]["scheduled_date"] = "2024-03-30"
    ImportFile.model_validate(data)


def test_a_paused_plans_occurrences_may_be_dated_any_day_up_to_today():
    data = valid_file()
    data["recurring_investments"][0]["status"] = "paused"
    data["recurring_occurrences"][0]["scheduled_date"] = "2024-12-31"

    ImportFile.model_validate(data)


def estimated_file(status="posted"):
    data = valid_file()
    data["contribution_plans"] = []
    data["recurring_investments"][0].update(
        tracking_enabled=True,
        exchange="NMS",
        frequency="custom",
        interval_count=3,
        interval_unit="weeks",
        end_date="2099-12-31",
        next_date="2099-01-01",
    )
    data["recurring_occurrences"][0].update(
        id=20,
        status=status,
        effective_date="2024-01-31",
        quote_currency="USD",
        reference_price="100.000000",
        fx_rate="1.200000000000",
        fx_date="2024-01-30",
        pricing_source="Yahoo daily close",
        error=None,
        attempts=2,
        shares="1.000000",
        price="100.000000",
        trade_date="2024-01-31",
    )
    if status == "voided":
        data["trades"] = []
        data["recurring_occurrences"][0]["trade_id"] = None
    else:
        data["trades"][0].update(
            provenance="recurring_estimated" if status == "posted" else "reconciled",
            recurring_occurrence_id=20,
        )
    return data


@pytest.mark.parametrize("status", ["posted", "reconciled", "voided"])
def test_estimated_exports_validate(status):
    parsed = ImportFile.model_validate(estimated_file(status))
    assert parsed.recurring_occurrences[0].status == status
    assert parsed.recurring_investments[0].tracking_enabled
    assert parsed.recurring_investments[0].interval_count == 3


@pytest.mark.parametrize(
    "frequency,count,unit",
    [("weekly", 1, "weeks"), ("biweekly", 2, "weeks"), ("monthly", 1, "months")],
)
def test_import_recurring_cadences(frequency, count, unit):
    data = estimated_file()
    data["recurring_investments"][0]["frequency"] = frequency
    plan = ImportFile.model_validate(data).recurring_investments[0]
    assert (plan.interval_count, plan.interval_unit) == (count, unit)


@pytest.mark.parametrize(
    "path,value",
    [
        (("trades", 0, "recurring_occurrence_id"), 999),
        (("trades", 0, "recurring_occurrence_id"), None),
        (("trades", 0, "provenance"), "voided"),
        (("trades", 0, "provenance"), "manual"),
        (("trades", 0, "ticker"), "MSFT"),
        (("trades", 0, "action"), "SELL"),
        (("recurring_occurrences", 0, "trade_id"), 999),
        (("recurring_occurrences", 0, "fx_rate"), "NaN"),
        (("recurring_occurrences", 0, "reference_price"), -1),
        (("recurring_occurrences", 0, "attempts"), -1),
        (("recurring_investments", 0, "interval_count"), 0),
    ],
)
def test_estimated_import_rejects_invalid_metadata_and_links(path, value):
    data = estimated_file()
    _set(data, path, value)
    refusal(data)
