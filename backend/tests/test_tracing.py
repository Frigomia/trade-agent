import asyncio
import inspect
import json
from unittest.mock import MagicMock

import httpx2 as httpx
import pytest
from anthropic import Anthropic
from langchain_core.tracers.langchain import wait_for_all_tracers
from langgraph.graph import END, START, StateGraph
from langsmith import Client

from app import tracing
from app.agents import research
from app.config import Settings, settings

API_KEY = "sk-ant-api03-" + "a" * 40


@pytest.fixture
def recording(monkeypatch):
    client = Client(
        api_key="test-langsmith-key",
        api_url="http://localhost:1984",
        auto_batch_tracing=False,
        anonymizer=tracing.sanitize,
        info={},
    )
    requests = []

    def record(self, method, url, *, request_kwargs=None, **kwargs):
        requests.append((method, json.loads(request_kwargs["data"])))

    monkeypatch.setattr(Client, "request_with_retries", record)
    monkeypatch.setattr(tracing, "get_tracing_client", lambda: client)
    monkeypatch.setattr(settings, "langsmith_project", "tracing-test")
    yield client, requests
    wait_for_all_tracers()
    client.flush(timeout=5)
    client.close()


def _runs(recording):
    client, requests = recording
    wait_for_all_tracers()
    client.flush(timeout=5)
    runs = {}
    for _method, payload in requests:
        runs.setdefault(payload["id"], {}).update(payload)
    return list(runs.values())


def test_nested_graph_threads_parallel_llm_usage_and_research_client_copy(recording):
    calls = []

    def respond(request):
        assert (
            request.headers.get("authorization") == f"Bearer {API_KEY}"
            or request.headers.get("x-api-key") == API_KEY
        )
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "claude-sonnet-5",
                "stop_reason": "tool_use",
                "stop_sequence": None,
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool_test",
                        "name": "record_research",
                        "input": {"answer": "cited research"},
                    }
                ],
                "usage": {"input_tokens": 12, "output_tokens": 4},
            },
        )

    sdk = Anthropic(
        api_key=API_KEY, http_client=httpx.Client(transport=httpx.MockTransport(respond))
    )

    async def extract(state):
        results = await asyncio.gather(
            *(
                research._extract(sdk, "Research prompt", {"ticker": ticker}, {"type": "object"})
                for ticker in ("AAA", "BBB")
            )
        )
        return {"results": results}

    graph = StateGraph(dict)
    graph.add_node("research", extract)
    graph.add_edge(START, "research")
    graph.add_edge("research", END)
    compiled = graph.compile()

    @tracing.traced("test.job")
    async def job():
        return await compiled.ainvoke({"client": sdk, "user_id": "private-user-id"})

    try:
        result = asyncio.run(job())
        assert result["results"] == [{"answer": "cited research"}] * 2
        runs = _runs(recording)
        parent = next(run for run in runs if run["name"] == "test.job")
        graph_run = next(run for run in runs if run["name"] == "LangGraph")
        assert graph_run["parent_run_id"] == parent["id"]
        llms = [run for run in runs if run["run_type"] == "llm"]
        extracts = [run for run in runs if run["name"] == "research.extract"]
        assert len(llms) == len(extracts) == len(calls) == 2
        assert {run["parent_run_id"] for run in llms} == {run["id"] for run in extracts}
        assert all(run["trace_id"] == parent["id"] for run in runs)
        assert all(run["outputs"]["usage_metadata"]["total_tokens"] == 16 for run in llms)
        assert all(
            run["inputs"]["messages"][0] == {"role": "system", "content": "Research prompt"}
            for run in llms
        )
        exported = json.dumps(recording[1])
        assert API_KEY not in exported
        assert "private-user-id" not in exported
    finally:
        sdk.close()


