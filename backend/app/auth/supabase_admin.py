"""Supabase Auth admin API: invite, ban, unban, delete users.

A small synchronous httpx client (routes are sync `def`). Every failure becomes one
SupabaseAdminError that carries no response text or exception message: those can echo keys,
hosts, and email addresses.
"""

import uuid
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import settings

REQUEST_TIMEOUT_SECONDS = 10.0
# Supabase takes Go duration units (hours at most); 876000h is 100 years, i.e. permanent.
BAN_FOREVER = "876000h"
UNBAN = "none"


class SupabaseAdminError(Exception):
    """A Supabase Auth admin call failed."""


class SupabaseUserExists(SupabaseAdminError):
    """The address is already a confirmed Supabase user."""


def _error_code(response: httpx.Response) -> str | None:
    try:
        data = response.json()
    except ValueError:
        return None
    if isinstance(data, dict):
        code = data.get("error_code") or data.get("code")
        return str(code) if code is not None else None
    return None


def _raise_for_status(response: httpx.Response) -> None:
    if not response.is_success:
        raise SupabaseAdminError(f"HTTP {response.status_code}")


class SupabaseAdmin:
    def __init__(
        self,
        base_url: str,
        secret_key: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._auth_url = f"{base_url.rstrip('/')}/auth/v1"
        self._secret_key = secret_key
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {"apikey": self._secret_key}
        # Legacy service_role keys are JWTs and also go in Authorization. New sb_secret_ keys
        # are not JWTs and must only be sent as the apikey.
        if not self._secret_key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self._secret_key}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS, transport=self._transport) as http:
                return http.request(
                    method,
                    f"{self._auth_url}{path}",
                    headers=self._headers(),
                    json=json,
                    params=params,
                )
        except (httpx.HTTPError, httpx.InvalidURL) as exc:
            raise SupabaseAdminError(type(exc).__name__) from None

    def invite(self, email: str, redirect_to: str | None) -> uuid.UUID:
        """Invites the address (re-sends if it is invited but unconfirmed) and returns its id."""
        params = {"redirect_to": redirect_to} if redirect_to else None
        response = self._request("POST", "/invite", json={"email": email}, params=params)
        if response.status_code == 422 and _error_code(response) == "email_exists":
            raise SupabaseUserExists("email_exists")
        _raise_for_status(response)
        try:
            return uuid.UUID(str(response.json()["id"]))
        except (ValueError, KeyError, TypeError):
            raise SupabaseAdminError("Unexpected invite response") from None

    def _set_ban(self, user_id: uuid.UUID, duration: str) -> None:
        response = self._request("PUT", f"/admin/users/{user_id}", json={"ban_duration": duration})
        _raise_for_status(response)

    def ban(self, user_id: uuid.UUID) -> None:
        self._set_ban(user_id, BAN_FOREVER)

    def unban(self, user_id: uuid.UUID) -> None:
        self._set_ban(user_id, UNBAN)

    def delete(self, user_id: uuid.UUID) -> None:
        response = self._request("DELETE", f"/admin/users/{user_id}")
        if response.status_code == 404:
            return  # already gone: exactly what a retry of a half-finished remove needs
        _raise_for_status(response)


def get_supabase_admin() -> SupabaseAdmin:
    """FastAPI dependency; tests override it with a fake."""
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(status_code=503, detail="User management not configured")
    return SupabaseAdmin(settings.supabase_url, settings.supabase_secret_key)
