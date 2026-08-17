"""테스트 픽스처.

**실제 Postgres 에 붙는다.** SQLite 로 대체하지 않는 이유: JSONB, 부분 유니크 인덱스,
`ON CONFLICT DO NOTHING` 이 전부 방언에 의존한다. 이것들이 프로덕션에서만 다르게 동작하면
테스트가 통과해도 아무것도 보장하지 못한다.

    docker compose -f deploy/docker-compose.dev.yml up -d
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.domain.entities import ExternalIdentity, User
from dahaze_api.infrastructure.db.models import Base
from dahaze_api.infrastructure.db.repositories import SqlUserRepository
from dahaze_api.infrastructure.db.session import get_session, to_asyncpg_url
from dahaze_api.interface.rest.dependencies import get_current_user
from dahaze_api.main import create_app

DEFAULT_TEST_DB = "postgresql://dahaze:dahaze@localhost:55432/dahaze_test"


def _test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB)


def _admin_database_url() -> str:
    """테스트 DB 를 만들려면 다른 DB 에 붙어 있어야 한다.

    TEST_DATABASE_URL 에서 데이터베이스 이름만 바꿔 쓴다. 접속 정보를 두 벌 두면
    CI 와 로컬에서 한쪽만 고치는 일이 생긴다.
    """
    base, _, _ = _test_database_url().rpartition("/")
    return f"{base}/postgres"


@pytest.fixture(scope="session")
async def _database() -> AsyncIterator[None]:
    """테스트 DB 를 만들고 스키마를 세운다.

    스키마는 마이그레이션이 아니라 `create_all` 로 만든다. 마이그레이션 자체의 정합성은
    별도 검사 대상이고, 여기서는 모델과 코드가 맞는지만 본다.
    """
    admin = create_async_engine(
        to_asyncpg_url(_admin_database_url()), isolation_level="AUTOCOMMIT"
    )
    db_name = _test_database_url().rsplit("/", 1)[-1]
    async with admin.connect() as conn:
        await conn.exec_driver_sql(f'DROP DATABASE IF EXISTS "{db_name}"')
        await conn.exec_driver_sql(f'CREATE DATABASE "{db_name}"')
    await admin.dispose()

    engine = create_async_engine(to_asyncpg_url(_test_database_url()))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

    yield


@pytest.fixture
async def session(_database: None) -> AsyncIterator[AsyncSession]:
    """테스트 하나에 세션 하나. 끝나면 롤백해 다음 테스트에 상태를 남기지 않는다."""
    engine = create_async_engine(to_asyncpg_url(_test_database_url()))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
        await s.rollback()
    await engine.dispose()


@pytest.fixture
async def user(session: AsyncSession) -> User:
    """로그인한 사용자 하나."""
    created = await SqlUserRepository(session).create_from_identity(
        ExternalIdentity(
            provider="github",
            provider_user_id=str(uuid4()),
            login="tester",
            email="tester@example.com",
        )
    )
    await session.commit()
    return created


@pytest.fixture
async def other_user(session: AsyncSession) -> User:
    """다른 사람. 접근 격리를 검사할 때 쓴다."""
    created = await SqlUserRepository(session).create_from_identity(
        ExternalIdentity(
            provider="github",
            provider_user_id=str(uuid4()),
            login="stranger",
        )
    )
    await session.commit()
    return created


def _build_client(session: AsyncSession, current: User | None) -> httpx.AsyncClient:
    app = create_app()

    async def _session_override() -> AsyncIterator[AsyncSession]:
        # 테스트 전체가 한 세션을 공유해야 픽스처가 만든 데이터가 보인다.
        yield session

    app.dependency_overrides[get_session] = _session_override
    if current is not None:
        app.dependency_overrides[get_current_user] = lambda: current

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture
async def client(session: AsyncSession, user: User) -> AsyncIterator[httpx.AsyncClient]:
    """`user` 로 로그인한 클라이언트."""
    async with _build_client(session, user) as c:
        yield c


@pytest.fixture
async def other_client(
    session: AsyncSession, other_user: User
) -> AsyncIterator[httpx.AsyncClient]:
    """다른 사용자로 로그인한 클라이언트."""
    async with _build_client(session, other_user) as c:
        yield c


@pytest.fixture
async def anon_client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    """로그인하지 않은 클라이언트."""
    async with _build_client(session, None) as c:
        yield c
