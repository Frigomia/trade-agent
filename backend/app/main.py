from fastapi import FastAPI

from app.routers import portfolio

app = FastAPI(title="Trading Agent API")
app.include_router(portfolio.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
