"""저장소에서 `openai` 를 import 하는 유일한 파일. `LlmPort` 의 OpenAI 구현체.

벤더 교체의 폭발 반경을 이 파일 하나로 묶는다 (ADR-0001, ADR-0005). 다른 어떤 모듈도
`openai` 를 import 해서는 안 되며, CI 가 이를 검사한다.

여기서 하는 일은 초안 텍스트를 얻어 오는 것뿐이다. **초안의 옳고 그름은 판단하지 않는다** —
그 판단은 컴파일러의 몫이고, 어댑터가 미리 걸러내면 사람이 볼 진단이 사라진다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

import openai
from openai.types.responses.custom_tool_param import CustomToolParam
from openai.types.responses.response_custom_tool_call import ResponseCustomToolCall
from openai.types.responses.tool_choice_custom_param import ToolChoiceCustomParam

from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.infrastructure.llm.grammar import ebnf_to_lark
from dahaze_api.infrastructure.llm.prompts import (
    CHANGE_PLAN_SYSTEM_PROMPT,
    INTERVIEW_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_user_prompt,
)

# 초안 하나를 기다릴 한도. 저작 루프는 이 호출을 최대 `1 + MAX_REPAIR_ATTEMPTS` 번 하므로,
# 한 번의 한도가 곧 요청 전체 지연의 배수가 된다.
DEFAULT_TIMEOUT_S = 60.0
DEFAULT_PLANNING_TIMEOUT_S = 120.0

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

    def __init__(self, *, code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class OpenAiLlm:
    """OpenAI Responses API의 Lark constrained decoding으로 RSPDL 초안을 만든다."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        planning_timeout_s: float = DEFAULT_PLANNING_TIMEOUT_S,
        planning_reasoning_effort: str | None = "low",
    ) -> None:
        if not api_key:
            raise LlmNotConfigured("OPENAI_API_KEY 가 설정되지 않았다")
        self._model = model
        self._planning_timeout_s = planning_timeout_s
        self._planning_reasoning_effort = planning_reasoning_effort
        self._client = openai.AsyncOpenAI(api_key=api_key, timeout=timeout_s, max_retries=0)

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
        system_prompt: str | None = None,
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
            request: dict[str, Any] = {
                "model": self._model,
                "instructions": system_prompt or SYSTEM_PROMPT,
                "input": request_input,
                "tools": [tool],
                "tool_choice": tool_choice,
            }
            if self._model.startswith("gpt-5") and self._planning_reasoning_effort:
                request["reasoning"] = {"effort": self._planning_reasoning_effort}
            response = await self._client.responses.create(**request)
        except openai.OpenAIError as exc:
            raise _safe_error(exc) from exc

        for item in response.output:
            if isinstance(item, ResponseCustomToolCall) and item.name == _TOOL_NAME and item.input:
                # Lark는 OpenAI 전송 형식일 뿐이다. 출력은 RSPDL 전문이며, 이 어댑터가
                # 다시 해석하지 않고 Rust 컴파일러가 유일한 판정자로 처리한다.
                return item.input

        # 빈 응답을 빈 소스로 취급하면 "모듈 선언이 없다" 는 엉뚱한 진단이 나가고,
        # 사용자는 자기 지시가 잘못됐다고 오해하게 된다.
        raise LlmUnavailable(
            code="invalid_output",
            message="AI가 검증 가능한 RSPDL 출력을 만들지 못했다.",
            retryable=True,
        )

    async def interview_project(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        schema: dict[str, Any] = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "assistant_message",
                "policy_first_questions",
                "proposals",
                "decision_updates",
                "selected_subject",
                "unsupported",
            ],
            "properties": {
                "assistant_message": {"type": "string"},
                "policy_first_questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["question", "reason", "subject"],
                        "properties": {
                            "question": {"type": "string"},
                            "reason": {"type": "string"},
                            "subject": {"type": ["string", "null"]},
                        },
                    },
                },
                "proposals": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["title", "rationale", "subject"],
                        "properties": {
                            "title": {"type": "string"},
                            "rationale": {"type": "string"},
                            "subject": {"type": ["string", "null"]},
                        },
                    },
                },
                "decision_updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["decision_id", "title", "rationale"],
                        "properties": {
                            "decision_id": {"type": ["string", "null"]},
                            "title": {"type": "string"},
                            "rationale": {"type": "string"},
                        },
                    },
                },
                "selected_subject": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "required": ["kind", "id", "source_path", "stable_id", "label"],
                    "properties": {
                        "kind": {"type": "string"},
                        "id": {"type": "string"},
                        "source_path": {"type": ["string", "null"]},
                        "stable_id": {"type": ["string", "null"]},
                        "label": {"type": ["string", "null"]},
                    },
                },
                "unsupported": {"type": "array", "items": {"type": "string"}},
            },
        }
        return await self._structured(
            name="planning_interview",
            instructions=INTERVIEW_SYSTEM_PROMPT,
            context=context,
            schema=schema,
        )

    async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        schema: dict[str, Any] = {
            "type": "object",
            "additionalProperties": False,
            "required": ["summary", "questions", "changes"],
            "properties": {
                "summary": {"type": "string"},
                "questions": {"type": "array", "items": {"type": "string"}},
                "changes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["operation", "path", "title", "instruction"],
                        "properties": {
                            "operation": {"type": "string", "enum": ["upsert", "delete"]},
                            "path": {"type": "string", "maxLength": 500},
                            "title": {"type": ["string", "null"], "maxLength": 200},
                            "instruction": {
                                "type": ["string", "null"],
                                "maxLength": 2000,
                            },
                        },
                    },
                },
            },
        }
        return await self._structured(
            name="planning_change_plan",
            instructions=CHANGE_PLAN_SYSTEM_PROMPT,
            context=context,
            schema=schema,
        )

    async def _structured(
        self,
        *,
        name: str,
        instructions: str,
        context: Mapping[str, Any],
        schema: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        try:
            request: dict[str, Any] = {
                "model": self._model,
                "instructions": instructions,
                "input": json.dumps(context, ensure_ascii=False),
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": name,
                        "strict": True,
                        "schema": dict(schema),
                    }
                },
                "timeout": self._planning_timeout_s,
            }
            if self._model.startswith("gpt-5") and self._planning_reasoning_effort:
                request["reasoning"] = {"effort": self._planning_reasoning_effort}
            response = await self._client.responses.create(**request)
        except openai.OpenAIError as exc:
            raise _safe_error(exc) from exc
        try:
            value = json.loads(response.output_text)
        except (TypeError, json.JSONDecodeError) as exc:
            raise LlmUnavailable(
                code="invalid_output",
                message="AI가 구조화된 기획 응답을 만들지 못했다.",
                retryable=True,
            ) from exc
        if not isinstance(value, Mapping):
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 기획 응답의 형식이 올바르지 않다.",
                retryable=True,
            )
        return value

    async def close(self) -> None:
        await self._client.close()


def _safe_error(exc: openai.OpenAIError) -> LlmUnavailable:
    if isinstance(exc, openai.AuthenticationError):
        return LlmUnavailable(
            code="auth", message="AI 제공자 인증을 확인해야 한다.", retryable=False
        )
    if isinstance(exc, openai.RateLimitError):
        return LlmUnavailable(code="rate_limit", message="AI 요청 한도를 초과했다.", retryable=True)
    if isinstance(exc, openai.APITimeoutError):
        return LlmUnavailable(code="timeout", message="AI 응답 시간이 초과됐다.", retryable=True)
    if isinstance(exc, openai.BadRequestError):
        detail = str(exc).lower()
        parameter = str(getattr(exc, "param", "")).lower()
        if "schema" in detail or "schema" in parameter or "format" in parameter:
            return LlmUnavailable(
                code="config",
                message="서버의 AI 구조화 응답 형식 설정을 확인해야 한다.",
                retryable=False,
            )
        return LlmUnavailable(
            code="config",
            message="설정한 AI 모델이 필요한 구조화 출력 또는 문법 제약을 지원하지 않는다.",
            retryable=False,
        )
    return LlmUnavailable(
        code="provider_failure", message="AI 제공자가 요청을 처리하지 못했다.", retryable=True
    )
