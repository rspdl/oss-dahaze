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
from dahaze_api.infrastructure.llm.grammar import ebnf_to_lark
from dahaze_api.infrastructure.llm.prompts import SYSTEM_PROMPT, build_user_prompt

# 초안 하나를 기다릴 한도. 저작 루프는 이 호출을 최대 `1 + MAX_REPAIR_ATTEMPTS` 번 하므로,
# 한 번의 한도가 곧 요청 전체 지연의 배수가 된다.
DEFAULT_TIMEOUT_S = 60.0

_TOOL_NAME = "emit_rspdl_document"
_TOOL_DESCRIPTION = "Return the complete RSPDL document and no other text."


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

        for item in response.output:
            if (
                isinstance(item, ResponseCustomToolCall)
                and item.name == _TOOL_NAME
                and item.input
            ):
                # Lark는 OpenAI 전송 형식일 뿐이다. 출력은 RSPDL 전문이며, 이 어댑터가
                # 다시 해석하지 않고 Rust 컴파일러가 유일한 판정자로 처리한다.
                return item.input

        # 빈 응답을 빈 소스로 취급하면 "모듈 선언이 없다" 는 엉뚱한 진단이 나가고,
        # 사용자는 자기 지시가 잘못됐다고 오해하게 된다.
        raise LlmUnavailable("OpenAI 가 RSPDL custom tool 호출을 돌려주지 않았다")
