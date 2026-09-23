"""OpenAI Responses API grammar constrained decoding 어댑터 테스트."""

from __future__ import annotations

import json
import re
from importlib import resources
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from openai.types.responses.response_custom_tool_call import ResponseCustomToolCall

from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.domain.rspdl import RspdlSource
from dahaze_api.infrastructure.llm.grammar import (
    EbnfConversionError,
    ebnf_to_lark,
)
from dahaze_api.infrastructure.llm.grammars import (
    GRAMMAR_RSPDL_VERSION,
    load_rspdl_grammar,
)
from dahaze_api.infrastructure.llm.openai_adapter import LlmUnavailable, OpenAiLlm
from dahaze_api.infrastructure.llm.prompts import PROMPT_RSPDL_VERSION, SYSTEM_PROMPT
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


def _passing_prompt_examples() -> list[str]:
    """프롬프트가 통과한다고 선언한 RSPDL 코드 블록만 꺼낸다."""

    markdown = (
        resources.files("dahaze_api.infrastructure.llm.prompts")
        .joinpath("examples_ko.md")
        .read_text(encoding="utf-8")
    )
    passing, _, _rejected = markdown.partition("# 거부되는 예시")
    sections = re.split(r"^## 예시 \d+.*$", passing, flags=re.MULTILINE)[1:]
    examples: list[str] = []

    for section in sections:
        source_lines: list[str] = []
        started = False
        for line in section.splitlines():
            if line.startswith("    "):
                started = True
                source_lines.append(line[4:])
            elif started and not line:
                source_lines.append("")
            elif started:
                break
        examples.append("\n".join(source_lines).rstrip() + "\n")

    return examples


def test_prompt_grammar_and_compiler_versions_move_together() -> None:
    assert GRAMMAR_RSPDL_VERSION == PROMPT_RSPDL_VERSION
    assert LocalRspdlCompiler().runtime.rspdl_version == GRAMMAR_RSPDL_VERSION


@pytest.mark.parametrize(
    "source",
    _passing_prompt_examples(),
    ids=("inventory", "expense-policy", "relations", "screen-calculation"),
)
async def test_passing_prompt_examples_match_grammar_and_compiler(source: str) -> None:
    outcome = await LocalRspdlCompiler().compile(
        [RspdlSource(path="prompt-example.rspdl", text=source)]
    )
    assert outcome.result["files"][0]["diagnostics"] == []


def test_canonical_ebnf_is_converted_to_lark_at_the_provider_boundary() -> None:
    lark = ebnf_to_lark(load_rspdl_grammar())

    assert lark.startswith("start: document\n")
    assert "document:" in lark
    assert "NEWLINE:" in lark
    assert "::=" not in lark
    assert not any(line.rstrip().endswith(";") for line in lark.splitlines())


def test_converter_preserves_semicolon_inside_a_regex() -> None:
    grammar = EbnfGrammar(
        name="semicolon",
        start_rule="document",
        definition="document ::= SEMICOLON ; SEMICOLON ::= /[;]/ ;",
    )

    assert "SEMICOLON: /[;]/" in ebnf_to_lark(grammar)


@pytest.mark.parametrize(
    ("definition", "message"),
    [
        ('document ::= "ok"', "';'"),
        ('document "ok" ;', "'::='"),
        ("document ::= ;", "비어 있는"),
    ],
)
def test_invalid_ebnf_fails_before_a_provider_request(definition: str, message: str) -> None:
    grammar = EbnfGrammar(name="invalid", start_rule="document", definition=definition)

    with pytest.raises(EbnfConversionError, match=message):
        ebnf_to_lark(grammar)


