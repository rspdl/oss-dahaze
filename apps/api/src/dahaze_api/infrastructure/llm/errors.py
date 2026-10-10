"""LLM 경로의 오류."""

from __future__ import annotations


class LlmError(Exception):
    """LLM 경로의 실패."""


class LlmNotConfigured(LlmError):
    """자격증명이 없어 이 배포에서는 AI 기능을 쓸 수 없다.

    설정 누락은 요청 실패지 서버 고장이 아니다. 그래서 import 나 startup 이 아니라 호출
    시점에 난다 — LLM 을 쓰지 않는 배포에서도 나머지 API 는 정상 동작해야 한다.
    """


class LlmUnavailable(LlmError):
    """상류 API 가 응답하지 않거나 쓸 수 없는 응답을 줬다."""

    def __init__(self, *, code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
