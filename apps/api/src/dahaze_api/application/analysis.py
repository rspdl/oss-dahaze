"""RSPDL 분석 유스케이스.

컴파일 결과는 전부 파생물이므로 (ADR-0003), 이 계층이 하는 일은 캐시를 조회하고,
없으면 컴파일러에게 묻고, 결과에 정체를 붙여 저장하는 것뿐이다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Document
from dahaze_api.domain.ports import AnalysisCachePort, RspdlCompilerPort
from dahaze_api.domain.rspdl import (
    AnalysisKind,
    AnalysisOutcome,
    RspdlRuntime,
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


@dataclass(frozen=True, slots=True)
class ProjectCompilation:
    """프로젝트 전체를 한 워크스페이스로 컴파일한 결과.

    문서를 함께 돌려주는 이유는 IR 이 문서를 모르기 때문이다. 컴파일 결과의 `files[].path`
    는 소스 경로일 뿐이라, 그것만으로는 "이 정책이 어느 문서에서 왔는가" 를 화면이 말할 수
    없다. 경로 ↔ 문서를 잇는 일은 dahaze 의 몫이고 IR 을 건드리지 않는다.
    """

    documents: tuple[Document, ...]
    outcome: AnalysisOutcome | None
    runtime: RspdlRuntime


class CompileProject:
    """프로젝트의 문서 전부를 한 워크스페이스로 컴파일한다.

    정책 검토처럼 **프로젝트 전체가 단위인 화면**을 위한 유스케이스다. 화면이 문서를 하나씩
    컴파일해 이어 붙이면 요청이 문서 수만큼 늘고, 진단이 언제 다 모이는지 알 수 없어 화면이
    부분적으로 갱신된다.

    소스를 한 덩어리로 넘기는 것은 컴파일러가 워크스페이스를 입력 단위로 받기 때문이다.
    그 안에서 파일이 서로를 참조할 수 있는지는 컴파일러가 정한다 — rspdl 0.1.0 에서
    모듈은 파일마다 독립이지만, dahaze 는 그 규칙을 알 필요도 흉내낼 이유도 없다. 소스
    집합을 통째로 넘기고 돌아온 결과를 그대로 전한다.

    접근 검사는 `WorkspaceService` 를 통해서만 한다. 저장소를 직접 부르면 REST 와 MCP 의
    검사가 갈라진다.
    """

    def __init__(
        self,
        *,
        workspace: WorkspaceService,
        analyzer: AnalyzeWorkspace,
        compiler: RspdlCompilerPort,
    ) -> None:
        self._workspace = workspace
        self._analyzer = analyzer
        self._compiler = compiler

    async def __call__(self, *, actor_id: UUID, project_id: UUID) -> ProjectCompilation:
        documents = await self._workspace.list_documents(
            actor_id=actor_id, project_id=project_id
        )

        # 소스가 하나도 없으면 컴파일러를 부르지 않는다. SDK 가 빈 입력을 거부하기도 하지만
        # (RSPDL-SDK-004), 그보다 부를 이유가 없다 — 결과를 지어내는 대신 결과가 없음을
        # 그대로 돌려주고, 화면이 "아직 문서가 없다" 를 말하게 한다.
        if not documents:
            return ProjectCompilation(
                documents=(), outcome=None, runtime=self._compiler.runtime
            )

        outcome = await self._analyzer.compile(
            [RspdlSource(path=d.path, text=d.text) for d in documents]
        )
        return ProjectCompilation(
            documents=tuple(documents), outcome=outcome, runtime=outcome.runtime
        )
