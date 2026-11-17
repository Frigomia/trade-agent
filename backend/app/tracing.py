"""Optional, best-effort LangSmith tracing shared by HTTP and scheduled agents."""

import asyncio
import inspect
import logging
from collections.abc import Callable, Coroutine
from dataclasses import fields, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache, wraps
from typing import Any, ParamSpec, TypeVar, cast
from uuid import UUID

from anthropic import Anthropic
from langsmith import Client, traceable, tracing_context
from langsmith.anonymizer import create_secret_anonymizer
from langsmith.wrappers import wrap_anthropic
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)
P = ParamSpec("P")
R = TypeVar("R")
_SECRET_FIELDS = {
    "client",
    "db",
    "http",
    "key",
    "api_key",
    "authorization",
    "password",
    "secret",
    "token",
    "ciphertext",
    "user_id",
    "row",
    "progress",
    "semaphore",
}
_scrub_secrets = create_secret_anonymizer(max_depth=None)


def _safe_value(value: Any, depth: int = 0) -> Any:
    if depth > 30:
        return "[omitted]"
    if isinstance(value, dict):
        return {
            str(key): "[error details omitted]" if key == "error" else _safe_value(item, depth + 1)
            for key, item in value.items()
            if str(key).lower() not in _SECRET_FIELDS
        }
    if isinstance(value, (list, tuple)):
        return [_safe_value(item, depth + 1) for item in value]
    if isinstance(value, BaseModel):
        return _safe_value(value.model_dump(), depth + 1)
    if is_dataclass(value) and not isinstance(value, type):
        return _safe_value(
            {field.name: getattr(value, field.name) for field in fields(value)}, depth + 1
        )
    if isinstance(value, str):
        # Also catch configured credentials whose formats are not known to the SDK.
        for name in type(settings).model_fields:
            if any(
                part in name for part in ("api_key", "secret", "token", "database_url", "redis_url")
            ):
                secret = getattr(settings, name)
                if isinstance(secret, str) and secret:
                    value = value.replace(secret, "[redacted]")
        return value
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (UUID, Decimal, date, datetime)):
        return str(value)
    # Never serialize SDK clients, sessions or arbitrary objects via repr/__dict__.
    return f"<{type(value).__name__}>"


def sanitize(data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = _scrub_secrets(_safe_value(data))
    return result


@lru_cache(maxsize=1)
def get_tracing_client() -> Client | None:
    if not settings.langsmith_tracing:
        return None
    if not settings.langsmith_api_key:
        logger.warning("LangSmith tracing disabled: LANGSMITH_API_KEY is missing")
        return None
    try:
        return Client(
            api_key=settings.langsmith_api_key,
            api_url=settings.langsmith_endpoint,
            workspace_id=settings.langsmith_workspace_id or None,
            anonymizer=sanitize,
            hide_inputs=settings.langsmith_hide_inputs,
            hide_outputs=settings.langsmith_hide_outputs,
            timeout_ms=5000,
        )
    except Exception as exc:
        logger.warning("LangSmith initialization failed (%s)", type(exc).__name__)
        return None


def traced(
    name: str,
) -> Callable[[Callable[P, Coroutine[Any, Any, R]]], Callable[P, Coroutine[Any, Any, R]]]:
    def decorate(
        function: Callable[P, Coroutine[Any, Any, R]],
    ) -> Callable[P, Coroutine[Any, Any, R]]:
        signature = inspect.signature(function)
        instrumented = cast(
            Callable[P, Coroutine[Any, Any, R]],
            traceable(name=name, process_inputs=sanitize)(function),
        )

        async def invoke(*args: P.args, **kwargs: P.kwargs) -> R:
            client = get_tracing_client()
            # Explicitly disable ambient SDK tracing when our safe client is unavailable.
            with tracing_context(
                enabled=client is not None,
                client=client,
                project_name=settings.langsmith_project,
                tags=[settings.app_env],
            ):
                return await instrumented(*args, **kwargs)

        @inspect.markcoroutinefunction
        @wraps(function)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> Coroutine[Any, Any, R]:
            # Keep Python's immediate TypeError for invalid calls, before creating a coroutine.
            signature.bind(*args, **kwargs)
            return invoke(*args, **kwargs)

        return wrapped

    return decorate


def trace_anthropic(client: Anthropic) -> Anthropic:
    tracing_client = get_tracing_client()
    if tracing_client is None:
        return client
    # Copies share the HTTP transport; wrapping a copy avoids stacking wrappers on shared clients.
    try:
        return wrap_anthropic(client.copy(), tracing_extra={"client": tracing_client})
    except Exception as exc:
        logger.warning("LangSmith Anthropic instrumentation failed (%s)", type(exc).__name__)
        return client


async def flush_traces() -> None:
    client = get_tracing_client()
    if client is not None:
        try:
            await asyncio.to_thread(client.flush, timeout=5.0)
        except Exception as exc:
            logger.warning("LangSmith flush failed (%s)", type(exc).__name__)
