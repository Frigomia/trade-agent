from unittest.mock import MagicMock

from app.agents.text import final_text, leading_text


def _block(kind: str, text: str | None = None):
    block = MagicMock()
    block.type = kind
    if text is not None:
        block.text = text
    return block


def test_final_text_drops_narration_before_tool_calls():
    content = [
        _block("text", "Good, that worked. Let me retry the other queries."),
        _block("server_tool_use"),
        _block("web_search_tool_result"),
        _block("text", "Now I have enough to write it."),
        _block("server_tool_use"),
        _block("web_search_tool_result"),
        _block("text", "## Second opinion\n\nSolid results"),
        _block("text", ", sentiment positive."),
    ]

    assert final_text(content) == "## Second opinion\n\nSolid results, sentiment positive."


def test_final_text_is_none_when_there_is_no_closing_text():
    assert final_text([_block("text", "narration"), _block("web_search_tool_result")]) is None
    assert final_text([]) is None


def test_leading_text_is_the_text_before_the_first_tool_block():
    content = [
        _block("text", "You hold "),
        _block("text", "10 shares. "),
        _block("server_tool_use"),
        _block("text", "## From the web"),
    ]

    assert leading_text(content) == "You hold 10 shares."


def test_leading_text_is_empty_when_content_starts_with_a_tool_block():
    assert leading_text([_block("server_tool_use"), _block("text", "x")]) == ""
    assert leading_text([]) == ""
