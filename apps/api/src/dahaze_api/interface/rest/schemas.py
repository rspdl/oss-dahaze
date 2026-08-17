"""REST 요청·응답 스키마. OpenAPI 계약의 원본이다 (ADR-0001)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

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


# --------------------------------------------------------------------- 인증


class AuthProvidersResponse(BaseModel):
    """설정된 로그인 제공자. 프론트가 버튼을 하드코딩하지 않게 한다."""

    providers: list[str]


class CurrentUserResponse(BaseModel):
    id: UUID
    display_name: str
    email: str | None
    avatar_url: str | None


# ------------------------------------------------------------------ 프로젝트


class CreateProjectRequest(BaseModel):
    slug: str = Field(
        min_length=1,
        max_length=100,
        description="URL 에 쓰이는 식별자. 소문자·숫자·하이픈",
        examples=["order-service"],
    )
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    default_rspdl_version: str | None = Field(
        default=None,
        description="새 문서가 기본으로 삼을 RSPDL 버전. 생략하면 서버의 컴파일러 버전",
    )


class ProjectResponse(BaseModel):
    id: UUID
    slug: str
    name: str
    description: str | None
    default_rspdl_version: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class ProjectMemberResponse(BaseModel):
    project_id: UUID
    user_id: UUID
    role: str = Field(description="owner | editor | viewer")


class AddMemberRequest(BaseModel):
    user_id: UUID
    role: str = Field(default="editor", description="owner | editor | viewer")


# ---------------------------------------------------------------------- 문서


class CreateDocumentRequest(BaseModel):
    path: str = Field(
        description="프로젝트 안에서의 경로. `.rspdl` 로 끝나야 한다",
        examples=["inventory.rspdl"],
    )
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(default="", description="RSPDL 소스 전문")


class UpdateDocumentRequest(BaseModel):
    text: str = Field(description="RSPDL 소스 전문")
    summary: str | None = Field(default=None, description="이 편집에 대한 짧은 설명")


class DocumentResponse(BaseModel):
    """RSPDL 문서.

    컴파일 결과는 여기 없다. 필요하면 `/api/analysis/compile` 로 따로 묻는다 —
    텍스트가 진실이고 컴파일 결과는 파생물이다 (ADR-0003).
    """

    id: UUID
    project_id: UUID
    path: str
    title: str
    text: str
    target_rspdl_version: str = Field(
        description="이 텍스트가 쓰인 RSPDL 버전. 서버의 현재 버전과 다를 수 있다"
    )
    created_at: datetime
    updated_at: datetime


class DocumentSummaryResponse(BaseModel):
    """목록용. 본문을 싣지 않는다."""

    id: UUID
    project_id: UUID
    path: str
    title: str
    target_rspdl_version: str
    updated_at: datetime


class DocumentRevisionResponse(BaseModel):
    id: UUID
    document_id: UUID
    revision_no: int
    target_rspdl_version: str
    author_id: UUID | None
    summary: str | None
    created_at: datetime
