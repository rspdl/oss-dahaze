"""작업 트리 읽기 도구: compile, search, grep (ADR-0005, ADR-0008).

전부 작업 트리의 현재 원문을 입력으로 쓴다. commit 여부와 상관없다. 접근 검사는
`TreeService` 를 통해서만 한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from fnmatch import fnmatchcase
from typing import Any
from uuid import UUID

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import Conflict
from dahaze_api.application.tree import TreeService
from dahaze_api.domain.ports import PatternMatcherPort, RspdlIndexerPort
from dahaze_api.domain.rspdl import (
    RspdlIndex,
    RspdlRuntime,
    RspdlSource,
    TextPosition,
    UnparsedFile,
    byte_offset_to_position,
)
from dahaze_api.domain.tree import InvalidPattern, TreeFile

MAX_SEARCH_RESULTS = 200
MAX_GREP_RESULTS = 200
MAX_GREP_LINE_LENGTH = 500


@dataclass(frozen=True, slots=True)
class LocatedDiagnostic:
    """진단과 그 위치. `diagnostic` 은 컴파일러가 준 그대로다."""

    path: str
    start: TextPosition | None
    end: TextPosition | None
    diagnostic: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TreeCompilation:
    runtime: RspdlRuntime
    # 파일이 하나도 없으면 컴파일러를 부르지 않는다.
    compiled: bool
    diagnostics: tuple[LocatedDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class SymbolMatch:
    id: str
    kind: str
    name: str | None
    path: str
    start: TextPosition
    end: TextPosition


@dataclass(frozen=True, slots=True)
class SymbolSearch:
    matches: tuple[SymbolMatch, ...]
    # 구문 오류로 심볼을 읽지 못한 파일. "심볼이 없다" 와 "읽지 못했다" 를 구분하게 한다.
    unparsed: tuple[UnparsedFile, ...]
    truncated: bool


@dataclass(frozen=True, slots=True)
class GrepMatch:
    path: str
    line: int
    text: str


@dataclass(frozen=True, slots=True)
class GrepResult:
    matches: tuple[GrepMatch, ...]
    truncated: bool


class TreeInspector:
    def __init__(
        self,
        *,
        tree: TreeService,
        analyzer: AnalyzeWorkspace,
        indexer: RspdlIndexerPort,
        matcher: PatternMatcherPort,
        runtime: RspdlRuntime,
    ) -> None:
        self._tree = tree
        self._analyzer = analyzer
        self._indexer = indexer
        self._matcher = matcher
        self._runtime = runtime

    async def compile(self, *, actor_id: UUID, project_id: UUID) -> TreeCompilation:
        files = await self._tree.files(actor_id=actor_id, project_id=project_id)
        index, runtime = await self._index(files)
        if index is None:
            return TreeCompilation(runtime=runtime, compiled=False, diagnostics=())
        texts = {file.path: file.text for file in files}
        return TreeCompilation(
            runtime=runtime,
            compiled=True,
            diagnostics=tuple(
                _locate(entry.path, texts.get(entry.path), dict(entry.diagnostic))
                for entry in index.diagnostics
            ),
        )

    async def search(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        query: str = "",
        kind: str | None = None,
    ) -> SymbolSearch:
        """심볼 ID·이름 부분 일치. 원문 텍스트는 보지 않는다 — 그건 grep 의 일이다."""
        needle = query.strip().casefold()
        if not needle and not kind:
            raise Conflict("query 나 kind 중 하나는 있어야 한다")
        files = await self._tree.files(actor_id=actor_id, project_id=project_id)
        index, _ = await self._index(files)
        if index is None:
            return SymbolSearch(matches=(), unparsed=(), truncated=False)

        texts = {file.path: file.text for file in files}
        found = [
            symbol
            for symbol in index.symbols
            if (kind is None or symbol.kind == kind)
            and (
                not needle
                or needle in symbol.id.casefold()
                or (symbol.name is not None and needle in symbol.name.casefold())
            )
        ]
        matches = tuple(
            SymbolMatch(
                id=symbol.id,
                kind=symbol.kind,
                name=symbol.name,
                path=symbol.path,
                start=byte_offset_to_position(texts.get(symbol.path, ""), symbol.span_start),
                end=byte_offset_to_position(texts.get(symbol.path, ""), symbol.span_end),
            )
            for symbol in found[:MAX_SEARCH_RESULTS]
        )
        return SymbolSearch(
            matches=matches,
            unparsed=index.unparsed,
            truncated=len(found) > MAX_SEARCH_RESULTS,
        )

    async def grep(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        pattern: str,
        path_glob: str | None = None,
    ) -> GrepResult:
        """원문 줄 단위 정규식 검색. `path_glob` 의 `*` 는 `/` 도 넘는다."""
        try:
            matches_line = self._matcher.compile(pattern)
        except InvalidPattern as exc:
            raise Conflict(str(exc)) from exc
        files = await self._tree.files(actor_id=actor_id, project_id=project_id)

        matches: list[GrepMatch] = []
        for file in files:
            if path_glob and not fnmatchcase(file.path, path_glob):
                continue
            for number, line in enumerate(file.text.splitlines(), start=1):
                if not matches_line(line):
                    continue
                if len(matches) == MAX_GREP_RESULTS:
                    return GrepResult(matches=tuple(matches), truncated=True)
                matches.append(
                    GrepMatch(path=file.path, line=number, text=line[:MAX_GREP_LINE_LENGTH])
                )
        return GrepResult(matches=tuple(matches), truncated=False)

    async def _index(self, files: Sequence[TreeFile]) -> tuple[RspdlIndex | None, RspdlRuntime]:
        # 파일이 없으면 컴파일러를 부르지 않는다. SDK 가 빈 입력을 거부하기도 하고
        # (RSPDL-SDK-004), 결과를 지어내는 대신 결과가 없음을 그대로 돌려준다.
        if not files:
            return None, self._runtime
        outcome = await self._analyzer.compile(
            [RspdlSource(path=file.path, text=file.text) for file in files]
        )
        return self._indexer.index(outcome.result), outcome.runtime


def _locate(path: str, text: str | None, diagnostic: dict[str, Any]) -> LocatedDiagnostic:
    span = diagnostic.get("span")
    if text is None or not isinstance(span, dict):
        return LocatedDiagnostic(path=path, start=None, end=None, diagnostic=diagnostic)
    start, end = span.get("start"), span.get("end")
    if not isinstance(start, int) or not isinstance(end, int):
        return LocatedDiagnostic(path=path, start=None, end=None, diagnostic=diagnostic)
    return LocatedDiagnostic(
        path=path,
        start=byte_offset_to_position(text, start),
        end=byte_offset_to_position(text, end),
        diagnostic=diagnostic,
    )
