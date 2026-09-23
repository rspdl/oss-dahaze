"""REST 요청·응답 스키마. OpenAPI 계약의 원본이다 (ADR-0001)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
        description="새 문서가 기본으로 삼을 RSPDL 버전. 생략하면 서버의 컴파일러 버전",
    )


class ProjectResponse(BaseModel):
    id: UUID
    slug: str
    name: str
    description: str | None
    default_rspdl_version: str
    revision: int = Field(description="원문 변경 묶음 버전")
    source_hash: str = Field(description="canonical 문서 목록의 내용 해시")
    snapshot_version: int = Field(description="원문과 기획 상태를 함께 고정한 최신 버전")
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


class CompiledDocumentRef(BaseModel):
    """컴파일에 참여한 문서 하나.

    `path` 가 IR 의 `files[].path` 와 이어지는 유일한 고리다. 화면은 이것으로 "이 정책이
    어느 문서에서 왔는가" 를 말한다 — IR 안에 문서 id 를 심지 않는다 (ADR-0003).
    """

    id: UUID = Field(description="문서 식별자")
    path: str = Field(description="result.files[].path 와 같은 소스 경로")
    title: str = Field(description="화면에 표시할 문서 제목")
    source_hash: str = Field(
        min_length=64,
        max_length=64,
        description="컴파일에 사용한 문서 원문 UTF-8 바이트의 소문자 SHA-256",
    )
    target_rspdl_version: str = Field(description="문서가 대상으로 삼는 rspdl 버전")
    updated_at: datetime = Field(description="컴파일에 사용한 저장 문서의 마지막 수정 시각")


class ProjectCompileResponse(BaseModel):
    """프로젝트의 문서 전부를 한 워크스페이스로 컴파일한 결과.

    `result` 는 `AnalysisResponse` 와 같은 값이다 — RSPDL SDK 가 준 그대로이며 dahaze 가
    재작성하지 않는다 (ADR-0003). 진단도 그 안에 담겨 온다.

    문서가 하나도 없으면 컴파일러를 부르지 않으므로 `result` 는 `None` 이다. 파일 0개짜리
    결과를 지어내면 "컴파일했는데 아무 문제 없었다" 와 "컴파일한 적이 없다" 가 화면에서
    같아 보인다.
    """

    rspdl_version: str = Field(description="결과를 만든 컴파일러 버전")
    wire_schema_version: int = Field(description="result 의 wire schema 버전")
    locale: str = Field(description="컴파일에 사용한 locale")
    result: dict[str, Any] | None = Field(
        default=None, description="RSPDL SDK 결과 원본. 문서가 없으면 null"
    )
    documents: list[CompiledDocumentRef] = Field(
        description="컴파일에 참여한 문서. `path` 로 `result.files[].path` 와 잇는다"
    )


class DocumentRevisionResponse(BaseModel):
    id: UUID
    document_id: UUID
    revision_no: int
    target_rspdl_version: str
    author_id: UUID | None
    summary: str | None
    created_at: datetime


# ---------------------------------------------------------- 프로젝트 기획 작업공간


class PlanningMetadata(BaseModel):
    environments: list[dict[str, Any]] = Field(default_factory=list)
    design: dict[str, Any] = Field(default_factory=dict)
    sample_data: dict[str, Any] = Field(default_factory=dict)


class PlanningStateResponse(BaseModel):
    revision: int = Field(description="대화·결정·메타데이터의 독립 optimistic revision")
    metadata_revision: int = Field(
        description="메시지·결정 변경과 독립적으로 증가하는 메타데이터 hydration token"
    )
    project_revision: int = Field(description="확정 RSPDL 원문 변경 묶음 버전")
    source_hash: str = Field(description="현재 확정 원문의 canonical workspace hash")
    messages: list[dict[str, Any]]
    decisions: list[dict[str, Any]]
    proposals: list[dict[str, Any]]
    metadata: PlanningMetadata


class ResolvePlanningProposalRequest(BaseModel):
    expected_revision: int = Field(ge=0, description="현재 기획 상태 revision")
    status: Literal["adopted", "deferred"] = Field(
        description="정책 제안을 명시적으로 채택하거나 보류"
    )
    rationale: str | None = Field(default=None, max_length=2000, description="채택 또는 보류 이유")


class ResolvePlanningProposalResponse(BaseModel):
    item: dict[str, Any] = Field(description="갱신된 정책 제안")
    decision: dict[str, Any] | None = Field(description="채택 시 생성된 결정. 보류면 null")
    revision: int = Field(description="갱신된 기획 상태 revision")


class PlanningAiSubject(BaseModel):
    kind: str = Field(min_length=1, max_length=50, description="선택 대상 종류")
    id: str = Field(min_length=1, max_length=300, description="선택 대상의 안정 식별자")
    source_path: str | None = Field(default=None, max_length=500, description="compiler 소스 경로")
    stable_id: str | None = Field(default=None, max_length=300, description="compiler 안정 ID")
    label: str | None = Field(default=None, max_length=500, description="화면 표시 이름")


class CreatePlanningAiJobRequest(BaseModel):
    request_id: UUID = Field(description="enqueue 재전송을 중복 제거하는 클라이언트 요청 ID")
    kind: Literal["interview", "generate"] = Field(description="대화 또는 소스 생성 작업")
    expected_planning_revision: int = Field(ge=0, description="사용자 메시지 기준 revision")
    instruction: str = Field(
        min_length=1, max_length=12000, description="인터뷰 답변 또는 생성 지시"
    )
    selected_subject: PlanningAiSubject | None = Field(default=None, description="선택한 대화 대상")
    source_draft_id: UUID | None = Field(default=None, description="검토·수정할 저장 초안")
    base_project_revision: int | None = Field(default=None, ge=0, description="기대 원문 revision")
    base_source_hash: str | None = Field(
        default=None, min_length=64, max_length=64, description="기대 원문 hash"
    )


class PlanningAiProgressResponse(BaseModel):
    stage: str = Field(description="현재 실행 단계")
    completed: int = Field(ge=0, description="완료 단위 수")
    total: int = Field(ge=1, description="전체 단위 수")
    message: str | None = Field(description="사용자에게 표시할 진행 설명")


class PlanningAiErrorResponse(BaseModel):
    code: Literal[
        "config", "auth", "rate_limit", "timeout", "provider_failure", "invalid_output", "conflict"
    ] = Field(description="비밀이나 상류 응답을 포함하지 않는 오류 분류")
    message: str = Field(description="사용자가 취할 수 있는 조치를 설명하는 안전한 문구")
    retryable: bool = Field(description="새 작업으로 재시도할 수 있는지")


class PlanningAiJobResponse(BaseModel):
    id: UUID = Field(description="AI 작업 ID")
    project_id: UUID = Field(description="작업 프로젝트")
    request_id: UUID = Field(description="enqueue 중복 제거 요청 ID")
    kind: Literal["interview", "generate"] = Field(description="작업 종류")
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"] = Field(
        description="작업 상태"
    )
    request: dict[str, Any] = Field(description="원래 지시")
    frozen_planning_revision: int = Field(description="작업이 읽은 기획 상태 revision")
    frozen_project_revision: int = Field(description="작업이 읽은 원문 revision")
    frozen_source_hash: str = Field(description="작업이 읽은 원문 hash")
    source_draft_id: UUID | None = Field(description="기준 저장 초안")
    retry_of_job_id: UUID | None = Field(description="재시도 원본 작업")
    attempt: int = Field(ge=1, description="사용자 재시도 회차")
    max_attempts: int = Field(ge=1, description="최대 사용자 재시도 회차")
    progress: PlanningAiProgressResponse = Field(description="영속 진행률")
    result: dict[str, Any] | None = Field(description="성공 결과. stale 결과도 보존")
    error: PlanningAiErrorResponse | None = Field(description="정제된 실패 정보")
    cancel_requested: bool = Field(description="실행 중 취소 요청 여부")
    created_at: datetime = Field(description="enqueue 시각")
    started_at: datetime | None = Field(description="최초 worker 시작 시각")
    finished_at: datetime | None = Field(description="종료 시각")
    heartbeat_at: datetime | None = Field(description="마지막 worker heartbeat 시각")


class UpdatePlanningStateRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)
    proposals: list[dict[str, Any]] = Field(default_factory=list)
    metadata: PlanningMetadata = Field(default_factory=PlanningMetadata)


class DraftDocumentChange(BaseModel):
    operation: str = Field(description="upsert | delete")
    path: str = Field(description="프로젝트 안의 .rspdl 경로")
    title: str | None = Field(default=None, description="upsert 때 필요한 표시 이름")
    text: str | None = Field(default=None, description="upsert 때 필요한 RSPDL 전문")


class CreatePlanningDraftRequest(BaseModel):
    base_project_revision: int = Field(ge=0)
    base_source_hash: str = Field(min_length=64, max_length=64)
    changes: list[DraftDocumentChange] = Field(min_length=1)
    summary: str | None = None


class CompilerEditModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EditHeaderElement(CompilerEditModel):
    kind: Literal["header"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")


class EditSectionElement(CompilerEditModel):
    kind: Literal["section"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")


class EditFormElement(CompilerEditModel):
    kind: Literal["form"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")


class EditHeadingElement(CompilerEditModel):
    kind: Literal["heading"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")
    text: str = Field(description="제목에 표시할 문구")


class EditInputElement(CompilerEditModel):
    kind: Literal["input"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")
    field_id: str = Field(min_length=1, description="입력이 참조할 RSPDL 필드 ID")


class EditListElement(CompilerEditModel):
    kind: Literal["list"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")
    model_id: str = Field(min_length=1, description="목록이 참조할 RSPDL 모델 ID")
    field_ids: list[str] = Field(description="목록에서 표시할 RSPDL 필드 ID")


class EditButtonElement(CompilerEditModel):
    kind: Literal["button"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")
    name: str = Field(description="버튼에 표시할 이름")
    action_id: str | None = Field(default=None, description="버튼이 참조할 RSPDL action ID")


class EditPlaceholderElement(CompilerEditModel):
    kind: Literal["placeholder"] = Field(description="추가할 요소 종류")
    id: str = Field(min_length=1, description="프로젝트 화면 안에서 안정적인 요소 ID")
    text: str = Field(description="자리표시 요소에 표시할 문구")


CompilerEditElement = Annotated[
    EditHeaderElement
    | EditSectionElement
    | EditFormElement
    | EditHeadingElement
    | EditInputElement
    | EditListElement
    | EditButtonElement
    | EditPlaceholderElement,
    Field(discriminator="kind"),
]


class InsertCompilerEdit(CompilerEditModel):
    operation: Literal["insert"] = Field(description="요소 추가 편집")
    screen_id: str = Field(min_length=1, description="편집할 RSPDL 화면 ID")
    parent_element_id: str | None = Field(
        default=None, description="추가 위치의 부모 요소 ID. root slot이면 생략"
    )
    slot: Literal["root", "children", "inputs"] = Field(
        description="컴파일러가 검증할 부모 안의 삽입 영역"
    )
    before_element_id: str | None = Field(
        default=None, description="이 요소 앞에 삽입. 생략하면 slot 마지막에 추가"
    )
    element: CompilerEditElement = Field(description="추가할 구조화 화면 요소")


class DeleteCompilerEdit(CompilerEditModel):
    operation: Literal["delete"] = Field(description="요소 삭제 편집")
    screen_id: str = Field(min_length=1, description="편집할 RSPDL 화면 ID")
    element_id: str = Field(min_length=1, description="삭제할 안정적인 요소 ID")


class MoveCompilerEdit(CompilerEditModel):
    operation: Literal["move"] = Field(description="요소 이동 편집")
    screen_id: str = Field(min_length=1, description="편집할 RSPDL 화면 ID")
    element_id: str = Field(min_length=1, description="이동할 안정적인 요소 ID")
    parent_element_id: str | None = Field(
        default=None, description="새 부모 요소 ID. root slot이면 생략"
    )
    slot: Literal["root", "children", "inputs"] = Field(
        description="컴파일러가 검증할 새 부모 안의 영역"
    )
    before_element_id: str | None = Field(
        default=None, description="이 요소 앞으로 이동. 생략하면 slot 마지막으로 이동"
    )


class CompilerEditPatch(CompilerEditModel):
    text: str | None = Field(default=None, description="heading/placeholder 문구 변경")
    field_id: str | None = Field(default=None, description="input의 RSPDL 필드 ID 변경")
    model_id: str | None = Field(default=None, description="list의 RSPDL 모델 ID 변경")
    field_ids: list[str] | None = Field(default=None, description="list의 표시 필드 ID 변경")
    name: str | None = Field(default=None, description="button 표시 이름 변경")
    action_id: str | None = Field(default=None, description="button의 RSPDL action ID 변경")
    clear_action: bool = Field(
        default=False, description="button의 기존 action 연결을 명시적으로 제거할지 여부"
    )


class UpdateCompilerEdit(CompilerEditModel):
    operation: Literal["update"] = Field(description="요소 속성 변경 편집")
    screen_id: str = Field(min_length=1, description="편집할 RSPDL 화면 ID")
    element_id: str = Field(min_length=1, description="변경할 안정적인 요소 ID")
    patch: CompilerEditPatch = Field(description="요소 종류에 허용된 속성 변경")


class CompilerEditHandler(CompilerEditModel):
    kind: Literal["state", "message", "popup", "loading"] = Field(
        description="같은 화면에서 실행할 handler 종류"
    )
    id: str = Field(min_length=1, description="handler가 참조할 상태·메시지·팝업·로딩 ID")
    content: str | None = Field(default=None, description="handler에 함께 기록할 표시 문구")


class CompilerPathEdit(CompilerEditModel):
    source_screen_id: str = Field(min_length=1, description="출발 RSPDL 화면 ID")
    source_element_id: str = Field(min_length=1, description="경로를 시작할 요소 ID")
    target_screen_id: str | None = Field(
        default=None, min_length=1, description="도착 RSPDL 화면 ID. handler 경로면 null"
    )
    outcome_id: str | None = Field(
        default=None, min_length=1, description="출발 action 안의 outcome ID. 없으면 null"
    )
    handler: CompilerEditHandler | None = Field(
        default=None, description="같은 화면 handler 경로. 화면 이동 경로면 null"
    )
    label: str | None = Field(default=None, description="경로에 기록할 선택적인 표시 이름")

    @model_validator(mode="after")
    def require_one_destination(self) -> Self:
        if (self.target_screen_id is None) == (self.handler is None):
            raise ValueError("exactly one of target_screen_id or handler is required")
        return self


class ConnectCompilerEdit(CompilerPathEdit):
    operation: Literal["connect"] = Field(description="화면 경로 연결 편집")


class DisconnectCompilerEdit(CompilerPathEdit):
    operation: Literal["disconnect"] = Field(description="화면 경로 연결 해제 편집")


CompilerEditOperation = Annotated[
    InsertCompilerEdit
    | DeleteCompilerEdit
    | MoveCompilerEdit
    | UpdateCompilerEdit
    | ConnectCompilerEdit
    | DisconnectCompilerEdit,
    Field(discriminator="operation"),
]


class ProposePlanningEditRequest(BaseModel):
    document_id: UUID = Field(description="현재 확정 원문을 읽을 저장 문서 ID")
    base_project_revision: int = Field(ge=0, description="후보가 기준으로 삼은 프로젝트 리비전")
    base_source_hash: str = Field(
        min_length=64, max_length=64, description="후보가 기준으로 삼은 프로젝트 원문 해시"
    )
    expected_source_hash: str = Field(
        min_length=64,
        max_length=64,
        description="문서 원문 UTF-8 바이트의 소문자 SHA-256",
    )
    edit: CompilerEditOperation = Field(description="컴파일러가 적용·검증할 구조화 편집")
    summary: str | None = Field(default=None, max_length=500, description="초안 변경 요약")


class PlanningAnalysisResponse(BaseModel):
    rspdl_version: str
    wire_schema_version: int
    locale: str
    result: dict[str, Any] | None = Field(description="RSPDL SDK 결과 원본")


class PlanningDraftResponse(BaseModel):
    id: UUID
    project_id: UUID
    base_project_revision: int
    base_source_hash: str
    candidate_source_hash: str
    changes: list[dict[str, Any]]
    candidate_documents: list[dict[str, Any]]
    summary: str | None
    rspdl_version: str
    wire_schema_version: int
    locale: str
    result: dict[str, Any] | None
    applied_revision: int | None
    created_at: datetime
    updated_at: datetime


class ProposePlanningEditResponse(BaseModel):
    supported: bool = Field(description="활성 RSPDL 런타임이 구조화 편집을 지원하는지")
    unsupported_reason: str | None = Field(
        description="지원하지 않을 때의 명시적 사유. 지원되면 null"
    )
    rspdl_version: str = Field(description="구조화 편집을 시도한 RSPDL 버전")
    wire_schema_version: int = Field(description="활성 RSPDL 결과 wire schema 버전")
    locale: str = Field(description="구조화 편집 locale")
    compiler_response: dict[str, Any] | None = Field(
        description=(
            "RSPDL edit SDK 응답 원본. applied/rejected와 candidate, compilation, "
            "tombstones, id_remap을 재작성하지 않는다"
        )
    )
    draft: PlanningDraftResponse | None = Field(
        description="applied 후보를 프로젝트 전체로 다시 컴파일해 보관한 초안"
    )


class PlanningDraftSummaryResponse(BaseModel):
    id: UUID
    project_id: UUID
    base_project_revision: int
    base_source_hash: str
    candidate_source_hash: str
    summary: str | None
    rspdl_version: str
    wire_schema_version: int
    locale: str
    applied_revision: int | None
    created_at: datetime
    updated_at: datetime


class ApplyPlanningDraftRequest(BaseModel):
    expected_project_revision: int = Field(ge=0)
    expected_source_hash: str = Field(min_length=64, max_length=64)


class ProjectSnapshotResponse(BaseModel):
    id: UUID
    project_id: UUID
    snapshot_version: int
    project_revision: int
    planning_revision: int
    source_hash: str
    documents: list[dict[str, Any]]
    planning_state: dict[str, Any]
    rspdl_version: str
    wire_schema_version: int
    locale: str
    result: dict[str, Any] | None = Field(description="해당 버전에서 저장한 RSPDL SDK 결과 원본")
    change_kind: str = Field(description="baseline | apply | restore")
    summary: str | None
    author_id: UUID | None
    created_at: datetime


class ProjectSnapshotSummaryResponse(BaseModel):
    id: UUID
    project_id: UUID
    snapshot_version: int
    project_revision: int
    planning_revision: int
    source_hash: str
    rspdl_version: str
    wire_schema_version: int
    locale: str
    change_kind: str
    summary: str | None
    author_id: UUID | None
    created_at: datetime


class AppendPlanningMessageRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    role: str = Field(pattern="^(user|assistant)$", description="user | assistant")
    content: str = Field(min_length=1, max_length=32000)


class PlanningMessageResponse(BaseModel):
    id: UUID
    role: str = Field(description="user | assistant")
    content: str
    created_at: datetime


class AppendPlanningMessageResponse(BaseModel):
    item: PlanningMessageResponse
    revision: int


class AppendPlanningDecisionRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=500)
    rationale: str | None = Field(default=None, max_length=8000)
    status: str = Field(default="decided", pattern="^(decided|deferred|open)$")


class PlanningDecisionResponse(BaseModel):
    id: UUID
    title: str
    rationale: str | None
    status: str
    created_at: datetime


class AppendPlanningDecisionResponse(BaseModel):
    item: PlanningDecisionResponse
    revision: int


class ResolvePlanningDecisionRequest(BaseModel):
    expected_revision: int = Field(ge=0, description="현재 기획 상태 optimistic revision")
    status: str = Field(pattern="^(decided|deferred)$", description="decided | deferred")
    rationale: str | None = Field(default=None, max_length=8000, description="채택·보류 근거")


class PlanningDecisionResolutionEventResponse(BaseModel):
    from_status: str | None = Field(description="변경 전 결정 상태")
    to_status: str = Field(description="변경 후 결정 상태")
    previous_rationale: str | None = Field(description="변경 전 근거")
    rationale: str | None = Field(description="새 근거")
    resolved_at: datetime = Field(description="이 상태 변경이 기록된 시각")


class ResolvedPlanningDecisionResponse(PlanningDecisionResponse):
    resolved_at: datetime = Field(description="가장 최근 상태 변경 시각")
    resolution_history: list[PlanningDecisionResolutionEventResponse] = Field(
        description="이 결정 ID에 누적된 상태 변경 이력"
    )


class ResolvePlanningDecisionResponse(BaseModel):
    item: ResolvedPlanningDecisionResponse
    revision: int = Field(description="갱신된 기획 상태 revision")


class PatchPlanningMetadataRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    environments: list[dict[str, Any]] | None = None
    design: dict[str, Any] | None = None
    sample_data: dict[str, Any] | None = None
    summary: str | None = Field(default=None, max_length=500)


class PlanningMetadataMutationResponse(BaseModel):
    revision: int
    metadata_revision: int = Field(description="갱신된 메타데이터 hydration token")
    metadata: PlanningMetadata


class PlanningMetadataRevisionResponse(BaseModel):
    revision: int = Field(description="이 메타데이터 전문을 저장한 당시 기획 상태 revision")
    metadata: PlanningMetadata
    author_id: UUID | None
    summary: str | None
    created_at: datetime


class UndoPlanningMetadataRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    target_revision: int = Field(ge=0)


class ApplyPlanningDraftResponse(BaseModel):
    applied: bool
    project_revision: int | None
    source_hash: str | None
    analysis: PlanningAnalysisResponse
    snapshot: ProjectSnapshotResponse | None


class RestoreProjectSnapshotRequest(BaseModel):
    expected_project_revision: int = Field(ge=0)
    expected_source_hash: str = Field(min_length=64, max_length=64)
    expected_planning_revision: int = Field(ge=0)


class CaptureProjectSnapshotRequest(RestoreProjectSnapshotRequest):
    summary: str | None = None


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
