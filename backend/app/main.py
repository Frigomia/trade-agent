from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.admin.service import AdminError
from app.routers import analysis, backtest, chat, me, memory, portfolio, preferences

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(preferences.router)
app.include_router(me.router)


@app.exception_handler(AdminError)
def admin_error_handler(request: Request, exc: AdminError) -> JSONResponse:
    """Services raise domain errors; this is the one place they become HTTP responses."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
