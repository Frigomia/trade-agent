import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents import context, market_data, news
from app.analysis import fundamental, recommend, technical
from app.db import SessionLocal

logger = logging.getLogger(__name__)


class AnalysisState(TypedDict):
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
    db = SessionLocal()
    try:
        built_context = await context.build_context(
            db, state["ticker"], state["asset_type"], state["action"], state["reasoning"]
        )
    except Exception:
        logger.exception("build_context failed for %s", state["ticker"])
        built_context = None
    finally:
        db.close()
    return {"context": built_context}


async def news_agent(state: AnalysisState) -> dict[str, Any]:
    if state["action"] is None or state["action"] == "HOLD":
        return {"ai_analysis": None}
    ai_analysis = await news.run_news_agent(
        state["ticker"], state["action"], state["reasoning"], state["context"]
    )
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


async def run_graph_for_ticker(ticker: str, asset_type: str, is_held: bool) -> AnalysisState:
    app_graph = build_graph()
    initial_state: AnalysisState = {
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
    }
    result: AnalysisState = await app_graph.ainvoke(initial_state)
    return result
