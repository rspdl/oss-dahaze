"""비동기 DB 엔진과 세션.

`DATABASE_URL` 은 배포 환경이 주는 형태(`postgresql://`)를 그대로 받아 asyncpg 드라이버로
바꾼다. 운영자가 연결 문자열을 손으로 편집하게 만들지 않기 위해서다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from dahaze_api.config import get_settings


def to_asyncpg_url(url: str) -> str:
    """`postgresql://` → `postgresql+asyncpg://`.

    이미 드라이버가 지정돼 있으면 건드리지 않는다.
    """
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        to_asyncpg_url(settings.database_url),
        pool_pre_ping=True,
        connect_args={
            # 트랜잭션 풀러(PgBouncer/Supavisor) 뒤에서는 prepared statement 캐시가
            # 세션을 넘나들며 깨진다. 풀러를 쓰지 않더라도 안전한 설정이다.
            "statement_cache_size": 0,
        },
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """요청 하나에 세션 하나. 예외가 나면 롤백한다."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
