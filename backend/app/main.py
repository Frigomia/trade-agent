from fastapi import FastAPI

from app.routers import analysis, backtest, chat, memory, portfolio, preferences

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(backtest.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(preferences.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
