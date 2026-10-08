from decimal import Decimal as D

import pytest

from app.planner import Candidate, build_plan


def cand(ticker, value, target, *, price=100, held=None, call=None, currency="EUR", rate=1):
    return Candidate(
        ticker=ticker,
        name=ticker,
        held=(D(value) > 0 if held is None else held),
        current_value=D(value),
        target=None if target is None else D(str(target)),
        price_eur=D(price),
        currency=currency,
        rate=D(rate),
        call=call,
    )


def basic():
    # pool 4000 now, 4500 with the contribution: desired AAPL 1800, MSFT 1800, NVDA 900
    return [
        cand("AAPL", 1000, 0.4, price=200),
        cand("MSFT", 3000, 0.4, price=400),
        cand("NVDA", 0, 0.2, price=100),
    ]


def amounts(plan):
    return {line.ticker: line.amount_eur for line in plan.lines}


def test_the_split_follows_the_gaps_and_adds_up_to_the_cent():
    plan = build_plan(basic(), D("500"))
    assert amounts(plan) == {"AAPL": D("235.29"), "NVDA": D("264.71")}
    assert plan.leftover == D("0.00") and plan.total_before == D("4000")
    by = {line.ticker: line for line in plan.lines}
    assert by["AAPL"].shares == D("1.176") and by["NVDA"].shares == D("2.647")
    assert by["AAPL"].reason == "underweight" and by["NVDA"].reason == "new_position"
    assert round(float(by["AAPL"].weight_before), 4) == 0.25
    assert round(float(by["AAPL"].weight_after), 4) == 0.2745
    assert by["NVDA"].weight_before == D("0")


def test_lines_are_sorted_by_amount_then_ticker():
    plan = build_plan(basic(), D("500"))
    assert [line.ticker for line in plan.lines] == ["NVDA", "AAPL"]


def test_an_add_call_favours_a_ticker():
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call="ADD")  # gap 800 * 1.25 = 1000
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("263.16"), "NVDA": D("236.84")}
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call="BUY")
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("263.16"), "NVDA": D("236.84")}
    assert {ln.ticker: ln.reason for ln in build_plan(cands, D("500")).lines}["AAPL"] == "favoured"


@pytest.mark.parametrize("call", ["TRIM", "SELL"])
def test_a_trim_or_sell_call_gets_no_money_and_the_others_share_it(call):
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call=call)
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"NVDA": D("500.00")}
    assert any("AAPL" in n and call in n for n in plan.notes)


@pytest.mark.parametrize("call", ["HOLD", "WATCH", None])
def test_other_calls_change_nothing(call):
    cands = basic()
    cands[0] = cand("AAPL", 1000, 0.4, price=200, call=call)
    assert amounts(build_plan(cands, D("500"))) == {"AAPL": D("235.29"), "NVDA": D("264.71")}


def test_when_the_remaining_gaps_are_smaller_than_the_contribution_the_rest_goes_by_target_weight():
    cands = [cand("AAPL", 2000, 0.5, call="SELL"), cand("MSFT", 2000, 0.5)]
    # pool 4500, MSFT desired 2250 so its gap is 250; the other 250 follows the target weight
    assert amounts(build_plan(cands, D("500"))) == {"MSFT": D("500.00")}


def test_an_item_above_target_can_receive_only_the_remainder():
    cands = [cand("AAPL", 1000, 0.5, call="SELL"), cand("MSFT", 3000, 0.5)]
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"MSFT": D("500.00")}
    assert plan.lines[0].reason == "remainder"


def test_targets_that_do_not_add_up_to_one_are_normalised():
    cands = [cand("AAA", 0, 0.3), cand("BBB", 0, 0.3)]
    assert amounts(build_plan(cands, D("1000"))) == {"AAA": D("500.00"), "BBB": D("500.00")}


def test_a_holding_without_a_target_is_outside_the_pool():
    cands = basic() + [cand("OLD", 5000, None)]
    plan = build_plan(cands, D("500"))
    assert amounts(plan) == {"AAPL": D("235.29"), "NVDA": D("264.71")}
    assert plan.total_before == D("4000")


def test_a_target_of_zero_counts_as_no_target():
    cands = basic() + [cand("ZERO", 0, 0)]
    assert "ZERO" not in amounts(build_plan(cands, D("500")))


def test_nothing_with_a_target_gives_an_empty_plan_and_the_whole_amount_left():
    plan = build_plan([cand("AAPL", 1000, None)], D("500"))
    assert plan.lines == [] and plan.leftover == D("500") and plan.notes


