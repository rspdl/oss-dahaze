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

    프론트가 프로젝트의 기본 버전과 비교해 불일치를 사용자에게 알릴 수 있게 한다.
    """

    rspdl_version: str
    wire_schema_version: int
    locale: str


class HealthResponse(BaseModel):
    status: str
    rspdl_version: str


# --------------------------------------------------------------------- 인증


class AuthProvidersResponse(BaseModel):
    """설정된 OAuth 제공자. 프론트가 버튼을 하드코딩하지 않게 한다.

    아이디·비밀번호 로그인은 여기 없다. 설정과 무관하게 항상 열려 있으므로, 늘 참인 값을
    실어 보내면 프론트가 "혹시 꺼져 있을 수도 있다" 는 분기를 영원히 들고 있게 된다.
    """

    providers: list[str] = Field(
        description="OAuth 제공자 id 목록. 자격증명이 없는 제공자는 빠진다",
    )


# 아이디에 허용하는 글자. 사람이 주소·명령줄·로그에서 옮겨 적을 수 있는 범위로 좁힌다.
LOGIN_PATTERN = r"^[a-zA-Z0-9._-]+$"

# 짧은 비밀번호를 막는 것이 여기서 할 수 있는 유일하고 확실한 일이다. 복잡도 규칙(대문자
# 하나, 특수문자 하나)은 길이만큼 효과가 없으면서 사람들이 `Password1!` 을 쓰게 만든다.
MIN_PASSWORD_LENGTH = 8


class PasswordLoginRequest(BaseModel):
    login: str = Field(
        min_length=1,
        max_length=64,
        description="아이디. 대소문자와 앞뒤 공백은 무시된다",
    )
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    """회원가입 입력."""

    login: str = Field(
        min_length=3,
        max_length=64,
        pattern=LOGIN_PATTERN,
        description="아이디. 영문·숫자와 `.`·`_`·`-`. 대소문자는 구분하지 않는다",
        examples=["jiwon"],
    )
    password: str = Field(
        min_length=MIN_PASSWORD_LENGTH,
        max_length=256,
        description=f"{MIN_PASSWORD_LENGTH}자 이상",
    )
    display_name: str = Field(
        min_length=1,
        max_length=200,
        description="화면에 보일 이름",
        examples=["김지원"],
    )

    # 이메일을 받지 않는다. 확인도 복구도 알림도 하지 않으므로 받아 봐야 쓸 데가 없고,
    # 쓰지 않을 개인정보를 보관하는 것은 이 제품이 검사하라고 말하는 바로 그 문제다.
    # 필요해지는 날 — 비밀번호 재설정을 붙이는 날 — 확인 절차와 함께 들어온다.


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
        description="이 프로젝트가 기본으로 삼을 RSPDL 버전. 생략하면 서버의 컴파일러 버전",
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


# ----------------------------------------------------------------------- MCP


class McpTokenResponse(BaseModel):
    """MCP 클라이언트가 쓸 Bearer 토큰.

    발급된 뒤에는 **폐기할 수 없다.** 토큰 저장소가 없으므로 `expires_at` 까지는 유효하다
    (ADR-0005). 화면이 이 사실과 만료 시각을 사용자에게 보여줄 수 있도록 함께 돌려준다.
    """

    token: str = Field(description="`Authorization: Bearer <token>` 으로 보낸다")
    token_type: str = Field(default="Bearer", description="HTTP 인증 스킴")
    expires_at: datetime = Field(description="이 시각 이후로는 거부된다. 폐기 수단은 없다")