def test_sanitizes_prompts_outputs_metadata_and_raw_errors(recording, monkeypatch):
    monkeypatch.setattr(settings, "tavily_api_key", "unusual-tavily-credential")

    @tracing.traced("test.failure")
    async def fail(client, user_id, data):
        raise ValueError("private provider failure unusual-tavily-credential")

    with pytest.raises(ValueError, match="private provider failure"):
        asyncio.run(
            fail(
                object(),
                "private-user",
                {
                    "prompt": f"A secret: {API_KEY}; unusual-tavily-credential",
                    "authorization": "Bearer private-authorization",
                    "nested": {"ciphertext": "private-ciphertext"},
                },
            )
        )
    runs = _runs(recording)
    failed = next(run for run in runs if run["name"] == "test.failure")
    assert failed["error"] == "[error details omitted]"
    exported = json.dumps(recording[1])
    for value in (
        API_KEY,
        "unusual-tavily-credential",
        "private-user",
        "private-ciphertext",
        "private-authorization",
        "private provider failure",
    ):
        assert value not in exported
    assert tracing.sanitize({"metadata": {"api_key": API_KEY}}) == {"metadata": {}}
    assert API_KEY not in json.dumps(tracing.sanitize({"output": API_KEY}))


def test_metadata_only_mode_hides_payloads(recording, monkeypatch):
    client, _ = recording
    monkeypatch.setattr(client, "_hide_inputs", True)
    monkeypatch.setattr(client, "_hide_outputs", True)

    @tracing.traced("test.hidden")
    async def hidden(prompt):
        return {"answer": "private-output"}

    assert asyncio.run(hidden("private-input")) == {"answer": "private-output"}
    run = _runs(recording)[0]
    assert run["inputs"] == run["outputs"] == {}


def test_disabled_and_missing_key_never_construct_client(monkeypatch):
    constructor = MagicMock()
    monkeypatch.setattr(tracing, "Client", constructor)

    @tracing.traced("test.disabled")
    async def unchanged():
        return 42

    assert asyncio.run(unchanged()) == 42
    monkeypatch.setattr(settings, "langsmith_tracing", True)
    monkeypatch.setattr(settings, "langsmith_api_key", None)
    tracing.get_tracing_client.cache_clear()
    assert asyncio.run(unchanged()) == 42
    constructor.assert_not_called()


def test_settings_load_dotenv_without_shell_exports(tmp_path, monkeypatch):
    for name in ("LANGSMITH_TRACING", "LANGSMITH_API_KEY", "LANGSMITH_PROJECT"):
        monkeypatch.delenv(name, raising=False)
    dotenv = tmp_path / "tracing.env"
    dotenv.write_text(
        "LANGSMITH_TRACING=true\nLANGSMITH_API_KEY=test-key\nLANGSMITH_PROJECT=test-project\n"
    )
    loaded = Settings(_env_file=dotenv)
    assert loaded.langsmith_tracing
    assert loaded.langsmith_api_key == "test-key"
    assert loaded.langsmith_project == "test-project"
    assert "test-key" not in repr(loaded)


def test_export_failure_preserves_result_and_original_exception(recording, monkeypatch):
    client, _ = recording
    monkeypatch.setattr(
        Client, "request_with_retries", MagicMock(side_effect=ConnectionError("offline"))
    )

    @tracing.traced("test.offline")
    async def operation(fail=False):
        if fail:
            raise ValueError("original failure")
        return "complete"

    assert asyncio.run(operation()) == "complete"
    with pytest.raises(ValueError, match="original failure"):
        asyncio.run(operation(True))


def test_flush_is_bounded_and_does_not_mask_errors(recording, monkeypatch):
    client, _ = recording
    flush = MagicMock(side_effect=ConnectionError("offline"))
    with monkeypatch.context() as patch:
        patch.setattr(Client, "flush", flush)
        asyncio.run(tracing.flush_traces())
        flush.assert_called_once_with(timeout=5.0)


def test_instrumentation_failure_keeps_original_provider_client(recording, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(
        tracing, "wrap_anthropic", MagicMock(side_effect=AttributeError("SDK changed"))
    )
    assert tracing.trace_anthropic(client) is client
    client.messages.create.assert_not_called()


def test_invalid_arguments_fail_before_creating_a_coroutine():
    @tracing.traced("test.signature")
    async def operation():
        return 42

    assert inspect.iscoroutinefunction(operation)
    with pytest.raises(TypeError):
        operation("unexpected argument")
