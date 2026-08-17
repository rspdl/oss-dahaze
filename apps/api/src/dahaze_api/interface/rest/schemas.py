"""REST 요청·응답 스키마. OpenAPI 계약의 원본이다 (ADR-0001)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SourceIn(BaseModel):
    """식별된 RSPDL 소스 하나."""

    path: str = Field(
        description="워크스페이스 안에서 소스를 식별하는 경로",
        examples=["inventory.rspdl"],
    )
    text: str = Field(description="RSPDL 소스 전문")


class CompileRequest(BaseModel):
    sources: list[SourceIn] = Field(min_length=1)


class CheckRequest(BaseModel):
    sources: list[SourceIn] = Field(min_length=1)
    data: dict[str, Any] = Field(description="제약·정책을 검사할 runtime record")


class FindModelRequest(BaseModel):
    source: SourceIn
    scope_per_model: int | None = Field(
        default=None,
        ge=1,
        description="모델별 가상 개체 수 상한. 작은 scope 의 UNSAT 은 전역 모순을 뜻하지 않는다.",
    )
    timeout_ms: int | None = Field(default=None, ge=1)


class AnalysisResponse(BaseModel):
    """컴파일러 응답 하나.

    `result` 는 RSPDL SDK 가 준 그대로다. 모양은 컴파일러가 소유하고
    `wire_schema_version` 으로 버전이 매겨진다 — dahaze 가 재작성하지 않는다 (ADR-0003).
    진단은 예외가 아니라 이 안에 담겨 온다.
    """

    kind: str = Field(description="compile | check | find_model")
    rspdl_version: str = Field(description="결과를 만든 컴파일러 버전")
    wire_schema_version: int
    locale: str
    result: dict[str, Any] = Field(description="RSPDL SDK 결과 원본")


class RspdlRuntimeResponse(BaseModel):
    """이 서버가 어떤 RSPDL 로 컴파일하는지.

    프론트가 문서에 기록된 target 버전과 비교해 불일치를 사용자에게 알릴 수 있게 한다.
    """

    rspdl_version: str
    wire_schema_version: int
    locale: str


class HealthResponse(BaseModel):
    status: str
    rspdl_version: str
