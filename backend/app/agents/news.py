import asyncio

from anthropic import Anthropic
from anthropic.types import Message

from app.agents.prompts import NEWS_AGENT_SYSTEM_PROMPT
from app.config import settings

_client: Anthropic | None = None


def _get_client() -> Anthropic | None:
    global _client
    if not settings.anthropic_api_key:
        return None
    if _client is None:
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


async def run_news_agent(ticker: str, action: str, reasoning: list[str]) -> str | None:
    client = _get_client()
    if client is None:
        return None

    quant_summary = "; ".join(reasoning)
    user_message = (
        f"Ticker: {ticker}\nQuantitative recommendation: {action}\n"
        f"Quantitative reasoning: {quant_summary}\n\n"
        "Search for recent news on this ticker and give a brief qualitative second opinion."
    )

    def _create() -> Message:
        return client.messages.create(
            model=settings.anthropic_model,
            max_tokens=4096,
            system=NEWS_AGENT_SYSTEM_PROMPT,
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
            messages=[{"role": "user", "content": user_message}],
        )

    response = await asyncio.to_thread(_create)

    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "\n".join(text_blocks) if text_blocks else None
