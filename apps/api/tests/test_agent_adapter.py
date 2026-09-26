"""OpenAI 에이전트 어댑터. 네트워크 없이 요청 모양과 스트림 해석을 본다."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from dahaze_api.application.agent_tools import TOOL_SPECS
from dahaze_api.domain.agent import AgentContext, AgentItem, ItemKind
from dahaze_api.infrastructure.llm import LlmNotConfigured, LlmUnavailable
from dahaze_api.infrastructure.llm.agent_adapter import (
    OpenAiAgentLlm,
    parse_arguments,
    to_input,
    to_tools,
)

NOW = datetime(2026, 9, 26, tzinfo=UTC)


def item(kind: ItemKind, **payload: Any) -> AgentItem:
    return AgentItem(
        id=uuid4(),
        session_id=uuid4(),
        turn_id=None,
        seq=1,
        kind=kind,
        payload=payload,
        created_at=NOW,
    )


def test_items_become_responses_input_without_file_texts() -> None:
    converted = to_input(
        [
            item(ItemKind.USER_MESSAGE, text="만들어 줘"),
            item(ItemKind.TOOL_CALL, call_id="c1", name="add", arguments={"name": "a.rspdl"}),
            item(
                ItemKind.TOOL_RESULT,
                call_id="c1",
                name="add",
                ok=True,
                output={"path": "/a.rspdl"},
                changes=[{"text_after": "아주 긴 원문"}],
            ),
            item(ItemKind.ASSISTANT_MESSAGE, text="만들었어요"),
        ]
    )

    assert converted[0] == {"role": "user", "content": "만들어 줘"}
    assert converted[1] == {
        "type": "function_call",
        "call_id": "c1",
        "name": "add",
        "arguments": '{"name": "a.rspdl"}',
    }
    assert converted[2]["type"] == "function_call_output"
    assert "아주 긴 원문" not in converted[2]["output"]
    assert converted[3] == {"role": "assistant", "content": "만들었어요"}


def test_tool_specs_are_function_tools() -> None:
    tools = to_tools(TOOL_SPECS)
    assert {t["name"] for t in tools} == {
        "ls",
        "read",
        "search",
        "fetch",
        "grep",
        "compile",
        "mkdir",
        "add",
        "edit",
        "mv",
        "delete",
        "commit",
    }
    assert all(t["type"] == "function" and t["parameters"]["type"] == "object" for t in tools)


@pytest.mark.parametrize("raw", ["", "not json", "[1, 2]"])
def test_broken_arguments_become_empty(raw: str) -> None:
    assert parse_arguments(raw) == {}


def test_missing_key_is_not_configured() -> None:
    with pytest.raises(LlmNotConfigured):
        OpenAiAgentLlm(api_key=None, model="gpt-5.4-mini")


class _Responses:
    def __init__(self, events: list[Any]) -> None:
        self.events = events
        self.request: dict[str, Any] = {}

    async def create(self, **request: Any) -> AsyncIterator[Any]:
        self.request = request

        async def stream() -> AsyncIterator[Any]:
            for event in self.events:
                yield event

        return stream()


def _llm(events: list[Any]) -> tuple[OpenAiAgentLlm, _Responses]:
    llm = OpenAiAgentLlm(api_key="sk-test", model="gpt-5.4-mini")
    responses = _Responses(events)
    llm._client = SimpleNamespace(responses=responses)  # type: ignore[assignment]
    return llm, responses


async def test_step_streams_text_and_parses_tool_calls() -> None:
    completed = SimpleNamespace(
        output_text="읽을게요",
        output=[
            SimpleNamespace(type="message"),
            SimpleNamespace(
                type="function_call", call_id="c1", name="read", arguments='{"path": "/a.rspdl"}'
            ),
        ],
    )
    llm, responses = _llm(
        [
            SimpleNamespace(type="response.output_text.delta", delta="읽을"),
            SimpleNamespace(type="response.output_text.delta", delta="게요"),
            SimpleNamespace(type="response.completed", response=completed),
        ]
    )
    deltas: list[str] = []

    async def on_text(delta: str) -> None:
        deltas.append(delta)

    step = await llm.step(
        context=AgentContext(project_name="재고", planning_profile=False),
        items=[item(ItemKind.USER_MESSAGE, text="a 읽어 줘")],
        tools=TOOL_SPECS,
        allow_tools=True,
        on_text=on_text,
    )

    assert deltas == ["읽을", "게요"]
    assert step.text == "읽을게요"
    assert [(c.call_id, c.name, dict(c.arguments)) for c in step.tool_calls] == [
        ("c1", "read", {"path": "/a.rspdl"})
    ]
    assert responses.request["tool_choice"] == "auto"
    assert responses.request["store"] is False
    assert "재고" in responses.request["instructions"]


async def test_step_without_tools_keeps_definitions_but_blocks_choice() -> None:
    completed = SimpleNamespace(output_text="잠겨 있어요", output=[])
    llm, responses = _llm([SimpleNamespace(type="response.completed", response=completed)])

    async def on_text(_: str) -> None:
        return None

    await llm.step(
        context=AgentContext(project_name="재고", planning_profile=False),
        items=[],
        tools=TOOL_SPECS,
        allow_tools=False,
        on_text=on_text,
    )
    assert responses.request["tool_choice"] == "none"
    assert responses.request["tools"]


async def test_failed_stream_is_unavailable() -> None:
    llm, _ = _llm([SimpleNamespace(type="response.failed")])

    async def on_text(_: str) -> None:
        return None

    with pytest.raises(LlmUnavailable):
        await llm.step(
            context=AgentContext(project_name="", planning_profile=False),
            items=[],
            tools=TOOL_SPECS,
            allow_tools=True,
            on_text=on_text,
        )
