from fastapi import FastAPI

from app.routers import analysis, backtest, portfolio

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
