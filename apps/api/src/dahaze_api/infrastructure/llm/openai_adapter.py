"""저장소에서 `openai` 를 import 하는 유일한 파일. `LlmPort` 의 OpenAI 구현체.

벤더 교체의 폭발 반경을 이 파일 하나로 묶는다 (ADR-0001, ADR-0005). 다른 어떤 모듈도
`openai` 를 import 해서는 안 되며, CI 가 이를 검사한다.

여기서 하는 일은 초안 텍스트를 얻어 오는 것뿐이다. **초안의 옳고 그름은 판단하지 않는다** —
그 판단은 컴파일러의 몫이고, 어댑터가 미리 걸러내면 사람이 볼 진단이 사라진다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import openai
from openai.types.responses.custom_tool_param import CustomToolParam
from openai.types.responses.response_custom_tool_call import ResponseCustomToolCall
from openai.types.responses.tool_choice_custom_param import ToolChoiceCustomParam

from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.infrastructure.llm.grammar import ebnf_to_lark, is_complete_lark_document
from dahaze_api.infrastructure.llm.prompts import SYSTEM_PROMPT, build_user_prompt

# 초안 하나를 기다릴 한도. 저작 루프는 이 호출을 최대 `1 + MAX_REPAIR_ATTEMPTS` 번 하므로,
# 한 번의 한도가 곧 요청 전체 지연의 배수가 된다.
DEFAULT_TIMEOUT_S = 60.0

# 문법 디코더가 완성된 terminal 접두사에서 너무 일찍 끝내는 생성 편차만 한 번 더 시도한다.
# 네트워크/API 오류와 컴파일 진단은 각각 호출자와 저작 유스케이스가 담당한다.
_MAX_TRANSPORT_ATTEMPTS = 2

_TOOL_NAME = "emit_rspdl_document"
_TOOL_DESCRIPTION = "Return the complete RSPDL document and no other text."


def _build_transport_retry_prompt(base_prompt: str, invalid_text: str) -> str:
    """CFG 접두사를 그대로 보여 주고 완결된 전문으로 다시 쓰게 한다."""

    return (
        f"{base_prompt}\n\n"
        "# 전송 문법 검증 오류\n\n"
        "직전 custom tool 입력은 전달한 CFG 전체를 만족하지 못한 접두사였다. "
        "마지막의 미완성 선언을 끝까지 완성하거나 제거하고, 완전한 RSPDL 파일 전문을 "
        "다시 출력한다.\n\n"
        f"```text\n{invalid_text}\n```"
    )


class LlmError(Exception):
    """LLM 경로의 실패. 저작 유스케이스는 이 예외를 잡지 않는다."""


class LlmNotConfigured(LlmError):
    """자격증명이 없어 이 배포에서는 저작 기능을 쓸 수 없다.

    설정 누락은 요청 실패지 서버 고장이 아니다. 그래서 import 나 startup 이 아니라
    호출 시점에 난다 — LLM 을 쓰지 않는 배포에서도 나머지 API 는 정상 동작해야 한다.
    """


class LlmUnavailable(LlmError):
    """상류 API 가 응답하지 않거나 쓸 수 없는 응답을 줬다."""


class OpenAiLlm:
    """OpenAI Responses API의 Lark constrained decoding으로 RSPDL 초안을 만든다."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        if not api_key:
            raise LlmNotConfigured("OPENAI_API_KEY 가 설정되지 않았다")
        self._model = model
        self._client = openai.AsyncOpenAI(api_key=api_key, timeout=timeout_s)

    @property
    def model(self) -> str:
        return self._model

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
        grammar: EbnfGrammar,
    ) -> str:
        lark_definition = ebnf_to_lark(grammar)
        tool: CustomToolParam = {
            "type": "custom",
            "name": _TOOL_NAME,
            "description": _TOOL_DESCRIPTION,
            "format": {
                "type": "grammar",
                "syntax": "lark",
                "definition": lark_definition,
            },
        }
        tool_choice: ToolChoiceCustomParam = {"type": "custom", "name": _TOOL_NAME}
        request_input = build_user_prompt(
            instruction=instruction,
            current_text=current_text,
            diagnostics=diagnostics,
        )

        saw_invalid_grammar_output = False
        for _attempt in range(_MAX_TRANSPORT_ATTEMPTS):
            try:
                response = await self._client.responses.create(
                    model=self._model,
                    instructions=SYSTEM_PROMPT,
                    input=request_input,
                    tools=[tool],
                    tool_choice=tool_choice,
                )
            except openai.OpenAIError as exc:
                raise LlmUnavailable(f"OpenAI 호출에 실패했다: {exc}") from exc

            saw_target_call = False
            invalid_text: str | None = None
            for item in response.output:
                if not (
                    isinstance(item, ResponseCustomToolCall)
                    and item.name == _TOOL_NAME
                    and item.input
                ):
                    continue
                saw_target_call = True
                if is_complete_lark_document(lark_definition, item.input):
                    return item.input
                saw_invalid_grammar_output = True
                invalid_text = item.input

            if not saw_target_call:
                break
            assert invalid_text is not None
            request_input = _build_transport_retry_prompt(request_input, invalid_text)

        if saw_invalid_grammar_output:
            raise LlmUnavailable(
                "OpenAI가 CFG 전체를 만족하지 않는 RSPDL 접두사를 반복해서 돌려주었다"
            )

        # 빈 응답을 빈 소스로 취급하면 "모듈 선언이 없다" 는 엉뚱한 진단이 나가고,
        # 사용자는 자기 지시가 잘못됐다고 오해하게 된다.
        raise LlmUnavailable("OpenAI 가 RSPDL custom tool 호출을 돌려주지 않았다")
