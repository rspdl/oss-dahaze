"""AI 세션·턴·대화 항목, 프로젝트 이벤트, 사용자 AI 설정의 SQLAlchemy 구현체."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.agent import (
    AgentItem,
    AgentSession,
    AgentSettings,
    AgentTurn,
    ItemKind,
    PendingApproval,
    StopReason,
    TurnStatus,
)
from dahaze_api.domain.events import ProjectEvent
from dahaze_api.infrastructure.db.models import (
    AgentItemRow,
    AgentSessionRow,
    AgentTurnRow,
    ProjectEventRow,
    UserAgentSettingsRow,
)

# LISTEN 하는 쪽과 같은 이름이어야 한다. payload 는 프로젝트 ID 다.
EVENTS_CHANNEL = "dahaze_project_events"

_ACTIVE = (TurnStatus.QUEUED, TurnStatus.RUNNING, TurnStatus.AWAITING_APPROVAL)


def _to_session(row: AgentSessionRow) -> AgentSession:
    return AgentSession(
        id=row.id,
        project_id=row.project_id,
        created_by=row.created_by,
        title=row.title,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_item(row: AgentItemRow) -> AgentItem:
    return AgentItem(
        id=row.id,
        session_id=row.session_id,
        turn_id=row.turn_id,
        seq=row.seq,
        kind=ItemKind(row.kind),
        payload=row.payload,
        created_at=row.created_at,
    )


def _pending_out(value: Mapping[str, Any] | None) -> PendingApproval | None:
    if value is None:
        return None
    return PendingApproval(
        call_id=str(value["call_id"]),
        name=str(value["name"]),
        arguments=dict(value.get("arguments") or {}),
        reason=str(value.get("reason", "")),
    )


def _pending_in(value: PendingApproval) -> dict[str, object]:
    return {
        "call_id": value.call_id,
        "name": value.name,
        "arguments": dict(value.arguments),
        "reason": value.reason,
    }


def _to_turn(row: AgentTurnRow) -> AgentTurn:
    return AgentTurn(
        id=row.id,
        session_id=row.session_id,
        project_id=row.project_id,
        actor_id=row.actor_id,
        status=TurnStatus(row.status),
        tool_calls=row.tool_calls,
        stop_reason=StopReason(row.stop_reason) if row.stop_reason else None,
        pending_approval=_pending_out(row.pending_approval),
        approval=row.approval,
        cancel_requested=row.cancel_requested,
        error=row.error,
        created_at=row.created_at,
        lease_token=row.lease_token,
    )


class SqlProjectEvents:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def append(self, *, project_id: UUID, type: str, payload: Mapping[str, Any]) -> None:
        self._session.add(ProjectEventRow(project_id=project_id, type=type, payload=dict(payload)))
        await self._session.flush()
        # 알림은 커밋될 때 전달된다. 롤백되면 구독자도 깨우지 않는다.
        await self._session.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": EVENTS_CHANNEL, "payload": str(project_id)},
        )

    async def list_after(
        self, *, project_id: UUID, after_seq: int, limit: int
    ) -> list[ProjectEvent]:
        rows = await self._session.scalars(
            select(ProjectEventRow)
            .where(ProjectEventRow.project_id == project_id, ProjectEventRow.seq > after_seq)
            .order_by(ProjectEventRow.seq)
            .limit(limit)
        )
        return [
            ProjectEvent(
                seq=row.seq,
                project_id=row.project_id,
                type=row.type,
                payload=row.payload,
                created_at=row.created_at,
            )
            for row in rows
        ]


class SqlAgentSettings:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: UUID) -> AgentSettings:
        row = await self._session.get(UserAgentSettingsRow, user_id)
        if row is None:
            return AgentSettings()
        return AgentSettings(auto_approve_recursive_delete=row.auto_approve_recursive_delete)

    async def put(self, user_id: UUID, settings: AgentSettings) -> AgentSettings:
        stmt = insert(UserAgentSettingsRow).values(
            user_id=user_id,
            auto_approve_recursive_delete=settings.auto_approve_recursive_delete,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[UserAgentSettingsRow.user_id],
            set_={"auto_approve_recursive_delete": stmt.excluded.auto_approve_recursive_delete},
        )
        await self._session.execute(stmt)
        return settings


class SqlAgentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------ 세션

    async def create_session(
        self, *, project_id: UUID, created_by: UUID, title: str
    ) -> AgentSession:
        row = AgentSessionRow(id=uuid4(), project_id=project_id, created_by=created_by, title=title)
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_session(row)

    async def list_sessions(self, project_id: UUID) -> list[AgentSession]:
        rows = await self._session.scalars(
            select(AgentSessionRow)
            .where(AgentSessionRow.project_id == project_id)
            .order_by(AgentSessionRow.updated_at.desc())
        )
        return [_to_session(row) for row in rows]

    async def get_session(self, session_id: UUID) -> AgentSession | None:
        row = await self._session.get(AgentSessionRow, session_id)
        return None if row is None else _to_session(row)

    async def rename_session(self, session_id: UUID, *, title: str) -> None:
        await self._session.execute(
            update(AgentSessionRow).where(AgentSessionRow.id == session_id).values(title=title)
        )

    # ------------------------------------------------------------------ 항목

    async def append_item(
        self,
        *,
        session_id: UUID,
        turn_id: UUID | None,
        kind: ItemKind,
        payload: Mapping[str, Any],
    ) -> AgentItem:
        # 세션 행을 잠가 순번을 한 줄로 매긴다. 세션을 최근 사용순으로 정렬하려고 시각도 바꾼다.
        await self._session.execute(
            update(AgentSessionRow)
            .where(AgentSessionRow.id == session_id)
            .values(updated_at=func.now())
        )
        current = await self._session.scalar(
            select(func.max(AgentItemRow.seq)).where(AgentItemRow.session_id == session_id)
        )
        row = AgentItemRow(
            id=uuid4(),
            session_id=session_id,
            turn_id=turn_id,
            seq=(current or 0) + 1,
            kind=kind.value,
            payload=dict(payload),
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_item(row)

    async def list_items(self, session_id: UUID, *, after_seq: int = 0) -> list[AgentItem]:
        rows = await self._session.scalars(
            select(AgentItemRow)
            .where(AgentItemRow.session_id == session_id, AgentItemRow.seq > after_seq)
            .order_by(AgentItemRow.seq)
        )
        return [_to_item(row) for row in rows]

    # ------------------------------------------------------------------ 턴

    async def create_turn(
        self, *, session_id: UUID, project_id: UUID, actor_id: UUID, request_id: UUID
    ) -> AgentTurn:
        row = AgentTurnRow(
            id=uuid4(),
            session_id=session_id,
            project_id=project_id,
            actor_id=actor_id,
            request_id=request_id,
            status=TurnStatus.QUEUED.value,
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_turn(row)

    async def turn_by_request(self, session_id: UUID, request_id: UUID) -> AgentTurn | None:
        row = await self._session.scalar(
            select(AgentTurnRow).where(
                AgentTurnRow.session_id == session_id, AgentTurnRow.request_id == request_id
            )
        )
        return None if row is None else _to_turn(row)

    async def get_turn(self, turn_id: UUID) -> AgentTurn | None:
        row = await self._session.get(AgentTurnRow, turn_id, populate_existing=True)
        return None if row is None else _to_turn(row)

    async def active_turn(self, session_id: UUID) -> AgentTurn | None:
        row = await self._session.scalar(
            select(AgentTurnRow).where(
                AgentTurnRow.session_id == session_id,
                AgentTurnRow.status.in_([s.value for s in _ACTIVE]),
            )
        )
        return None if row is None else _to_turn(row)

    async def list_turns(self, session_id: UUID) -> list[AgentTurn]:
        rows = await self._session.scalars(
            select(AgentTurnRow)
            .where(AgentTurnRow.session_id == session_id)
            .order_by(AgentTurnRow.created_at)
        )
        return [_to_turn(row) for row in rows]

    async def claim_turn(self, *, now: datetime, lease_seconds: int) -> AgentTurn | None:
        row = await self._session.scalar(
            select(AgentTurnRow)
            .where(
                or_(
                    AgentTurnRow.status == TurnStatus.QUEUED.value,
                    (AgentTurnRow.status == TurnStatus.RUNNING.value)
                    & (AgentTurnRow.lease_expires_at < now),
                )
            )
            .order_by(AgentTurnRow.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if row is None:
            return None
        row.status = TurnStatus.RUNNING.value
        row.lease_token = uuid4()
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
        row.started_at = row.started_at or now
        await self._session.flush()
        return _to_turn(row)

    async def update_turn(
        self,
        turn_id: UUID,
        *,
        lease_token: UUID,
        now: datetime,
        lease_seconds: int | None = None,
        status: TurnStatus | None = None,
        tool_calls: int | None = None,
        stop_reason: StopReason | None = None,
        pending_approval: PendingApproval | None = None,
        clear_pending: bool = False,
        error: str | None = None,
    ) -> bool:
        values: dict[str, object] = {"updated_at": now}
        if lease_seconds is not None:
            values["lease_expires_at"] = now + timedelta(seconds=lease_seconds)
        if status is not None:
            values["status"] = status.value
            if not status.is_active:
                values["finished_at"] = now
            if status is not TurnStatus.RUNNING:
                values["lease_token"] = None
                values["lease_expires_at"] = None
        if tool_calls is not None:
            values["tool_calls"] = tool_calls
        if stop_reason is not None:
            values["stop_reason"] = stop_reason.value
        if pending_approval is not None:
            values["pending_approval"] = _pending_in(pending_approval)
        if clear_pending:
            values["pending_approval"] = None
            values["approval"] = None
        if error is not None:
            values["error"] = error
        result = await self._session.execute(
            update(AgentTurnRow)
            .where(
                AgentTurnRow.id == turn_id,
                AgentTurnRow.lease_token == lease_token,
                AgentTurnRow.status == TurnStatus.RUNNING.value,
            )
            .values(**values)
        )
        return bool(getattr(result, "rowcount", 0))

    async def request_cancel(self, turn_id: UUID) -> AgentTurn | None:
        await self._session.execute(
            update(AgentTurnRow)
            .where(
                AgentTurnRow.id == turn_id,
                AgentTurnRow.status.in_([s.value for s in _ACTIVE]),
            )
            .values(cancel_requested=True)
        )
        return await self.get_turn(turn_id)

    async def resolve_approval(self, turn_id: UUID, *, approved: bool) -> AgentTurn | None:
        await self._session.execute(
            update(AgentTurnRow)
            .where(
                AgentTurnRow.id == turn_id,
                AgentTurnRow.status == TurnStatus.AWAITING_APPROVAL.value,
            )
            .values(status=TurnStatus.QUEUED.value, approval=approved)
        )
        return await self.get_turn(turn_id)

    async def cancel_waiting(self, turn_id: UUID, *, now: datetime) -> AgentTurn | None:
        await self._session.execute(
            update(AgentTurnRow)
            .where(
                AgentTurnRow.id == turn_id,
                AgentTurnRow.status.in_(
                    [TurnStatus.QUEUED.value, TurnStatus.AWAITING_APPROVAL.value]
                ),
            )
            .values(
                status=TurnStatus.CANCELLED.value,
                stop_reason=StopReason.CANCELLED.value,
                cancel_requested=True,
                pending_approval=None,
                finished_at=now,
            )
        )
        return await self.get_turn(turn_id)
