from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.admin.service import AdminError
from app.claude_keys import KeyEncryptionError, check_master_secret  # noqa: F401
from app.config import settings
from app.db import check_runtime_role, engine
from app.routers import (
    admin,
    analysis,
    backtest,
    chat,
    market,
    me,
    memory,
    portfolio,
    preferences,
)
from app.snapshots import PriceUnavailable
from app.usage import KIND_LABELS, UsageLimitExceeded


def docs_kwargs(app_env: str) -> dict[str, Any]:
    """In production the interactive docs and the OpenAPI schema are not served."""
    if app_env == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Web process only: the release command and the one-off job never go through this startup.
    if settings.app_env == "production":
        with engine.connect() as conn:
            check_runtime_role(conn)
        check_master_secret()
    yield


app = FastAPI(title="Trading Agent API", lifespan=lifespan, **docs_kwargs(settings.app_env))
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_allowed_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(portfolio.router)
app.include_router(market.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(preferences.router)
app.include_router(me.router)
app.include_router(me.active_router)
app.include_router(admin.router)


@app.exception_handler(AdminError)
def admin_error_handler(request: Request, exc: AdminError) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(UsageLimitExceeded)
def usage_limit_handler(request: Request, exc: UsageLimitExceeded) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    label = KIND_LABELS[exc.kind]
    detail = (
        f"Monthly limit reached ({exc.limit} {label} this month). "
        "Resets next month, or ask your admin to raise it."
    )
    return JSONResponse(status_code=429, content={"detail": detail})


@app.exception_handler(PriceUnavailable)
def price_unavailable_handler(request: Request, exc: PriceUnavailable) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
