import re
import uuid

from app.main import app
from tests.auth_support import OTHER_USER_ID, add_app_user, auth_headers

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
# The only routes an invited (not yet active) user may reach.
INVITEE_ALLOWED = {("GET", "/me"), ("POST", "/me/accept"), ("GET", "/health"), ("POST", "/health")}


def _operations():
    """(METHOD, schema path, concrete path) for every operation, via the OpenAPI schema (see
    test_routes_require_auth.py for why not app.routes)."""
    for route_path, operations in app.openapi()["paths"].items():
        path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), route_path)
        for method in sorted(HTTP_METHODS & operations.keys()):
            yield method.upper(), route_path, path


def test_every_admin_route_is_403_for_an_active_non_admin(client):
    checked = 0
    for method, route_path, path in _operations():
        if not route_path.startswith("/admin/"):
            continue
        response = client.request(method, path)
        assert response.status_code == 403, f"{method} {route_path} is reachable by a non-admin"
        checked += 1
    assert checked >= 7  # guards against the loop silently checking nothing


def test_an_invited_user_is_403_everywhere_except_the_signup_routes(client, db_session):
    add_app_user(db_session, OTHER_USER_ID, status="invited")
    headers = auth_headers(OTHER_USER_ID)
    checked = 0
    for method, route_path, path in _operations():
        if (method, route_path) in INVITEE_ALLOWED or route_path == "/health":
            continue
        response = client.request(method, path, headers=headers)
        assert response.status_code == 403, f"{method} {route_path} is reachable while invited"
        checked += 1
    assert checked > 20
