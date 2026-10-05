import logging

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.agents.market_data import search_symbols
from app.auth.deps import get_current_user
from app.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market", tags=["market"], dependencies=[Depends(get_current_user)])

SEARCH_LIMIT_PER_MINUTE = 30  # per user: the field searches as you type, and Yahoo is shared


class SymbolMatchOut(BaseModel):
    symbol: str
    name: str
    type: str  # "STOCK" or "ETF"
    exchange: str


@router.get(
    "/search",
    response_model=list[SymbolMatchOut],
    dependencies=[Depends(rate_limiter("market_search", limit=SEARCH_LIMIT_PER_MINUTE))],
)
async def search(q: str = Query(min_length=2, max_length=60)) -> list[dict[str, str]]:
    try:
        return await search_symbols(q)
    except Exception as exc:
        # Search is a convenience: when Yahoo is down the field falls back to typing a ticker.
        logger.warning("symbol search failed: %s", type(exc).__name__)
        return []
