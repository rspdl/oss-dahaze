"""RSPDL 분석 유스케이스.

컴파일 결과는 전부 파생물이므로 (ADR-0003), 이 계층이 하는 일은 캐시를 조회하고,
없으면 컴파일러에게 묻고, 결과에 정체를 붙여 저장하는 것뿐이다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from dahaze_api.domain.ports import AnalysisCachePort, RspdlCompilerPort
from dahaze_api.domain.rspdl import (
    AnalysisKind,
    AnalysisOutcome,
    RspdlSource,
    workspace_hash,
)


class AnalyzeWorkspace:
    """소스 집합을 컴파일러에 통과시킨다. 같은 입력은 같은 결과를 재사용한다."""

    def __init__(
        self,
        *,
        compiler: RspdlCompilerPort,
        cache: AnalysisCachePort,
    ) -> None:
        self._compiler = compiler
        self._cache = cache

    async def compile(self, sources: Sequence[RspdlSource]) -> AnalysisOutcome:
        key = self._key(AnalysisKind.COMPILE, sources)
        if (hit := await self._cache.get(key)) is not None:
            return hit
        outcome = await self._compiler.compile(sources)
        await self._cache.put(key, outcome)
        return outcome

    async def check(
        self,
        sources: Sequence[RspdlSource],
        data: Mapping[str, Any],
    ) -> AnalysisOutcome:
        # runtime data 가 결과를 바꾸므로 키에 포함한다.
        key = self._key(AnalysisKind.CHECK, sources, extra={"data": data})
        if (hit := await self._cache.get(key)) is not None:
            return hit
        outcome = await self._compiler.check(sources, data)
        await self._cache.put(key, outcome)
        return outcome

    async def find_model(
        self,
        source: RspdlSource,
        *,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> AnalysisOutcome:
        # 같은 소스라도 scope 에 따라 SAT / UNSAT_WITHIN_BOUND 가 갈린다. timeout 은
        # `unknown` 을 낳을 수 있으므로 이것도 결과를 바꾸는 입력이다.
        extra = {"scope_per_model": scope_per_model, "timeout_ms": timeout_ms}
        key = self._key(AnalysisKind.FIND_MODEL, [source], extra=extra)
        if (hit := await self._cache.get(key)) is not None:
            return hit
        outcome = await self._compiler.find_model(
            source, scope_per_model=scope_per_model, timeout_ms=timeout_ms
        )
        await self._cache.put(key, outcome)
        return outcome

    def _key(
        self,
        kind: AnalysisKind,
        sources: Sequence[RspdlSource],
        *,
        extra: Mapping[str, Any] | None = None,
    ) -> str:
        """캐시 키. 컴파일러 정체가 키에 들어가므로 버전을 올리면 캐시가 저절로 무효화된다."""
        runtime = self._compiler.runtime
        return workspace_hash(
            sources,
            locale=runtime.locale,
            extra={
                "kind": str(kind),
                "rspdl_version": runtime.rspdl_version,
                "wire_schema_version": runtime.wire_schema_version,
                **(extra or {}),
            },
        )
