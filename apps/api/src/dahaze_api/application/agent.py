"""AI 대화 세션과 턴 실행 (ADR-0005, ADR-0008).

`AgentService` 는 사람의 요청(세션 만들기, 메시지 보내기, 승인, 취소)을 받는다. 메시지를
보내면 턴이 대기열에 들어가고, worker 가 `AgentTurnRunner` 로 그 턴을 실행한다.

턴 실행은 "모델 호출 → 도구 실행 → 결과를 붙여 다시 모델 호출" 의 반복이다. 도구 호출은
하나마다 따로 커밋한다. 사람 화면에 변경이 바로 보이고, worker 가 중간에 죽어도 거기까지의
기록이 남는다. 턴의 상태는 전부 대화 항목에 있으므로 다른 worker 가 이어서 실행할 수 있다.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from dahaze_api.application.agent_tools import TOOL_SPECS, AgentToolbox
from dahaze_api.application.errors import Conflict, NotFound
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.domain.agent import (
    MAX_TOOL_CALLS_PER_TURN,
    AgentContext,
    AgentItem,
    AgentSession,
    AgentSettings,
    AgentStep,
    AgentTurn,
    ItemKind,
    PendingApproval,
    StopReason,
    ToolCall,
    ToolOutcome,
    TurnStatus,
    session_lock_holder,
)
from dahaze_api.domain.events import EventType
from dahaze_api.domain.ports import (
    AgentLlmPort,
    AgentRepositoryPort,
    AgentSettingsPort,
    ProjectEventsPort,
    ProjectRepositoryPort,
)

DEFAULT_SESSION_TITLE = "새 대화"
MAX_MESSAGE_LENGTH = 20_000
LEASE_SECONDS = 120
# 답변 텍스트를 이 간격으로 묶어 이벤트 하나로 쓴다. 토큰마다 쓰면 DB 쓰기가 너무 많다.
TEXT_FLUSH_SECONDS = 0.1

TOOL_LIMIT_MESSAGE = f"도구를 {MAX_TOOL_CALLS_PER_TURN}번 불러서 여기서 멈췄어요. 계속할까요?"
LOCK_EXPIRED_MESSAGE = (
    "파일 잠금이 마지막 쓰기부터 10분이 지나 풀렸어요. 다른 사람이 그 파일을 바꿨을 수 "
    "있어서 작업을 멈췄어요."
)
INTERRUPTED_RESULT = (
    "worker 가 이 도구 호출 도중 멈춰 결과를 알 수 없다. ls·read 로 상태를 확인한다."
)
SKIPPED_RESULT = (
    "앞선 도구 호출이 사용자 승인을 기다려 이 호출은 실행하지 않았다. 필요하면 다시 부른다."
)
DENIED_RESULT = "사용자가 이 삭제를 거절했다. 지우지 않았다."


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class AgentScope:
    """트랜잭션 하나에서 쓰는 저장소와 유스케이스. 스코프가 끝날 때 커밋한다."""

    agents: AgentRepositoryPort
    events: ProjectEventsPort
    settings: AgentSettingsPort
    projects: ProjectRepositoryPort
    tree: TreeService
    inspector: TreeInspector


ScopeFactory = Callable[[], AbstractAsyncContextManager[AgentScope]]


async def _item_event(scope: AgentScope, project_id: UUID, item: AgentItem) -> None:
    # 원문 전체가 든 payload 는 싣지 않는다. 화면은 seq 이후 항목을 다시 읽는다.
    await scope.events.append(
        project_id=project_id,
        type=EventType.AGENT_ITEM,
        payload={
            "session_id": str(item.session_id),
            "turn_id": str(item.turn_id) if item.turn_id else None,
            "seq": item.seq,
            "kind": item.kind.value,
        },
    )


async def _turn_event(scope: AgentScope, turn: AgentTurn) -> None:
    await scope.events.append(
        project_id=turn.project_id,
        type=EventType.AGENT_TURN,
        payload={
            "session_id": str(turn.session_id),
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "stop_reason": turn.stop_reason.value if turn.stop_reason else None,
        },
    )


# ====================================================================== 요청


class AgentService:
    """사람이 부르는 AI 세션 유스케이스. 요청 하나가 스코프 하나다."""

    def __init__(self, scope: AgentScope, *, clock: Callable[[], datetime] = _utcnow) -> None:
        self._s = scope
        self._clock = clock

    async def create_session(
        self, *, actor_id: UUID, project_id: UUID, title: str | None = None
    ) -> AgentSession:
        await self._s.tree.require_member(actor_id=actor_id, project_id=project_id, write=True)
        return await self._s.agents.create_session(
            project_id=project_id,
            created_by=actor_id,
            title=(title or "").strip()[:200] or DEFAULT_SESSION_TITLE,
        )

    async def list_sessions(self, *, actor_id: UUID, project_id: UUID) -> list[AgentSession]:
        await self._s.tree.require_member(actor_id=actor_id, project_id=project_id)
        return await self._s.agents.list_sessions(project_id)

    async def get_session(self, *, actor_id: UUID, session_id: UUID) -> AgentSession:
        session = await self._s.agents.get_session(session_id)
        if session is None:
            raise NotFound("대화를 찾을 수 없다")
        await self._s.tree.require_member(actor_id=actor_id, project_id=session.project_id)
        return session

    async def list_items(
        self, *, actor_id: UUID, session_id: UUID, after_seq: int = 0
    ) -> list[AgentItem]:
        await self.get_session(actor_id=actor_id, session_id=session_id)
        return await self._s.agents.list_items(session_id, after_seq=after_seq)

    async def list_turns(self, *, actor_id: UUID, session_id: UUID) -> list[AgentTurn]:
        await self.get_session(actor_id=actor_id, session_id=session_id)
        return await self._s.agents.list_turns(session_id)

    async def send_message(
        self, *, actor_id: UUID, session_id: UUID, text: str, request_id: UUID
    ) -> AgentTurn:
        """메시지를 기록하고 턴을 대기열에 넣는다. 같은 `request_id` 는 한 번만 처리한다."""
        session = await self.get_session(actor_id=actor_id, session_id=session_id)
        await self._s.tree.require_member(
            actor_id=actor_id, project_id=session.project_id, write=True
        )
        text = text.strip()
        if not text:
            raise Conflict("메시지가 비어 있다")
        if len(text) > MAX_MESSAGE_LENGTH:
            raise Conflict(f"메시지는 {MAX_MESSAGE_LENGTH}자 이하여야 한다")

        # 같은 요청의 재전송이면 이미 만든 턴을 돌려준다. 메시지를 두 번 기록하지 않는다.
        existing = await self._s.agents.turn_by_request(session_id, request_id)
        if existing is not None:
            return existing
        if await self._s.agents.active_turn(session_id) is not None:
            raise Conflict("이 대화에서 AI 가 아직 응답하고 있다")

        turn = await self._s.agents.create_turn(
            session_id=session_id,
            project_id=session.project_id,
            actor_id=actor_id,
            request_id=request_id,
        )
        item = await self._s.agents.append_item(
            session_id=session_id,
            turn_id=turn.id,
            kind=ItemKind.USER_MESSAGE,
            payload={"text": text},
        )
        await _item_event(self._s, session.project_id, item)
        await _turn_event(self._s, turn)
        return turn

    async def resolve_approval(self, *, actor_id: UUID, turn_id: UUID, approved: bool) -> AgentTurn:
        turn = await self._turn(actor_id, turn_id, write=True)
        if turn.status is not TurnStatus.AWAITING_APPROVAL:
            raise Conflict("승인을 기다리는 턴이 아니다")
        resolved = await self._s.agents.resolve_approval(turn_id, approved=approved)
        assert resolved is not None
        await _turn_event(self._s, resolved)
        return resolved

    async def cancel(self, *, actor_id: UUID, turn_id: UUID) -> AgentTurn:
        """대기 중이거나 승인을 기다리는 턴은 바로 끝낸다. 실행 중이면 worker 가 멈춘다."""
        turn = await self._turn(actor_id, turn_id, write=True)
        if not turn.status.is_active:
            return turn
        if turn.status is TurnStatus.RUNNING:
            cancelled = await self._s.agents.request_cancel(turn_id)
        else:
            cancelled = await self._s.agents.cancel_waiting(turn_id, now=self._clock())
            await self._s.tree.release_locks(
                holder=session_lock_holder(turn.session_id), project_id=turn.project_id
            )
        assert cancelled is not None
        await _turn_event(self._s, cancelled)
        return cancelled

    async def get_settings(self, *, actor_id: UUID) -> AgentSettings:
        return await self._s.settings.get(actor_id)

    async def put_settings(self, *, actor_id: UUID, settings: AgentSettings) -> AgentSettings:
        return await self._s.settings.put(actor_id, settings)

    async def _turn(self, actor_id: UUID, turn_id: UUID, *, write: bool) -> AgentTurn:
        turn = await self._s.agents.get_turn(turn_id)
        if turn is None:
            raise NotFound("턴을 찾을 수 없다")
        await self._s.tree.require_member(
            actor_id=actor_id, project_id=turn.project_id, write=write
        )
        return turn


# ====================================================================== 실행


class _LeaseLost(Exception):
    """다른 worker 가 이 턴을 가져갔다. 아무것도 더 쓰지 않고 멈춘다."""


@dataclass(frozen=True, slots=True)
class _Loaded:
    turn: AgentTurn
    items: list[AgentItem]
    context: AgentContext


class AgentTurnRunner:
    """worker 가 턴 하나를 끝까지 실행한다."""

    def __init__(
        self,
        *,
        scopes: ScopeFactory,
        llm: AgentLlmPort,
        planning_profile: bool,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._scopes = scopes
        self._llm = llm
        self._planning_profile = planning_profile
        self._clock = clock

    async def run_once(self) -> bool:
        """대기 중인 턴 하나를 가져와 실행한다. 가져올 턴이 없으면 거짓."""
        async with self._scopes() as scope:
            turn = await scope.agents.claim_turn(now=self._clock(), lease_seconds=LEASE_SECONDS)
            if turn is not None:
                await _turn_event(scope, turn)
        if turn is None:
            return False
        await self.run(turn)
        return True

    async def run(self, turn: AgentTurn) -> None:
        assert turn.lease_token is not None
        token = turn.lease_token
        try:
            await self._resume(turn, token)
            await self._loop(turn, token)
        except _LeaseLost:
            return
        except Exception as exc:  # noqa: BLE001 — 어떤 실패든 턴을 끝내고 잠금을 푼다
            await self._finish(
                turn, token, TurnStatus.FAILED, StopReason.ERROR, error=_describe(exc)
            )

    # ------------------------------------------------------------------ 루프

    async def _loop(self, turn: AgentTurn, token: UUID) -> None:
        holder = session_lock_holder(turn.session_id)
        lock_conflict = False
        while True:
            loaded = await self._load(turn, token)
            current = loaded.turn
            if current.cancel_requested:
                await self._finish(turn, token, TurnStatus.CANCELLED, StopReason.CANCELLED)
                return
            if lock_conflict:
                # 잠금 충돌 뒤에는 도구 없이 사용자에게 알리는 답변만 받는다.
                await self._step(turn, token, loaded, allow_tools=False)
                await self._finish(turn, token, TurnStatus.COMPLETED, StopReason.LOCK_CONFLICT)
                return
            if current.tool_calls >= MAX_TOOL_CALLS_PER_TURN:
                await self._say(turn, token, TOOL_LIMIT_MESSAGE)
                await self._finish(turn, token, TurnStatus.COMPLETED, StopReason.TOOL_LIMIT)
                return
            async with self._scopes() as scope:
                expired = await scope.tree.locks_expired(holder=holder)
            if expired:
                await self._say(turn, token, LOCK_EXPIRED_MESSAGE)
                await self._finish(turn, token, TurnStatus.COMPLETED, StopReason.LOCK_EXPIRED)
                return

            step = await self._step(turn, token, loaded, allow_tools=True)
            if not step.tool_calls:
                await self._finish(turn, token, TurnStatus.COMPLETED, StopReason.DONE)
                return

            count = current.tool_calls
            for index, call in enumerate(step.tool_calls):
                count += 1
                outcome = await self._execute(turn, call, recursive=False)
                if outcome.needs_approval is not None:
                    await self._pause_for_approval(
                        turn, token, call, outcome, step.tool_calls[index + 1 :], count
                    )
                    return
                await self._record_result(turn, token, call, outcome, tool_calls=count)
                if outcome.lock_conflict:
                    lock_conflict = True
                    await self._skip(turn, token, step.tool_calls[index + 1 :], SKIPPED_LOCK)
                    break

    async def _resume(self, turn: AgentTurn, token: UUID) -> None:
        """승인 결정을 반영하고, 결과 없이 남은 도구 호출을 정리한다."""
        pending = turn.pending_approval
        if pending is not None and turn.approval is not None:
            call = ToolCall(call_id=pending.call_id, name=pending.name, arguments=pending.arguments)
            if turn.approval:
                async with self._scopes() as scope:
                    # 승인을 기다린 시간은 잠금 만료에 넣지 않는다.
                    await scope.tree.touch_locks(holder=session_lock_holder(turn.session_id))
                outcome = await self._execute(turn, call, recursive=True)
            else:
                outcome = ToolOutcome(ok=False, output={"error": DENIED_RESULT})
            await self._record_result(turn, token, call, outcome, clear_pending=True)

        async with self._scopes() as scope:
            items = await scope.agents.list_items(turn.session_id)
        answered = {
            item.payload.get("call_id") for item in items if item.kind is ItemKind.TOOL_RESULT
        }
        dangling = [
            ToolCall(
                call_id=str(item.payload["call_id"]),
                name=str(item.payload["name"]),
                arguments=dict(item.payload.get("arguments") or {}),
            )
            for item in items
            if item.kind is ItemKind.TOOL_CALL
            and item.turn_id == turn.id
            and item.payload.get("call_id") not in answered
        ]
        await self._skip(turn, token, dangling, INTERRUPTED_RESULT)

    # ------------------------------------------------------------------ 단계

    async def _load(self, turn: AgentTurn, token: UUID) -> _Loaded:
        async with self._scopes() as scope:
            current = await scope.agents.get_turn(turn.id)
            if current is None or current.lease_token != token:
                raise _LeaseLost
            items = await scope.agents.list_items(turn.session_id)
            project = await scope.projects.get(turn.project_id)
        return _Loaded(
            turn=current,
            items=items,
            context=AgentContext(
                project_name=project.name if project else "",
                planning_profile=self._planning_profile,
            ),
        )

    async def _step(
        self, turn: AgentTurn, token: UUID, loaded: _Loaded, *, allow_tools: bool
    ) -> AgentStep:
        buffer: list[str] = []
        last_flush = time.monotonic()

        async def flush() -> None:
            nonlocal last_flush
            if not buffer:
                return
            delta = "".join(buffer)
            buffer.clear()
            last_flush = time.monotonic()
            async with self._scopes() as scope:
                await scope.events.append(
                    project_id=turn.project_id,
                    type=EventType.AGENT_TEXT_DELTA,
                    payload={
                        "session_id": str(turn.session_id),
                        "turn_id": str(turn.id),
                        "delta": delta,
                    },
                )

        async def on_text(delta: str) -> None:
            buffer.append(delta)
            if time.monotonic() - last_flush >= TEXT_FLUSH_SECONDS:
                await flush()

        step = await self._llm.step(
            context=loaded.context,
            items=loaded.items,
            tools=TOOL_SPECS,
            allow_tools=allow_tools,
            on_text=on_text,
        )
        await flush()

        async with self._scopes() as scope:
            await self._renew(scope, turn, token)
            if step.text:
                item = await scope.agents.append_item(
                    session_id=turn.session_id,
                    turn_id=turn.id,
                    kind=ItemKind.ASSISTANT_MESSAGE,
                    payload={"text": step.text},
                )
                await _item_event(scope, turn.project_id, item)
            for call in step.tool_calls if allow_tools else ():
                item = await scope.agents.append_item(
                    session_id=turn.session_id,
                    turn_id=turn.id,
                    kind=ItemKind.TOOL_CALL,
                    payload={
                        "call_id": call.call_id,
                        "name": call.name,
                        "arguments": dict(call.arguments),
                    },
                )
                await _item_event(scope, turn.project_id, item)
        return step if allow_tools else AgentStep(text=step.text)

    async def _execute(self, turn: AgentTurn, call: ToolCall, *, recursive: bool) -> ToolOutcome:
        """도구 하나를 자기 트랜잭션에서 실행한다. 끝나면 바로 커밋되어 화면에 보인다."""
        async with self._scopes() as scope:
            toolbox = AgentToolbox(
                tree=scope.tree,
                inspector=scope.inspector,
                actor_id=turn.actor_id,
                project_id=turn.project_id,
                holder=session_lock_holder(turn.session_id),
            )
            outcome = await toolbox.execute(call, recursive_delete=recursive)
            if outcome.needs_approval is None or recursive:
                return outcome
            settings = await scope.settings.get(turn.actor_id)
        if settings.auto_approve_recursive_delete:
            return await self._execute(turn, call, recursive=True)
        return outcome

    async def _record_result(
        self,
        turn: AgentTurn,
        token: UUID,
        call: ToolCall,
        outcome: ToolOutcome,
        *,
        tool_calls: int | None = None,
        clear_pending: bool = False,
    ) -> None:
        async with self._scopes() as scope:
            await self._renew(
                scope, turn, token, tool_calls=tool_calls, clear_pending=clear_pending
            )
            item = await scope.agents.append_item(
                session_id=turn.session_id,
                turn_id=turn.id,
                kind=ItemKind.TOOL_RESULT,
                payload={
                    "call_id": call.call_id,
                    "name": call.name,
                    "ok": outcome.ok,
                    "output": outcome.output,
                    "changes": [change.as_payload() for change in outcome.changes],
                },
            )
            await _item_event(scope, turn.project_id, item)

    async def _skip(
        self, turn: AgentTurn, token: UUID, calls: Sequence[ToolCall], reason: str
    ) -> None:
        for call in calls:
            await self._record_result(
                turn, token, call, ToolOutcome(ok=False, output={"error": reason})
            )

    async def _pause_for_approval(
        self,
        turn: AgentTurn,
        token: UUID,
        call: ToolCall,
        outcome: ToolOutcome,
        rest: Sequence[ToolCall],
        tool_calls: int,
    ) -> None:
        """사용자 승인을 기다린다. 잠금은 풀지 않는다 — 기다리는 동안 대상이 바뀌지 않게."""
        await self._skip(turn, token, rest, SKIPPED_RESULT)
        async with self._scopes() as scope:
            updated = await scope.agents.update_turn(
                turn.id,
                lease_token=token,
                now=self._clock(),
                tool_calls=tool_calls,
                pending_approval=PendingApproval(
                    call_id=call.call_id,
                    name=call.name,
                    arguments=dict(call.arguments),
                    reason=outcome.needs_approval or "",
                ),
                status=TurnStatus.AWAITING_APPROVAL,
            )
            if not updated:
                raise _LeaseLost
            current = await scope.agents.get_turn(turn.id)
            assert current is not None
            await _turn_event(scope, current)

    async def _say(self, turn: AgentTurn, token: UUID, text: str) -> None:
        async with self._scopes() as scope:
            await self._renew(scope, turn, token)
            item = await scope.agents.append_item(
                session_id=turn.session_id,
                turn_id=turn.id,
                kind=ItemKind.ASSISTANT_MESSAGE,
                payload={"text": text},
            )
            await _item_event(scope, turn.project_id, item)

    async def _finish(
        self,
        turn: AgentTurn,
        token: UUID,
        status: TurnStatus,
        reason: StopReason,
        *,
        error: str | None = None,
    ) -> None:
        async with self._scopes() as scope:
            updated = await scope.agents.update_turn(
                turn.id,
                lease_token=token,
                now=self._clock(),
                status=status,
                stop_reason=reason,
                error=error,
            )
            if not updated:
                return
            await scope.tree.release_locks(
                holder=session_lock_holder(turn.session_id), project_id=turn.project_id
            )
            current = await scope.agents.get_turn(turn.id)
            assert current is not None
            await _turn_event(scope, current)

    async def _renew(
        self,
        scope: AgentScope,
        turn: AgentTurn,
        token: UUID,
        *,
        tool_calls: int | None = None,
        clear_pending: bool = False,
    ) -> None:
        renewed = await scope.agents.update_turn(
            turn.id,
            lease_token=token,
            now=self._clock(),
            lease_seconds=LEASE_SECONDS,
            tool_calls=tool_calls,
            clear_pending=clear_pending,
        )
        if not renewed:
            raise _LeaseLost


SKIPPED_LOCK = "앞선 도구 호출이 잠금 충돌로 멈춰 이 호출은 실행하지 않았다."


def _describe(exc: Exception) -> str:
    message = str(exc) or type(exc).__name__
    return message[:1000]
