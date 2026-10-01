from collections.abc import Iterable

from anthropic.types import ContentBlock


def _text_run(blocks: Iterable[ContentBlock]) -> list[str]:
    """The text of the unbroken run of text blocks at the start of `blocks`."""
    run: list[str] = []
    for block in blocks:
        if block.type != "text":
            break
        run.append(block.text)
    return run


def final_text(content: list[ContentBlock]) -> str | None:
    """The model's closing answer only.

    With web search the reply interleaves narration ("Let me retry that query...") with tool
    calls and results. Only the run of text blocks after the last non-text block is the answer;
    one answer can be split across several text blocks (citations), so they are joined as-is.
    """
    text = "".join(reversed(_text_run(reversed(content)))).strip()
    return text or None


def leading_text(content: list[ContentBlock]) -> str:
    """The text blocks before the first non-text block, joined as-is and stripped."""
    return "".join(_text_run(content)).strip()
