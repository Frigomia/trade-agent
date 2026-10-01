from anthropic.types import ContentBlock


def final_text(content: list[ContentBlock]) -> str | None:
    """The model's closing answer only.

    With web search the reply interleaves narration ("Let me retry that query...") with tool
    calls and results. Only the run of text blocks after the last non-text block is the answer;
    one answer can be split across several text blocks (citations), so they are joined as-is.
    """
    answer: list[str] = []
    for block in reversed(content):
        if block.type != "text":
            break
        answer.append(block.text)
    text = "".join(reversed(answer)).strip()
    return text or None


def leading_text(content: list[ContentBlock]) -> str:
    """The text blocks before the first non-text block, joined as-is and stripped."""
    lead: list[str] = []
    for block in content:
        if block.type != "text":
            break
        lead.append(block.text)
    return "".join(lead).strip()
