"""작업 트리 쓰기의 동시성 (ADR-0008).

두 연결이 실제로 동시에 트랜잭션을 여는 상황을 본다. 공유 세션 픽스처로는 재현되지 않는다.
테스트가 만든 프로젝트는 끝나면 지운다.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.application.errors import Locked
from dahaze_api.application.tree import TreeService
from dahaze_api.domain.entities import ExternalIdentity
from dahaze_api.infrastructure.db.models import FileLockRow, ProjectRow, UserRow
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository, SqlUserRepository
from dahaze_api.infrastructure.db.session import to_asyncpg_url
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository

DEFAULT_TEST_DB = "postgresql://dahaze:dahaze@localhost:55432/dahaze_test"


@pytest.fixture
async def sessions(_database: None) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        to_asyncpg_url(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB))
    )
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def seeded(
    sessions: async_sessionmaker[AsyncSession],
) -> AsyncIterator[tuple[UUID, UUID]]:
    """커밋된 사용자·프로젝트·파일 하나. 끝나면 지운다."""
    async with sessions() as s:
        user = await SqlUserRepository(s).create_from_identity(
            ExternalIdentity(provider="github", provider_user_id=str(uuid4()), login="racer")
        )
        project = await SqlProjectRepository(s).create(
            owner_id=user.id,
            slug=f"race-tree-{uuid4().hex[:8]}",
            name="경쟁",
            description=None,
            default_rspdl_version="0.1.4",
        )
        await s.commit()
        await _service(s).add(
            actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content=""
        )
        await s.commit()

    yield user.id, project.id

    async with sessions() as s:
        await s.execute(delete(ProjectRow).where(ProjectRow.id == project.id))
        await s.execute(delete(UserRow).where(UserRow.id == user.id))
        await s.commit()


def _service(session: AsyncSession) -> TreeService:
    return TreeService(projects=SqlProjectRepository(session), tree=SqlTreeRepository(session))


async def test_two_ai_holders_racing_on_one_file_get_one_lock(
    sessions: async_sessionmaker[AsyncSession], seeded: tuple[UUID, UUID]
) -> None:
    user_id, project_id = seeded
    start = asyncio.Event()

    async def write(holder: str) -> str:
        async with sessions() as s:
            await start.wait()
            try:
                await _service(s).edit(
                    actor_id=user_id,
                    project_id=project_id,
                    path="/a.rspdl",
                    content=holder,
                    holder=holder,
                )
            except Locked:
                await s.rollback()
                return "locked"
            await s.commit()
            return "ok"

    tasks = [asyncio.create_task(write(f"session:{n}")) for n in range(4)]
    start.set()
    outcomes = await asyncio.gather(*tasks)

    assert sorted(outcomes) == ["locked", "locked", "locked", "ok"]
    async with sessions() as s:
        holders = (
            await s.scalars(select(FileLockRow.holder).where(FileLockRow.project_id == project_id))
        ).all()
        file = await _service(s).read(actor_id=user_id, project_id=project_id, path="/a.rspdl")
    # 잠금을 쥔 쪽이 쓴 원문만 남는다.
    assert holders == [file.text]


async def test_human_save_and_ai_write_serialize(
    sessions: async_sessionmaker[AsyncSession], seeded: tuple[UUID, UUID]
) -> None:
    """사람의 저장과 AI 쓰기가 겹치면 둘 중 하나만 이긴다. 섞인 상태는 남지 않는다."""
    user_id, project_id = seeded
    start = asyncio.Event()

    async def write(holder: str | None) -> str:
        async with sessions() as s:
            await start.wait()
            try:
                await _service(s).edit(
                    actor_id=user_id,
                    project_id=project_id,
                    path="/a.rspdl",
                    content=holder or "human",
                    holder=holder,
                )
            except Locked:
                await s.rollback()
                return "locked"
            await s.commit()
            return "ok"

    tasks = [asyncio.create_task(write(None)), asyncio.create_task(write("session:ai"))]
    start.set()
    human, ai = await asyncio.gather(*tasks)

    async with sessions() as s:
        file = await _service(s).read(actor_id=user_id, project_id=project_id, path="/a.rspdl")
    # AI 는 잠금이 없으면 항상 이긴다. 사람이 먼저 저장했으면 AI 가 덮어쓴다.
    assert ai == "ok"
    assert file.text == "session:ai"
    assert human in ("ok", "locked")
