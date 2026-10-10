"""AI 대화·프로젝트 이벤트 REST 스키마 (ADR-0005, ADR-0008)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from dahaze_api.domain.agent import AgentItem, AgentSession, AgentSettings, AgentTurn
from dahaze_api.domain.events import ProjectEvent

TurnStatusOut = Literal[
    "queued", "running", "awaiting_approval", "completed", "failed", "cancelled"
]
StopReasonOut = Literal["done", "tool_limit", "lock_conflict", "lock_expired", "cancelled", "error"]
ItemKindOut = Literal["user_message", "assistant_message", "tool_call", "tool_result"]


class CreateAgentSessionRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200, description="비우면 '새 대화'")


class AgentSessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    created_by: UUID | None
    title: str
    created_at: datetime
    updated_at: datetime = Field(description="마지막 대화 항목이 기록된 시각")


class AgentItemResponse(BaseModel):
    id: UUID
    session_id: UUID
    turn_id: UUID | None
    seq: int = Field(description="세션 안에서 1부터 늘어나는 순번")
    kind: ItemKindOut
    payload: dict[str, Any] = Field(
        description=(
            "종류별 내용. 메시지는 {text}, 도구 호출은 {call_id, name, arguments}, 도구 결과는 "
            "{call_id, name, ok, output, changes[{path_before, path_after, text_before, "
            "text_after}]}"
        )
    )
    created_at: datetime


class PendingApprovalResponse(BaseModel):
    call_id: str
    name: str
    arguments: dict[str, Any]
    reason: str = Field(description="사용자에게 보여줄 승인 대상 설명")


class AgentTurnResponse(BaseModel):
    id: UUID
    session_id: UUID
    project_id: UUID
    actor_id: UUID
    status: TurnStatusOut
    tool_calls: int = Field(description="이 턴에서 부른 도구 수. 상한은 100")
    stop_reason: StopReasonOut | None
    pending_approval: PendingApprovalResponse | None
    cancel_requested: bool
    error: str | None
    created_at: datetime


class AgentContextElement(BaseModel):
    """화면에 선언된 요소 하나. 배치 파일의 `ref` 를 지어내지 않게 실어 보낸다."""

    id: str = Field(max_length=200, description="요소 id. 배치 파일 ref 는 `id:<이 값>`")
    kind: str = Field(
        max_length=40, description="header·section·form·heading·input·list·button·placeholder"
    )
    label: str = Field(default="", max_length=200, description="사람이 읽는 이름")
    owner: str | None = Field(default=None, max_length=200, description="담긴 영역의 요소 id")


class AgentMessageContext(BaseModel):
    """메시지를 보낼 때 사용자가 보고 있던 것. AI 가 "이 화면" 같은 말을 풀 때 쓴다."""

    view: Literal["documents", "ia", "wireframe"] = Field(description="보고 있던 뷰")
    document_path: str | None = Field(default=None, max_length=500, description="문서 경로")
    screen_id: str | None = Field(default=None, max_length=200, description="화면 id")
    screen_name: str | None = Field(default=None, max_length=200, description="화면 이름")
    wireframe_path: str | None = Field(
        default=None, max_length=500, description="그 문서의 배치 파일 경로"
    )
    wireframe_exists: bool | None = Field(
        default=None, description="배치 파일이 작업 트리에 이미 있는지"
    )
    ui_theme: str | None = Field(default=None, max_length=40, description="지금 목업의 UI 스타일")
    elements: list[AgentContextElement] | None = Field(
        default=None, max_length=200, description="화면에 선언된 요소"
    )


class SendAgentMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    request_id: UUID = Field(
        description="클라이언트가 만든 요청 ID. 같은 값으로 다시 보내면 메시지를 한 번만 기록한다"
    )
    context: AgentMessageContext | None = Field(
        default=None, description="사용자가 보고 있던 화면. 대화에는 보이지 않고 AI 입력에만 붙는다"
    )


class ResolveApprovalRequest(BaseModel):
    approved: bool


class AgentSettingsBody(BaseModel):
    auto_approve_recursive_delete: bool = Field(
        description="비어 있지 않은 폴더 삭제를 묻지 않고 진행한다"
    )


class ProjectEventResponse(BaseModel):
    seq: int = Field(description="프로젝트 이벤트 순번. SSE 의 id 와 같다")
    type: str = Field(
        description=(
            "tree.changed · locks.released · commit.created · agent.item · "
            "agent.text_delta · agent.turn"
        )
    )
    payload: dict[str, Any]
    created_at: datetime


def session_out(session: AgentSession) -> AgentSessionResponse:
    return AgentSessionResponse(
        id=session.id,
        project_id=session.project_id,
        created_by=session.created_by,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def item_out(item: AgentItem) -> AgentItemResponse:
    return AgentItemResponse(
        id=item.id,
        session_id=item.session_id,
        turn_id=item.turn_id,
        seq=item.seq,
        kind=item.kind.value,
        payload=dict(item.payload),
        created_at=item.created_at,
    )


def turn_out(turn: AgentTurn) -> AgentTurnResponse:
    pending = turn.pending_approval
    return AgentTurnResponse(
        id=turn.id,
        session_id=turn.session_id,
        project_id=turn.project_id,
        actor_id=turn.actor_id,
        status=turn.status.value,
        tool_calls=turn.tool_calls,
        stop_reason=turn.stop_reason.value if turn.stop_reason else None,
        pending_approval=None
        if pending is None
        else PendingApprovalResponse(
            call_id=pending.call_id,
            name=pending.name,
            arguments=dict(pending.arguments),
            reason=pending.reason,
        ),
        cancel_requested=turn.cancel_requested,
        error=turn.error,
        created_at=turn.created_at,
    )


def settings_out(settings: AgentSettings) -> AgentSettingsBody:
    return AgentSettingsBody(auto_approve_recursive_delete=settings.auto_approve_recursive_delete)


def event_out(event: ProjectEvent) -> ProjectEventResponse:
    return ProjectEventResponse(
        seq=event.seq, type=event.type, payload=dict(event.payload), created_at=event.created_at
    )
