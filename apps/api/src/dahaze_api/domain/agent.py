"""AI 대화 세션과 턴 (ADR-0005, ADR-0008).

세션은 Claude Code 의 대화 하나다. 사용자가 메시지를 보내면 턴이 하나 생기고, worker 가
그 턴에서 모델 호출과 도구 실행을 반복한다. 턴의 진행 상태는 전부 대화 항목으로 남으므로,
worker 가 바뀌어도 기록만 읽고 이어서 실행할 수 있다.

이 모듈은 ORM 도 프레임워크도 모른다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

# 한 턴에서 부를 수 있는 도구 호출 수. 닿으면 사용자에게 계속할지 묻고 턴을 끝낸다.
MAX_TOOL_CALLS_PER_TURN = 100


def session_lock_holder(session_id: UUID) -> str:
    """앱 AI 의 잠금 보유자. 세션 하나가 보유자 하나다."""
    return f"session:{session_id}"


class ItemKind(StrEnum):
    USER_MESSAGE = "user_message"
    ASSISTANT_MESSAGE = "assistant_message"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"


class TurnStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    # 비어 있지 않은 폴더 삭제처럼 사용자 승인을 기다린다. 잠금은 유지한다.
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_active(self) -> bool:
        return self in (TurnStatus.QUEUED, TurnStatus.RUNNING, TurnStatus.AWAITING_APPROVAL)


class StopReason(StrEnum):
    """턴이 끝난 이유. 화면이 다음에 할 일을 고르는 근거다."""

    DONE = "done"
    TOOL_LIMIT = "tool_limit"
    LOCK_CONFLICT = "lock_conflict"
    LOCK_EXPIRED = "lock_expired"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class AgentSession:
    id: UUID
    project_id: UUID
    created_by: UUID | None
    title: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class AgentItem:
    """대화 기록 한 줄.

    `payload` 모양은 종류마다 다르다.

    - user_message / assistant_message: `{"text": str}`
    - tool_call: `{"call_id": str, "name": str, "arguments": dict}`
    - tool_result: `{"call_id": str, "name": str, "ok": bool, "output": Any,
      "changes": [{"path_before", "path_after", "text_before", "text_after"}]}`
    """

    id: UUID
    session_id: UUID
    turn_id: UUID | None
    seq: int
    kind: ItemKind
    payload: Mapping[str, Any]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PendingApproval:
    """사용자 승인을 기다리는 도구 호출."""

    call_id: str
    name: str
    arguments: Mapping[str, Any]
    reason: str


@dataclass(frozen=True, slots=True)
class AgentTurn:
    id: UUID
    session_id: UUID
    project_id: UUID
    actor_id: UUID
    status: TurnStatus
    tool_calls: int
    stop_reason: StopReason | None
    pending_approval: PendingApproval | None
    # 승인 결정. 턴이 다시 큐에 들어갈 때 채워진다.
    approval: bool | None
    cancel_requested: bool
    error: str | None
    created_at: datetime
    lease_token: UUID | None = None


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """모델에 알려주는 도구 하나. `parameters` 는 JSON Schema 다."""

    name: str
    description: str
    parameters: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ToolCall:
    call_id: str
    name: str
    arguments: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class AgentStep:
    """모델 호출 한 번의 결과."""

    text: str
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True, slots=True)
class AgentContext:
    """모델 호출에 붙는 프로젝트 맥락."""

    project_name: str
    # 컴파일러가 planning contracts 확장 문법을 지원하는지. 프롬프트에 확장 문법을
    # 넣을지 정한다.
    planning_profile: bool


@dataclass(frozen=True, slots=True)
class FileChange:
    """도구 호출 하나가 바꾼 파일. 채팅 카드가 이걸로 diff 를 연다."""

    path_before: str | None
    path_after: str | None
    text_before: str | None
    text_after: str | None

    def as_payload(self) -> dict[str, Any]:
        return {
            "path_before": self.path_before,
            "path_after": self.path_after,
            "text_before": self.text_before,
            "text_after": self.text_after,
        }


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    ok: bool
    output: Any
    changes: tuple[FileChange, ...] = ()
    # 잠금 충돌이면 모델에게 결과를 준 뒤 사용자에게 알리고 턴을 끝낸다.
    lock_conflict: bool = False
    # 승인이 필요하면 턴을 멈춘다.
    needs_approval: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentSettings:
    """사용자별 AI 설정."""

    # 비어 있지 않은 폴더 삭제를 묻지 않고 진행한다.
    auto_approve_recursive_delete: bool = False