async def test_responses_api_receives_lark_custom_tool_and_returns_its_input() -> None:
    expected = "@모듈 재고(inventory)\n"
    wrong_call = ResponseCustomToolCall(
        call_id="call-wrong",
        input="ignored",
        name="other_tool",
        type="custom_tool_call",
    )
    rspdl_call = ResponseCustomToolCall(
        call_id="call-rspdl",
        input=expected,
        name="emit_rspdl_document",
        type="custom_tool_call",
    )

    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(return_value=SimpleNamespace(output=[wrong_call, rspdl_call]))
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        actual = await llm.draft_document(
            instruction="재고 모듈을 만든다.",
            current_text=None,
            diagnostics=(),
            grammar=load_rspdl_grammar(),
        )

    assert actual == expected
    assert create.await_args is not None
    request = create.await_args.kwargs
    assert request["model"] == "gpt-5-nano"
    assert request["instructions"] == SYSTEM_PROMPT
    assert "재고 모듈을 만든다." in request["input"]
    assert request["tool_choice"] == {
        "type": "custom",
        "name": "emit_rspdl_document",
    }
    tool = request["tools"][0]
    assert tool["type"] == "custom"
    assert tool["format"]["type"] == "grammar"
    assert tool["format"]["syntax"] == "lark"
    assert tool["format"]["definition"].startswith("start: document\n")
    assert request["reasoning"] == {"effort": "low"}
    assert "temperature" not in request


async def test_custom_tool_input_is_returned_without_lark_reinterpretation() -> None:
    expected = "@모듈 재고(inventory)\n\n재"
    incomplete_call = ResponseCustomToolCall(
        call_id="call-incomplete",
        input=expected,
        name="emit_rspdl_document",
        type="custom_tool_call",
    )

    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(return_value=SimpleNamespace(output=[incomplete_call]))
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        actual = await llm.draft_document(
            instruction="재고 모듈을 만든다.",
            current_text=None,
            diagnostics=(),
            grammar=load_rspdl_grammar(),
        )

    assert actual == expected
    assert create.await_count == 1


async def test_missing_target_custom_tool_call_is_not_treated_as_empty_source() -> None:
    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        client_type.return_value.responses.create = AsyncMock(
            return_value=SimpleNamespace(output=[])
        )
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        with pytest.raises(LlmUnavailable, match="검증 가능한 RSPDL"):
            await llm.draft_document(
                instruction="빈 응답을 만든다.",
                current_text=None,
                diagnostics=(),
                grammar=load_rspdl_grammar(),
            )


async def test_interview_uses_closed_strict_json_schema() -> None:
    payload: dict[str, Any] = {
        "assistant_message": "질문",
        "policy_first_questions": [],
        "proposals": [],
        "decision_updates": [],
        "selected_subject": None,
        "unsupported": [],
    }
    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(
            return_value=SimpleNamespace(output_text=json.dumps(payload, ensure_ascii=False))
        )
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-mini")

        actual = await llm.interview_project(context={"instruction": "정책을 정한다"})

    assert actual == payload
    assert create.await_args is not None
    request = create.await_args.kwargs
    schema = request["text"]["format"]["schema"]
    assert request["text"]["format"]["strict"] is True
    assert schema["additionalProperties"] is False
    assert schema["properties"]["decision_updates"]["items"]["additionalProperties"] is False
    assert schema["properties"]["selected_subject"]["additionalProperties"] is False
    assert request["timeout"] == 120.0
    assert request["reasoning"] == {"effort": "low"}


async def test_non_gpt5_structured_call_omits_reasoning_parameter() -> None:
    payload = {
        "summary": "질문 필요",
        "questions": ["범위는 무엇인가요?"],
        "changes": [],
    }
    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(return_value=SimpleNamespace(output_text=json.dumps(payload)))
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(
            api_key="test-key",
            model="gpt-4.1",
            planning_timeout_s=90,
            planning_reasoning_effort="low",
        )

        await llm.plan_project_changes(context={"instruction": "범위를 정한다"})

    assert create.await_args is not None
    request = create.await_args.kwargs
    assert request["timeout"] == 90
    assert "reasoning" not in request
