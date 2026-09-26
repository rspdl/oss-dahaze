"""AI 대화와 프로젝트 이벤트 엔드포인트 (ADR-0005, ADR-0008).

메시지를 보내면 `202` 와 함께 턴이 대기열에 들어간다. 진행 상황은 프로젝트 이벤트 스트림
(SSE)으로 받고, 대화 기록은 `seq` 이후를 다시 읽는다.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Cookie, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.domain.agent import AgentSettings
from dahaze_api.infrastructure.auth.session import InvalidToken
from dahaze_api.infrastructure.event_feed import ProjectEventFeed
from dahaze_api.interface.rest.agent_schemas import (
    AgentItemResponse,
    AgentSessionResponse,
    AgentSettingsBody,
    AgentTurnResponse,
    CreateAgentSessionRequest,
    ProjectEventResponse,
    ResolveApprovalRequest,
    SendAgentMessageRequest,
    event_out,
    item_out,
    session_out,
    settings_out,
    turn_out,
)
from dahaze_api.interface.rest.dependencies import (
    SESSION_COOKIE,
    Agents,
    CurrentUser,
    EventFeed,
    ProjectEvents,
    Tokens,
    Tree,
)

router = APIRouter(prefix="/api", tags=["agent"])

# 이벤트가 없어도 이 간격마다 주석 한 줄을 보내 프록시가 연결을 끊지 않게 한다.
KEEPALIVE_SECONDS = 15.0
# LISTEN 을 못 할 때 다시 조회하는 간격.
FALLBACK_POLL_SECONDS = 2.0
EVENT_BATCH = 200


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# ------------------------------------------------------------------ 세션


@router.post(
    "/projects/{project_id}/agent/sessions",
    name="create_agent_session",
    status_code=status.HTTP_201_CREATED,
)
async def create_agent_session(
    project_id: UUID, body: CreateAgentSessionRequest, user: CurrentUser, agents: Agents
) -> AgentSessionResponse:
    with _http_errors():
        session = await agents.create_session(
            actor_id=user.id, project_id=project_id, title=body.title
        )
    return session_out(session)


@router.get("/projects/{project_id}/agent/sessions", name="list_agent_sessions")
async def list_agent_sessions(
    project_id: UUID, user: CurrentUser, agents: Agents
) -> list[AgentSessionResponse]:
    """최근에 대화한 세션이 먼저."""
    with _http_errors():
        sessions = await agents.list_sessions(actor_id=user.id, project_id=project_id)
    return [session_out(s) for s in sessions]


@router.get("/agent/sessions/{session_id}", name="get_agent_session")
async def get_agent_session(
    session_id: UUID, user: CurrentUser, agents: Agents
) -> AgentSessionResponse:
    with _http_errors():
        session = await agents.get_session(actor_id=user.id, session_id=session_id)
    return session_out(session)


@router.get("/agent/sessions/{session_id}/items", name="list_agent_items")
async def list_agent_items(
    session_id: UUID,
    user: CurrentUser,
    agents: Agents,
    after_seq: int = Query(default=0, ge=0, description="이 순번 이후만 돌려준다"),
) -> list[AgentItemResponse]:
    with _http_errors():
        items = await agents.list_items(
            actor_id=user.id, session_id=session_id, after_seq=after_seq
        )
    return [item_out(i) for i in items]


@router.get("/agent/sessions/{session_id}/turns", name="list_agent_turns")
async def list_agent_turns(
    session_id: UUID, user: CurrentUser, agents: Agents
) -> list[AgentTurnResponse]:
    with _http_errors():
        turns = await agents.list_turns(actor_id=user.id, session_id=session_id)
    return [turn_out(t) for t in turns]


@router.post(
    "/agent/sessions/{session_id}/messages",
    name="send_agent_message",
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_agent_message(
    session_id: UUID, body: SendAgentMessageRequest, user: CurrentUser, agents: Agents
) -> AgentTurnResponse:
    """메시지를 기록하고 턴을 대기열에 넣는다. AI 가 아직 응답 중이면 409."""
    with _http_errors():
        turn = await agents.send_message(
            actor_id=user.id, session_id=session_id, text=body.text, request_id=body.request_id
        )
    return turn_out(turn)


# ------------------------------------------------------------------ 턴


@router.post("/agent/turns/{turn_id}/approval", name="resolve_agent_approval")
async def resolve_agent_approval(
    turn_id: UUID, body: ResolveApprovalRequest, user: CurrentUser, agents: Agents
) -> AgentTurnResponse:
    with _http_errors():
        turn = await agents.resolve_approval(
            actor_id=user.id, turn_id=turn_id, approved=body.approved
        )
    return turn_out(turn)


@router.post("/agent/turns/{turn_id}/cancel", name="cancel_agent_turn")
async def cancel_agent_turn(turn_id: UUID, user: CurrentUser, agents: Agents) -> AgentTurnResponse:
    with _http_errors():
        turn = await agents.cancel(actor_id=user.id, turn_id=turn_id)
    return turn_out(turn)


# ------------------------------------------------------------------ 설정


@router.get("/me/agent-settings", name="get_agent_settings")
async def get_agent_settings(user: CurrentUser, agents: Agents) -> AgentSettingsBody:
    return settings_out(await agents.get_settings(actor_id=user.id))


@router.put("/me/agent-settings", name="update_agent_settings")
async def update_agent_settings(
    body: AgentSettingsBody, user: CurrentUser, agents: Agents
) -> AgentSettingsBody:
    settings = await agents.put_settings(
        actor_id=user.id,
        settings=AgentSettings(auto_approve_recursive_delete=body.auto_approve_recursive_delete),
    )
    return settings_out(settings)


# ------------------------------------------------------------------ 이벤트


@router.get("/projects/{project_id}/events", name="list_project_events")
async def list_project_events(
    project_id: UUID,
    user: CurrentUser,
    tree: Tree,
    project_events: ProjectEvents,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=EVENT_BATCH, ge=1, le=1000),
) -> list[ProjectEventResponse]:
    """SSE 와 같은 이벤트를 JSON 으로 돌려준다. 재접속 전 따라잡기와 타입 생성용이다."""
    with _http_errors():
        await tree.require_member(actor_id=user.id, project_id=project_id)
    events = await project_events.list_after(
        project_id=project_id, after_seq=after_seq, limit=limit
    )
    return [event_out(e) for e in events]


@router.get(
    "/projects/{project_id}/events/stream",
    name="stream_project_events",
    # SSE 는 생성 클라이언트로 부를 수 없다. 이벤트 모양은 `list_project_events` 가 문서화한다.
    include_in_schema=False,
)
async def stream_project_events(
    project_id: UUID,
    request: Request,
    tokens: Tokens,
    feed: EventFeed,
    after_seq: int = Query(default=0, ge=0),
    last_event_id: Annotated[str | None, Header()] = None,
    dahaze_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> StreamingResponse:
    """프로젝트 이벤트 SSE. 재접속하면 `Last-Event-ID` 이후부터 다시 보낸다.

    `CurrentUser` 를 쓰지 않는다. 그 의존성은 요청 세션을 응답이 끝날 때까지 잡는다.
    """
    if not dahaze_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요하다")
    try:
        user_id = tokens.verify(dahaze_session)
    except InvalidToken as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 유효하지 않다") from exc
    with _http_errors():
        await feed.require_member(user_id=user_id, project_id=project_id)

    cursor = after_seq
    if last_event_id and last_event_id.isdigit():
        cursor = max(cursor, int(last_event_id))
    return StreamingResponse(
        sse_frames(feed, project_id, cursor, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def sse_frames(
    feed: ProjectEventFeed,
    project_id: UUID,
    cursor: int,
    is_disconnected: Callable[[], Awaitable[bool]],
    *,
    keepalive: float = KEEPALIVE_SECONDS,
) -> AsyncGenerator[str, None]:
    yield "retry: 3000\n\n"
    async with feed.subscribe(project_id) as wake:
        while not await is_disconnected():
            # 조회 전에 비운다. 조회하는 사이에 온 알림은 남아서 다음 대기를 바로 깨운다.
            wake.clear()
            events = await feed.load(project_id=project_id, after_seq=cursor, limit=EVENT_BATCH)
            for event in events:
                cursor = event.seq
                data = event_out(event).model_dump_json()
                yield f"id: {event.seq}\nevent: {event.type}\ndata: {data}\n\n"
            if len(events) == EVENT_BATCH:
                continue
            timeout = keepalive if feed.listening else FALLBACK_POLL_SECONDS
            try:
                await asyncio.wait_for(wake.wait(), timeout=timeout)
            except TimeoutError:
                yield ": keepalive\n\n"
