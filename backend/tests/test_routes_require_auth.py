import re

from app.main import app

OPEN_PATHS = {"/health"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def test_every_route_except_health_requires_authentication(anon_client):
    # Enumerate through the OpenAPI schema: FastAPI >= 0.13x keeps included routers as lazy
    # `_IncludedRouter` objects, so `app.routes` no longer lists their APIRoutes.
    checked = 0
    for route_path, operations in app.openapi()["paths"].items():
        if route_path in OPEN_PATHS:
            continue
        # Fill path parameters with a placeholder; authentication must reject before it matters.
        path = re.sub(r"\{[^}]+\}", "1", route_path)
        for method in HTTP_METHODS & operations.keys():
            response = anon_client.request(method.upper(), path)
            assert response.status_code == 401, f"{method.upper()} {route_path} is not protected"
            checked += 1
    assert checked > 10  # guards against the loop silently checking nothing