def test_every_targeted_ticker_excluded_gives_an_empty_plan():
    cands = [cand("AAPL", 1000, 0.5, call="SELL"), cand("MSFT", 1000, 0.5, call="TRIM")]
    plan = build_plan(cands, D("500"))
    assert plan.lines == [] and plan.leftover == D("500")


@pytest.mark.parametrize("amount", ["0", "-5"])
def test_a_contribution_of_zero_or_less_gives_an_empty_plan(amount):
    plan = build_plan(basic(), D(amount))
    assert plan.lines == [] and plan.notes


def test_an_amount_that_does_not_divide_evenly_still_adds_up_exactly():
    cands = [cand("A", 0, 1), cand("B", 0, 1), cand("C", 0, 1)]
    plan = build_plan(cands, D("100"))
    assert sorted(ln.amount_eur for ln in plan.lines) == [D("33.33"), D("33.33"), D("33.34")]
    assert sum(ln.amount_eur for ln in plan.lines) == D("100.00")


@pytest.mark.parametrize("amount", ["0.01", "333.33", "1234.56", "999999.99"])
def test_the_lines_always_add_up_to_the_contribution(amount):
    cands = [cand("A", 700, 0.5), cand("B", 100, 0.3), cand("C", 0, 0.2)]
    plan = build_plan(cands, D(amount))
    assert sum(ln.amount_eur for ln in plan.lines) == D(amount)
    assert all(ln.amount_eur > 0 for ln in plan.lines)


def test_lines_under_the_minimum_are_merged_into_the_largest():
    cands = [cand("X", 0, 0.5), cand("Y", 0, 0.4), cand("Z", 0, 0.1)]
    plan = build_plan(cands, D("60"))  # raw 30 / 24 / 6: only X reaches 25
    assert amounts(plan) == {"X": D("60.00")}


def test_when_every_line_is_under_the_minimum_the_largest_takes_it_all():
    cands = [cand("X", 0, 0.5), cand("Y", 0, 0.3), cand("Z", 0, 0.2)]
    assert amounts(build_plan(cands, D("20"))) == {"X": D("20.00")}


def test_whole_shares_round_down_and_report_the_leftover():
    plan = build_plan(basic(), D("500"), whole_shares=True)
    assert amounts(plan) == {"AAPL": D("200.00"), "NVDA": D("200.00")}
    assert {ln.ticker: ln.shares for ln in plan.lines} == {"AAPL": D("1"), "NVDA": D("2")}
    assert plan.leftover == D("100.00")


def test_whole_shares_drop_a_line_that_cannot_buy_one_share():
    plan = build_plan([cand("BIG", 0, 1, price=150)], D("100"), whole_shares=True)
    assert plan.lines == [] and plan.leftover == D("100.00")
    assert any("BIG" in n for n in plan.notes)


def test_a_converted_price_is_used_for_the_shares():
    cands = [cand("US", 0, 1, price="80", currency="USD", rate="0.8")]
    line = build_plan(cands, D("160")).lines[0]
    assert (line.shares, line.currency, line.rate) == (D("2.000"), "USD", D("0.8"))


@pytest.mark.parametrize("amount", ["0.004", "0.015", "100.005"])
def test_a_sub_cent_amount_is_floored_to_whole_cents(amount):
    cands = [cand("A", 0, 1), cand("B", 0, 1), cand("C", 0, 1)]
    plan = build_plan(cands, D(amount))
    floored = D(amount).quantize(D("0.01"), rounding="ROUND_FLOOR")
    assert all(ln.amount_eur > 0 for ln in plan.lines)
    assert plan.leftover >= 0
    assert sum(ln.amount_eur for ln in plan.lines) + plan.leftover == floored


@pytest.mark.parametrize("price", [0, -5])
def test_an_unusable_price_is_skipped_with_a_note(price):
    cands = [cand("BAD", 0, 0.5, price=price), cand("OK", 0, 0.5)]
    plan = build_plan(cands, D("100"))
    assert amounts(plan) == {"OK": D("100.00")}
    assert all(ln.shares > 0 for ln in plan.lines)
    assert any("BAD" in n and "price" in n for n in plan.notes)


def test_all_unusable_prices_give_clean_wording():
    plan = build_plan([cand("BAD", 0, 0.5, price=0), cand("WORSE", 0, 0.5, price=-1)], D("100"))
    assert plan.lines == [] and plan.leftover == D("100.00")
    assert plan.notes[-1] == (
        "Every ticker with a target is excluded or unpriced, so nothing is proposed."
    )
    assert not any("TRIM or SELL" in n for n in plan.notes)
