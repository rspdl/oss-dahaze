"""컴파일 결과 캐시의 Postgres 구현체.

이 테이블은 언제 비워도 데이터 손실이 아니다 (ADR-0003). 캐시 키에 `rspdl_version` 이
들어 있어 버전을 올리면 자동으로 무효가 되므로, 무효화 로직이 따로 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.rspdl import AnalysisKind, AnalysisOutcome, RspdlRuntime
from dahaze_api.infrastructure.db.models import CompilationRow


class SqlAnalysisCache:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, cache_key: str) -> AnalysisOutcome | None:
        row = await self._session.get(CompilationRow, cache_key)
        if row is None:
            return None

        # 사용 흔적은 best-effort 다. 실패해도 캐시 적중 자체를 망치지 않는다.
        await self._session.execute(
            update(CompilationRow)
            .where(CompilationRow.cache_key == cache_key)
            .values(last_accessed_at=datetime.now(UTC), hits=CompilationRow.hits + 1)
        )

        return AnalysisOutcome(
            kind=AnalysisKind(row.kind),
            runtime=RspdlRuntime(
                rspdl_version=row.rspdl_version,
                wire_schema_version=row.wire_schema_version,
                locale=row.locale,
            ),
            result=cast(dict[str, Any], row.result),
        )

    async def put(self, cache_key: str, outcome: AnalysisOutcome) -> None:
        # 같은 키를 두 요청이 동시에 계산할 수 있다. 결과는 결정적이므로 어느 쪽이
        # 이겨도 같은 값이다 — 충돌은 무시한다.
        stmt = (
            pg_insert(CompilationRow)
            .values(
                cache_key=cache_key,
                kind=str(outcome.kind),
                rspdl_version=outcome.runtime.rspdl_version,
                wire_schema_version=outcome.runtime.wire_schema_version,
                locale=outcome.runtime.locale,
                result=dict(outcome.result),
            )
            .on_conflict_do_nothing(index_elements=["cache_key"])
        )
        await self._session.execute(stmt)
