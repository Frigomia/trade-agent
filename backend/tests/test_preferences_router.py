from app.config import settings
from app.models import InvestmentPreferences


def test_get_preferences_returns_defaults_when_none_exist(client):
    response = client.get("/preferences")

    assert response.status_code == 200
    assert response.json() == {
        "risk_tolerance": None,
        "sector_avoid_list": [],
        "notes": None,
    }


def test_get_preferences_does_not_create_a_row(client, db_session):
    client.get("/preferences")
    client.get("/preferences")

    count = db_session.query(InvestmentPreferences).count()
    assert count == 0


def test_post_preferences_creates_row(client, db_session):
    response = client.post(
        "/preferences",
        json={
            "risk_tolerance": "aggressive",
            "sector_avoid_list": ["tobacco", "gambling"],
            "notes": "Prefer dividend growth stocks.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["risk_tolerance"] == "aggressive"
    assert body["sector_avoid_list"] == ["tobacco", "gambling"]
    assert body["notes"] == "Prefer dividend growth stocks."

    rows = db_session.query(InvestmentPreferences).filter_by(user_id=settings.default_user_id).all()
    assert len(rows) == 1


def test_post_preferences_twice_updates_same_row(client, db_session):
    client.post("/preferences", json={"risk_tolerance": "conservative"})
    client.post("/preferences", json={"risk_tolerance": "aggressive"})

    rows = db_session.query(InvestmentPreferences).filter_by(user_id=settings.default_user_id).all()
    assert len(rows) == 1
    assert rows[0].risk_tolerance == "aggressive"


def test_post_preferences_omitted_sector_avoid_list_defaults_to_empty(client):
    response = client.post("/preferences", json={"risk_tolerance": "moderate"})

    assert response.status_code == 200
    assert response.json()["sector_avoid_list"] == []


def test_post_preferences_rejects_invalid_risk_tolerance(client):
    response = client.post("/preferences", json={"risk_tolerance": "YOLO"})

    assert response.status_code == 422


def test_post_preferences_rejects_oversized_notes(client):
    response = client.post("/preferences", json={"notes": "x" * 2001})

    assert response.status_code == 422


def test_post_preferences_accepts_notes_at_max_length(client):
    response = client.post("/preferences", json={"notes": "x" * 2000})

    assert response.status_code == 200
