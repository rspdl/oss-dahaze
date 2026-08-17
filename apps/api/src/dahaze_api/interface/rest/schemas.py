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


# ----------------------------------------------------------------------- MCP


class McpTokenResponse(BaseModel):
    """MCP 클라이언트가 쓸 Bearer 토큰.

    발급된 뒤에는 **폐기할 수 없다.** 토큰 저장소가 없으므로 `expires_at` 까지는 유효하다
    (ADR-0005). 화면이 이 사실과 만료 시각을 사용자에게 보여줄 수 있도록 함께 돌려준다.
    """

    token: str = Field(description="`Authorization: Bearer <token>` 으로 보낸다")
    token_type: str = Field(default="Bearer", description="HTTP 인증 스킴")
    expires_at: datetime = Field(description="이 시각 이후로는 거부된다. 폐기 수단은 없다")


# ------------------------------------------------------------------ LLM 저작


class DraftDocumentRequest(BaseModel):
    instruction: str = Field(
        min_length=1,
        max_length=8000,
        description="무엇을 선언하고 싶은지 자연어로. 이 문장이 초안의 유일한 입력이다",
        examples=["재고 항목을 이름과 수량으로 관리한다. 수량은 음수가 될 수 없다."],
    )
    path: str = Field(
        default="draft.rspdl",
        description="초안에 붙일 경로. 저장하지 않으므로 기존 문서와 겹쳐도 된다",
        examples=["inventory.rspdl"],
    )


class ReviseDocumentRequest(BaseModel):
    instruction: str = Field(
        min_length=1,
        max_length=8000,
        description="이 문서를 어떻게 바꿀지 자연어로",
        examples=["수량 상한을 1000으로 제한하는 제약을 추가한다."],
    )


class AuthoringAttemptResponse(BaseModel):
    """시도 한 번의 결과.

    왜 이 초안이 최종인지 설명하는 재료다 (ADR-0005). 진단 수가 줄다 멈췄는지,
    처음부터 0이었는지가 여기서 드러난다.
    """

    attempt: int = Field(description="1 이 첫 초안, 그 뒤는 진단을 되먹인 수리")
    diagnostic_count: int = Field(description="그 시도의 컴파일 진단 수")


class AuthoringDraftResponse(BaseModel):
    """LLM 초안과 그 컴파일 결과.

    **저장되지 않았다.** 사용자가 받아들이면 `PUT /api/documents/{id}` 로 직접 저장한다 —
    LLM 이 문서를 조용히 덮어쓰면 이력을 추적할 수 없게 되기 때문이다 (ADR-0005).

    `analysis.result` 안에 진단이 그대로 들어 있다. 진단이 남은 초안도 실패가 아니라
    200 으로 돌아온다. 반쯤 맞는 초안과 그 진단은 사람이 판단할 재료다.
    """

    path: str
    text: str = Field(description="RSPDL 소스 전문. 부분 수정본이 아니다")
    model: str = Field(description="이 초안을 만든 LLM 모델")
    attempts: list[AuthoringAttemptResponse] = Field(
        description="시도 이력. 마지막 항목이 이 응답의 초안에 대응한다"
    )
    analysis: AnalysisResponse = Field(description="최종 초안의 컴파일 결과와 진단")
