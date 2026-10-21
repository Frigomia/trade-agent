from datetime import date

from app.portfolio_alerts import MAX_PER_KIND, HoldingFacts, PendingCall, build_alerts

TODAY = date(2026, 10, 21)


def hold(ticker="AURL", cost=100.0, price=100.0, earnings=None, name="Aurelle Foods"):
    return HoldingFacts(ticker=ticker, name=name, cost_basis=cost, price=price, earnings=earnings)


def test_a_pending_call_is_a_new_recommendation_alert_with_the_holdings_name():
    alerts = build_alerts([hold()], [PendingCall(id=7, ticker="AURL", action="TRIM")], TODAY)

    assert len(alerts) == 1
    assert alerts[0].kind == "new_recommendation"
    assert alerts[0].text == "New AI recommendation: TRIM"
    assert alerts[0].recommendation_id == 7
    assert alerts[0].name == "Aurelle Foods"


def test_a_call_on_a_ticker_that_is_not_held_has_no_name():
    alerts = build_alerts([], [PendingCall(id=1, ticker="WATCHED", action="WATCH")], TODAY)

    assert alerts[0].name is None


def test_earnings_inside_the_window_say_how_soon_and_carry_the_date():
    soon = [
        (date(2026, 10, 21), "Earnings today"),
        (date(2026, 10, 22), "Earnings tomorrow"),
        (date(2026, 10, 28), "Earnings in 7 days"),
    ]
    for day, text in soon:
        alerts = build_alerts([hold(earnings=day)], [], TODAY)
        assert [(a.kind, a.text, a.when) for a in alerts] == [("earnings_upcoming", text, day)]


def test_earnings_outside_the_window_or_in_the_past_or_unknown_make_no_alert():
    for day in (date(2026, 10, 29), date(2026, 10, 20), None):
        assert build_alerts([hold(earnings=day)], [], TODAY) == []


def test_a_move_of_five_points_or_more_against_the_cost_is_an_alert_in_either_direction():
    up = build_alerts([hold(price=106.8)], [], TODAY)
    down = build_alerts([hold(price=92.0)], [], TODAY)

    assert [(a.kind, a.text) for a in up] == [
        ("move_since_purchase", "Up 6.8% on your purchase cost")
    ]
    assert [(a.kind, a.text) for a in down] == [
        ("move_since_purchase", "Down 8.0% on your purchase cost")
    ]


def test_a_small_move_is_not_an_alert_and_the_threshold_itself_is():
    assert build_alerts([hold(price=104.9)], [], TODAY) == []
    assert len(build_alerts([hold(price=105.0)], [], TODAY)) == 1


def test_no_move_alert_without_a_known_cost_a_positive_cost_or_a_price():
    assert build_alerts([hold(cost=None, price=200.0)], [], TODAY) == []
    assert build_alerts([hold(cost=0.0, price=200.0)], [], TODAY) == []
    assert build_alerts([hold(cost=100.0, price=None)], [], TODAY) == []


def test_alerts_come_in_screen_order_calls_then_earnings_soonest_then_moves_largest():
    holdings = [
        hold("SMALL", price=106.0, earnings=date(2026, 10, 25)),
        hold("BIG", price=130.0, earnings=date(2026, 10, 22)),
    ]
    calls = [PendingCall(id=1, ticker="SMALL", action="ADD")]

    kinds = [(a.kind, a.ticker) for a in build_alerts(holdings, calls, TODAY)]

    assert kinds == [
        ("new_recommendation", "SMALL"),
        ("earnings_upcoming", "BIG"),
        ("earnings_upcoming", "SMALL"),
        ("move_since_purchase", "BIG"),
        ("move_since_purchase", "SMALL"),
    ]


def test_a_waiting_decision_is_never_cut_but_earnings_and_moves_are_capped():
    calls = [PendingCall(id=i, ticker=f"T{i}", action="WATCH") for i in range(MAX_PER_KIND + 15)]
    holdings = [
        hold(f"H{i}", price=130.0 + i, earnings=date(2026, 10, 22)) for i in range(MAX_PER_KIND + 5)
    ]

    alerts = build_alerts(holdings, calls, TODAY)

    kinds = [a.kind for a in alerts]
    assert kinds.count("new_recommendation") == MAX_PER_KIND + 15
    assert kinds.count("earnings_upcoming") == MAX_PER_KIND
    assert kinds.count("move_since_purchase") == MAX_PER_KIND


def test_two_pending_calls_on_one_ticker_give_one_alert_the_newest():
    calls = [  # newest first, as the router reads them
        PendingCall(id=9, ticker="AURL", action="TRIM"),
        PendingCall(id=3, ticker="AURL", action="BUY"),
        PendingCall(id=5, ticker="CSTR", action="ADD"),
    ]

    alerts = build_alerts([], calls, TODAY)

    assert [(a.ticker, a.recommendation_id) for a in alerts] == [("AURL", 9), ("CSTR", 5)]


def test_alert_text_never_carries_an_amount_of_money():
    alerts = build_alerts(
        [hold(price=130.0, earnings=date(2026, 10, 22))],
        [PendingCall(id=1, ticker="AURL", action="BUY")],
        TODAY,
    )

    for alert in alerts:
        assert not any(sign in alert.text for sign in ("$", "€", "£", "EUR", "USD"))
