import logging
import uuid
from typing import Any, TypedDict

from anthropic import Anthropic
from langgraph.graph import END, START, StateGraph
from starlette.concurrency import run_in_threadpool

from app.agents import context, market_data, news
from app.analysis import fundamental, recommend, technical
from app.claude_keys import is_key_problem, mark_needs_attention
from app.db import scoped_session

logger = logging.getLogger(__name__)


class AnalysisState(TypedDict):
    user_id: uuid.UUID
    ticker: str
    asset_type: str
    is_held: bool
    quote: dict[str, Any]
    fundamentals: dict[str, Any]
    fundamental_score: int | None
    technical_signal: str
    action: str | None
    suggested_position_pct: float | None
    reasoning: list[str]
    context: str | None
    ai_analysis: str | None
    client: Anthropic | None


async def fetch_data(state: AnalysisState) -> dict[str, Any]:
    quote = await market_data.fetch_quote_and_history(state["ticker"])
    fundamentals_data: dict[str, Any] = {}
    if state["asset_type"] == "STOCK":
        fundamentals_data = await market_data.fetch_fundamentals(state["ticker"])
    return {"quote": quote, "fundamentals": fundamentals_data}


def fundamental_agent(state: AnalysisState) -> dict[str, Any]:
    if state["asset_type"] != "STOCK":
        return {"fundamental_score": None}
    fundamentals = state["fundamentals"]
    if not fundamentals or all(value is None for value in fundamentals.values()):
        return {"fundamental_score": None}
    score = fundamental.score_fundamentals(fundamentals)
    return {"fundamental_score": score}


def technical_agent(state: AnalysisState) -> dict[str, Any]:
    signal = technical.score_technical(state["quote"]["closes"])
    return {"technical_signal": signal}


def synthesizer(state: AnalysisState) -> dict[str, Any]:
    action, suggested_position_pct, reasoning = recommend.synthesize(
        asset_type=state["asset_type"],
        is_held=state["is_held"],
        fundamental_score=state["fundamental_score"],
        technical_signal=state["technical_signal"],
    )
    return {
        "action": action,
        "suggested_position_pct": suggested_position_pct,
        "reasoning": reasoning,
    }


async def context_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"context": None}
    try:
        with scoped_session(state["user_id"]) as db:
            built_context = await context.build_context(
                db,
                state["user_id"],
                state["ticker"],
                state["asset_type"],
                state["action"],
                state["reasoning"],
            )
    except Exception:
        logger.exception("build_context failed for %s", state["ticker"])
        built_context = None
    return {"context": built_context}


async def news_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"ai_analysis": None}
    # The web second opinion is optional colour on top of an already-computed recommendation, so a
    # failure here (billing, rate limit, outage) must not discard the whole ticker's result.
    try:
        ai_analysis = await news.run_news_agent(
            state["ticker"],
            state["action"],
            state["reasoning"],
            state["context"],
            client=state["client"],
        )
    except Exception as exc:
        # Anthropic rejected the caller's own key (revoked, invalid, or out of credit): flag it so
        # the screen asks for a reconnect. The server key (client is None) is never flagged.
        if state["client"] is not None and is_key_problem(exc):
            await run_in_threadpool(mark_needs_attention, state["user_id"])
        logger.warning("Web second opinion failed for %s: %s", state["ticker"], type(exc).__name__)
        ai_analysis = None
    return {"ai_analysis": ai_analysis}


def build_graph() -> Any:
    graph = StateGraph(AnalysisState)
    graph.add_node("fetch_data", fetch_data)
    graph.add_node("fundamental_agent", fundamental_agent)
    graph.add_node("technical_agent", technical_agent)
    graph.add_node("synthesizer", synthesizer)
    graph.add_node("context_agent", context_agent)
    graph.add_node("news_agent", news_agent)

    graph.add_edge(START, "fetch_data")
    graph.add_edge("fetch_data", "fundamental_agent")
    graph.add_edge("fetch_data", "technical_agent")
    graph.add_edge("fundamental_agent", "synthesizer")
    graph.add_edge("technical_agent", "synthesizer")
    graph.add_edge("synthesizer", "context_agent")
    graph.add_edge("context_agent", "news_agent")
    graph.add_edge("news_agent", END)

    return graph.compile()


async def run_graph_for_ticker(
    user_id: uuid.UUID,
    ticker: str,
    asset_type: str,
    is_held: bool,
    # client=None means "the server's own Claude key (admin only)". Callers acting for a regular
    # user (for example a scheduled analysis command) must pass that user's client.
    client: Anthropic | None = None,
) -> AnalysisState:
    app_graph = build_graph()
    initial_state: AnalysisState = {
        "user_id": user_id,
        "ticker": ticker,
        "asset_type": asset_type,
        "is_held": is_held,
        "quote": {},
        "fundamentals": {},
        "fundamental_score": None,
        "technical_signal": "NEUTRAL",
        "action": None,
        "suggested_position_pct": None,
        "reasoning": [],
        "context": None,
        "ai_analysis": None,
        "client": client,
    }
    result: AnalysisState = await app_graph.ainvoke(initial_state)
    return result
