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
from openai.types.chat import ChatCompletionMessageParam

from dahaze_api.infrastructure.llm.prompts import SYSTEM_PROMPT, build_user_prompt

# 초안 하나를 기다릴 한도. 저작 루프는 이 호출을 최대 `1 + MAX_REPAIR_ATTEMPTS` 번 하므로,
# 한 번의 한도가 곧 요청 전체 지연의 배수가 된다.
DEFAULT_TIMEOUT_S = 60.0

# RSPDL 은 결정론이 계약인 언어다. 같은 지시에 매번 다른 초안이 나오면 사용자는 재시도가
# 개선인지 운인지 구분할 수 없다.
DEFAULT_TEMPERATURE = 0.0

# 코드 펜스를 붙이지 말라고 프롬프트에 적어도 모델은 종종 붙인다. 그대로 컴파일러에 넣으면
# 첫 줄부터 문법 오류가 나고, 수리 시도 한 번이 통째로 낭비된다.
_FENCE = "```"


class LlmError(Exception):
    """LLM 경로의 실패. 저작 유스케이스는 이 예외를 잡지 않는다."""


class LlmNotConfigured(LlmError):
    """자격증명이 없어 이 배포에서는 저작 기능을 쓸 수 없다.

    설정 누락은 요청 실패지 서버 고장이 아니다. 그래서 import 나 startup 이 아니라
    호출 시점에 난다 — LLM 을 쓰지 않는 배포에서도 나머지 API 는 정상 동작해야 한다.
    """


class LlmUnavailable(LlmError):
    """상류 API 가 응답하지 않거나 쓸 수 없는 응답을 줬다."""


def _strip_fence(text: str) -> str:
    """모델이 감싼 코드 펜스를 벗긴다.

    RSPDL 소스 자체에는 백틱 세 개로 시작하는 줄이 없으므로, 첫 줄과 마지막 줄만 보고
    벗겨도 본문을 잘라낼 위험이 없다.
    """
    stripped = text.strip()
    if not stripped.startswith(_FENCE):
        return stripped

    lines = stripped.splitlines()
    if lines[-1].strip() == _FENCE:
        lines = lines[:-1]
    return "\n".join(lines[1:]).strip()


class OpenAiLlm:
    """OpenAI Chat Completions 로 RSPDL 초안을 만든다."""

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
    ) -> str:
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_user_prompt(
                    instruction=instruction,
                    current_text=current_text,
                    diagnostics=diagnostics,
                ),
            },
        ]

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                temperature=DEFAULT_TEMPERATURE,
            )
        except openai.OpenAIError as exc:
            raise LlmUnavailable(f"OpenAI 호출에 실패했다: {exc}") from exc

        content = response.choices[0].message.content if response.choices else None
        if content is None:
            # 빈 응답을 빈 소스로 취급하면 "모듈 선언이 없다" 는 엉뚱한 진단이 나가고,
            # 사용자는 자기 지시가 잘못됐다고 오해하게 된다.
            raise LlmUnavailable("OpenAI 가 본문 없는 응답을 돌려줬다")
        return _strip_fence(content)
