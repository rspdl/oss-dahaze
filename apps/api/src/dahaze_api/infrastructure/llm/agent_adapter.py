"""`AgentLlmPort` 의 OpenAI Responses API 구현체 (ADR-0005).

대화 기록은 dahaze DB 의 항목에서 매 호출마다 다시 만든다. 공급자의 대화 저장
(`previous_response_id`)을 쓰지 않는다 — 승인 대기 뒤 재개, worker 교체, 공급자 교체가
전부 같은 기록으로 동작해야 한다.

쓰기 도구의 `content` 에 문법 제약을 걸지 않는다. 문법은 시스템 프롬프트로 알려주고,
판정은 컴파일러가 한다 (ADR-0005 v4).
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import openai

from dahaze_api.domain.agent import (
    AgentContext,
    AgentItem,
    AgentStep,
    ItemKind,
    ToolCall,
    ToolSpec,
)
from dahaze_api.infrastructure.llm.errors import LlmNotConfigured, LlmUnavailable
from dahaze_api.infrastructure.llm.grammars import load_rspdl_ebnf
from dahaze_api.infrastructure.llm.prompts import build_agent_instructions

DEFAULT_AGENT_TIMEOUT_S = 120.0


def to_input(items: Sequence[AgentItem]) -> list[dict[str, Any]]:
    """대화 항목 → Responses API 입력.

    도구 결과의 `changes`(파일 전후 원문)는 싣지 않는다. 화면용 기록이고, 모델에게는 도구
    출력만으로 충분하다. 넣으면 같은 원문이 입력에 두 번 들어간다.
    """
    converted: list[dict[str, Any]] = []
    for item in items:
        payload = item.payload
        if item.kind is ItemKind.USER_MESSAGE:
            converted.append({"role": "user", "content": str(payload["text"])})
        elif item.kind is ItemKind.ASSISTANT_MESSAGE:
            converted.append({"role": "assistant", "content": str(payload["text"])})
        elif item.kind is ItemKind.TOOL_CALL:
            converted.append(
                {
                    "type": "function_call",
                    "call_id": str(payload["call_id"]),
                    "name": str(payload["name"]),
                    "arguments": json.dumps(payload.get("arguments") or {}, ensure_ascii=False),
                }
            )
        elif item.kind is ItemKind.TOOL_RESULT:
            converted.append(
                {
                    "type": "function_call_output",
                    "call_id": str(payload["call_id"]),
                    "output": json.dumps(
                        {"ok": payload.get("ok"), "output": payload.get("output")},
                        ensure_ascii=False,
                    ),
                }
            )
    return converted


def to_tools(tools: Sequence[ToolSpec]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": spec.name,
            "description": spec.description,
            "parameters": dict(spec.parameters),
            # 선택 인자가 있어 strict 스키마(모든 속성 필수)를 쓰지 않는다.
            "strict": False,
        }
        for spec in tools
    ]


def parse_arguments(raw: str) -> dict[str, Any]:
    """모델이 보낸 인자 JSON. 깨졌으면 빈 인자로 두어 도구가 "인자가 필요하다" 를 돌려주게 한다."""
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


class OpenAiAgentLlm:
    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        timeout_s: float = DEFAULT_AGENT_TIMEOUT_S,
        reasoning_effort: str | None = "low",
    ) -> None:
        if not api_key:
            raise LlmNotConfigured("OPENAI_API_KEY 가 설정되지 않았다")
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._client = openai.AsyncOpenAI(api_key=api_key, timeout=timeout_s, max_retries=1)

    @property
    def model(self) -> str:
        return self._model

    async def close(self) -> None:
        await self._client.close()

    async def step(
        self,
        *,
        context: AgentContext,
        items: Sequence[AgentItem],
        tools: Sequence[ToolSpec],
        allow_tools: bool,
        on_text: Callable[[str], Awaitable[None]],
    ) -> AgentStep:
        request: dict[str, Any] = {
            "model": self._model,
            "instructions": build_agent_instructions(
                project_name=context.project_name,
                planning=context.planning_profile,
                grammar=load_rspdl_ebnf(),
            ),
            "input": to_input(items),
            # 기록에 도구 호출이 있으면 도구 정의가 있어야 한다. 도구를 못 쓰게 할 때는
            # 정의는 두고 선택만 막는다.
            "tools": to_tools(tools),
            "tool_choice": "auto" if allow_tools else "none",
            "stream": True,
            "store": False,
        }
        if self._model.startswith("gpt-5") and self._reasoning_effort:
            request["reasoning"] = {"effort": self._reasoning_effort}

        try:
            stream = await self._client.responses.create(**request)
            response: Any = None
            async for event in stream:
                if event.type == "response.output_text.delta":
                    await on_text(event.delta)
                elif event.type == "response.completed":
                    response = event.response
                elif event.type in ("response.failed", "response.incomplete", "error"):
                    raise LlmUnavailable(
                        code="provider_failure",
                        message="AI 응답을 끝까지 받지 못했다.",
                        retryable=True,
                    )
        except openai.APITimeoutError as exc:
            raise LlmUnavailable(
                code="timeout", message="AI 응답이 시간 안에 오지 않았다.", retryable=True
            ) from exc
        except openai.APIError as exc:
            raise LlmUnavailable(
                code="provider_failure", message=f"AI 호출이 실패했다: {exc}", retryable=True
            ) from exc

        if response is None:
            raise LlmUnavailable(
                code="provider_failure", message="AI 응답이 비어 있다.", retryable=True
            )
        calls = tuple(
            ToolCall(
                call_id=str(output.call_id),
                name=str(output.name),
                arguments=parse_arguments(str(output.arguments)),
            )
            for output in response.output
            if getattr(output, "type", None) == "function_call"
        )
        return AgentStep(text=str(response.output_text or ""), tool_calls=calls)
