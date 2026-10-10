"""`AgentScope` 조립. REST 요청과 worker 가 같은 방법으로 만든다."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dahaze_api.application.agent import AgentScope
from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.infrastructure.db.agent_repository import (
    SqlAgentRepository,
    SqlAgentSettings,
    SqlProjectEvents,
)
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository
from dahaze_api.infrastructure.rspdl.indexer import LocalRspdlIndexer
from dahaze_api.infrastructure.text import Re2PatternMatcher


def build_tree(session: AsyncSession) -> TreeService:
    """작업 트리 유스케이스. 변경은 항상 프로젝트 이벤트로 기록한다."""
    return TreeService(
        projects=SqlProjectRepository(session),
        tree=SqlTreeRepository(session),
        events=SqlProjectEvents(session),
    )


def build_inspector(
    session: AsyncSession, tree: TreeService, compiler: RspdlCompilerPort
) -> TreeInspector:
    return TreeInspector(
        tree=tree,
        analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
        indexer=LocalRspdlIndexer(),
        matcher=Re2PatternMatcher(),
        runtime=compiler.runtime,
    )


def build_agent_scope(session: AsyncSession, compiler: RspdlCompilerPort) -> AgentScope:
    tree = build_tree(session)
    return AgentScope(
        agents=SqlAgentRepository(session),
        events=SqlProjectEvents(session),
        settings=SqlAgentSettings(session),
        projects=SqlProjectRepository(session),
        tree=tree,
        inspector=build_inspector(session, tree, compiler),
    )


def agent_scopes(
    sessions: async_sessionmaker[AsyncSession], compiler: RspdlCompilerPort
) -> Callable[[], AbstractAsyncContextManager[AgentScope]]:
    """스코프 하나에 트랜잭션 하나. 정상 종료면 커밋하고, 예외면 롤백한다."""

    @asynccontextmanager
    async def scope() -> AsyncIterator[AgentScope]:
        async with sessions() as session:
            try:
                yield build_agent_scope(session, compiler)
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    return scope
