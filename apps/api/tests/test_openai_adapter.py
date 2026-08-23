"""OpenAI Responses API grammar constrained decoding 어댑터 테스트."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from openai.types.responses.response_custom_tool_call import ResponseCustomToolCall

from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.infrastructure.llm.grammar import (
    EbnfConversionError,
    ebnf_to_lark,
    is_complete_lark_document,
)
from dahaze_api.infrastructure.llm.grammars import (
    GRAMMAR_RSPDL_VERSION,
    load_rspdl_grammar,
)
from dahaze_api.infrastructure.llm.openai_adapter import LlmUnavailable, OpenAiLlm
from dahaze_api.infrastructure.llm.prompts import PROMPT_RSPDL_VERSION, SYSTEM_PROMPT
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


def test_prompt_grammar_and_compiler_versions_move_together() -> None:
    assert GRAMMAR_RSPDL_VERSION == PROMPT_RSPDL_VERSION
    assert LocalRspdlCompiler().runtime.rspdl_version == GRAMMAR_RSPDL_VERSION


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


def test_local_lark_validation_rejects_an_incomplete_terminal_prefix() -> None:
    definition = ebnf_to_lark(load_rspdl_grammar())
    complete = "@모듈 재고(inventory)\n"

    assert is_complete_lark_document(definition, complete)
    assert not is_complete_lark_document(definition, complete + "재")


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
    assert "temperature" not in request


async def test_incomplete_grammar_prefix_is_rejected() -> None:
    incomplete_call = ResponseCustomToolCall(
        call_id="call-incomplete",
        input="@모듈 재고(inventory)\n\n재",
        name="emit_rspdl_document",
        type="custom_tool_call",
    )

    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(
            return_value=SimpleNamespace(output=[incomplete_call])
        )
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        with pytest.raises(LlmUnavailable, match="CFG 전체"):
            await llm.draft_document(
                instruction="재고 모듈을 만든다.",
                current_text=None,
                diagnostics=(),
                grammar=load_rspdl_grammar(),
            )

    assert create.await_count == 2


async def test_complete_grammar_retry_is_returned() -> None:
    expected = "@모듈 재고(inventory)\n"
    incomplete_call = ResponseCustomToolCall(
        call_id="call-incomplete",
        input=expected + "재",
        name="emit_rspdl_document",
        type="custom_tool_call",
    )
    complete_call = ResponseCustomToolCall(
        call_id="call-complete",
        input=expected,
        name="emit_rspdl_document",
        type="custom_tool_call",
    )

    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        create = AsyncMock(
            side_effect=[
                SimpleNamespace(output=[incomplete_call]),
                SimpleNamespace(output=[complete_call]),
            ]
        )
        client_type.return_value.responses.create = create
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        actual = await llm.draft_document(
            instruction="재고 모듈을 만든다.",
            current_text=None,
            diagnostics=(),
            grammar=load_rspdl_grammar(),
        )

    assert actual == expected
    assert create.await_count == 2
    retry_request = create.await_args_list[1].kwargs
    assert "전송 문법 검증 오류" in retry_request["input"]
    assert incomplete_call.input in retry_request["input"]


async def test_missing_target_custom_tool_call_is_not_treated_as_empty_source() -> None:
    with patch("dahaze_api.infrastructure.llm.openai_adapter.openai.AsyncOpenAI") as client_type:
        client_type.return_value.responses.create = AsyncMock(
            return_value=SimpleNamespace(output=[])
        )
        llm = OpenAiLlm(api_key="test-key", model="gpt-5-nano")

        with pytest.raises(LlmUnavailable, match="custom tool"):
            await llm.draft_document(
                instruction="빈 응답을 만든다.",
                current_text=None,
                diagnostics=(),
                grammar=load_rspdl_grammar(),
            )
