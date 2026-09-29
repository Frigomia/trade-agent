from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.admin.service import AdminError
from app.config import settings
from app.routers import admin, analysis, backtest, chat, me, memory, portfolio, preferences
from app.usage import KIND_LABELS, UsageLimitExceeded

app = FastAPI(title="Trading Agent API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_allowed_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(portfolio.router)
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
