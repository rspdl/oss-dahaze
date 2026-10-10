"""프로젝트 이벤트 구독 (SSE 의 뒤쪽).

API 프로세스마다 PostgreSQL 연결 하나로 `LISTEN` 하고, 알림이 오면 그 프로젝트를 구독하는
SSE 요청들을 깨운다. 이벤트 내용은 알림에 싣지 않는다 — 깨어난 쪽이 `seq` 이후를 DB 에서
읽는다. 그래서 알림을 놓쳐도 다음 조회에서 빠짐없이 받는다.

SSE 는 오래 열려 있으므로 요청 세션을 쓰지 않는다. 요청 세션은 응답이 끝날 때까지 DB 연결을
잡고 있어서, 구독자 수만큼 연결 풀을 차지한다. 조회마다 짧은 세션을 연다.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dahaze_api.domain.events import ProjectEvent
from dahaze_api.infrastructure.agent_scope import build_tree
from dahaze_api.infrastructure.db.agent_repository import EVENTS_CHANNEL, SqlProjectEvents

logger = logging.getLogger(__name__)


def to_plain_dsn(url: str) -> str:
    """asyncpg 는 `postgresql+asyncpg://` 를 모른다."""
    for prefix in ("postgresql+asyncpg://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix) :]
    return url


class PgEventListener:
    def __init__(self, dsn: str) -> None:
        self._dsn = to_plain_dsn(dsn)
        self._conn: Any = None
        self._lock = asyncio.Lock()
        self._subscribers: dict[str, set[asyncio.Event]] = defaultdict(set)

    @property
    def listening(self) -> bool:
        return self._conn is not None and not self._conn.is_closed()

    async def _ensure(self) -> None:
        async with self._lock:
            if self.listening:
                return
            try:
                self._conn = await asyncpg.connect(self._dsn)
                await self._conn.add_listener(EVENTS_CHANNEL, self._notify)
            except (OSError, asyncpg.PostgresError) as exc:
                # LISTEN 을 못 해도 SSE 는 짧은 간격으로 다시 조회해 동작한다.
                logger.warning("프로젝트 이벤트 LISTEN 실패, 조회로 대신한다: %s", exc)
                self._conn = None

    def _notify(self, _conn: Any, _pid: int, _channel: str, payload: str) -> None:
        for event in self._subscribers.get(payload, ()):
            event.set()

    @asynccontextmanager
    async def subscribe(self, project_id: UUID) -> AsyncIterator[asyncio.Event]:
        await self._ensure()
        event = asyncio.Event()
        key = str(project_id)
        self._subscribers[key].add(event)
        try:
            yield event
        finally:
            self._subscribers[key].discard(event)
            if not self._subscribers[key]:
                del self._subscribers[key]

    async def close(self) -> None:
        if self._conn is not None:
            with contextlib.suppress(Exception):
                await self._conn.close()
            self._conn = None


class ProjectEventFeed:
    """SSE 요청이 쓰는 조회·권한 확인·구독."""

    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], listener: PgEventListener
    ) -> None:
        self._sessions = sessions
        self._listener = listener

    @property
    def listening(self) -> bool:
        return self._listener.listening

    async def require_member(self, *, user_id: UUID, project_id: UUID) -> None:
        async with self._sessions() as session:
            await build_tree(session).require_member(actor_id=user_id, project_id=project_id)

    async def load(self, *, project_id: UUID, after_seq: int, limit: int) -> list[ProjectEvent]:
        async with self._sessions() as session:
            return await SqlProjectEvents(session).list_after(
                project_id=project_id, after_seq=after_seq, limit=limit
            )

    def subscribe(self, project_id: UUID) -> contextlib.AbstractAsyncContextManager[asyncio.Event]:
        return self._listener.subscribe(project_id)
