"""작업 트리 읽기 도구: compile, search, grep (ADR-0005, ADR-0008).

전부 작업 트리의 현재 원문을 입력으로 쓴다. commit 여부와 상관없다. 접근 검사는
`TreeService` 를 통해서만 한다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from fnmatch import fnmatchcase
from typing import Any
from uuid import UUID

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import Conflict, NotFound
from dahaze_api.application.tree import TreeService
from dahaze_api.domain.ports import PatternMatcherPort, RspdlIndexerPort
from dahaze_api.domain.rspdl import (
    RspdlIndex,
    RspdlReference,
    RspdlRuntime,
    RspdlSource,
    SymbolLocator,
    TextPosition,
    UnparsedFile,
    byte_offset_to_position,
)
from dahaze_api.domain.tree import InvalidPattern, TreeFile, is_rspdl_path

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
class LinkedSymbol:
    """fetch 결과의 연결 한 줄. 위치는 참조하는 레코드의 원문 위치다."""

    kind: str
    id: str
    owner_id: str | None
    field: str
    path: str
    start: TextPosition
    end: TextPosition


@dataclass(frozen=True, slots=True)
class FetchedSymbol:
    id: str
    kind: str
    name: str | None
    path: str
    start: TextPosition
    end: TextPosition
    # 심볼 선언의 원문 구간.
    text: str


@dataclass(frozen=True, slots=True)
class SymbolFetch:
    # 같은 ID 가 여러 파일에 있을 수 있다(local ID).
    symbols: tuple[FetchedSymbol, ...]
    # 이 심볼을 가리키는 쪽.
    referenced_by: tuple[LinkedSymbol, ...]
    # 이 심볼이 가리키는 쪽.
    references: tuple[LinkedSymbol, ...]
    # 컴파일러가 참조 목록을 주지 않으면 거짓. 이때 두 목록은 비어 있어도 "참조 없음" 이 아니다.
    references_supported: bool
    unparsed: tuple[UnparsedFile, ...]


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

    async def fetch(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        symbol_id: str,
        owner_id: str | None = None,
    ) -> SymbolFetch:
        """심볼 원문과, 그 심볼을 가리키는·그 심볼이 가리키는 심볼 ID (rspdl-core#41).

        화면 요소 같은 local ID 는 소속(`owner_id`)마다 따로 있다. `owner_id` 를 주면 그 소속의
        참조만 고른다.
        """
        symbol_id = symbol_id.strip()
        if not symbol_id:
            raise Conflict("심볼 ID 가 필요하다")
        files = await self._tree.files(actor_id=actor_id, project_id=project_id)
        index, _ = await self._index(files)
        if index is None:
            raise NotFound(f"심볼이 없다: {symbol_id}")
        texts = {file.path: file.text for file in files}

        def position(path: str, offset: int) -> TextPosition:
            return byte_offset_to_position(texts.get(path, ""), offset)

        symbols = tuple(
            FetchedSymbol(
                id=symbol.id,
                kind=symbol.kind,
                name=symbol.name,
                path=symbol.path,
                start=position(symbol.path, symbol.span_start),
                end=position(symbol.path, symbol.span_end),
                text=_slice_bytes(texts.get(symbol.path, ""), symbol.span_start, symbol.span_end),
            )
            for symbol in index.symbols
            if symbol.id == symbol_id
        )

        def linked(reference: RspdlReference, other: SymbolLocator) -> LinkedSymbol:
            return LinkedSymbol(
                kind=other.kind,
                id=other.id,
                owner_id=other.owner_id,
                field=reference.field,
                path=reference.path,
                start=position(reference.path, reference.span_start),
                end=position(reference.path, reference.span_end),
            )

        referenced_by = tuple(
            linked(r, r.source) for r in index.references if _names(r.target, symbol_id, owner_id)
        )
        references = tuple(
            linked(r, r.target) for r in index.references if _names(r.source, symbol_id, owner_id)
        )
        if not symbols and not referenced_by and not references:
            raise NotFound(f"심볼이 없다: {symbol_id}. search 로 다시 찾는다")
        return SymbolFetch(
            symbols=symbols,
            referenced_by=referenced_by,
            references=references,
            references_supported=index.references_supported,
            unparsed=index.unparsed,
        )

    async def check_wireframe_layout(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        document_path: str,
        screen_id: str,
        layout: Mapping[str, Any],
    ) -> list[str]:
        """배치 트리의 문서 요소가 그 화면에 선언된 자리에 있는지. 문제를 사람이 읽을 문장으로.

        화면은 모르는 요소와 영역 밖 요소를 무시하거나 제자리로 돌려보낸다. 저장 전에 알려야
        AI 가 고칠 수 있다. 문서를 읽지 못하면(구문 오류 등) 검사하지 않는다.
        """
        if '"type": "element"' not in json.dumps(layout):
            return []  # 디자인 전용 노드만 있으면 문서와 맞출 것이 없다.
        files = await self._tree.files(actor_id=actor_id, project_id=project_id)
        index, _ = await self._index(files)
        if index is None or any(entry.path == document_path for entry in index.unparsed):
            return []
        declared = index.screen_elements.get((document_path, screen_id))
        if declared is None:
            return [f"{document_path} 에 레이아웃이 선언된 화면 {screen_id} 가 없다"]
        by_id = {element.id: element for element in declared}
        problems: list[str] = []

        def walk(node: Any, owner: str | None) -> None:
            if not isinstance(node, Mapping):
                return
            next_owner = owner
            if node.get("type") == "element":
                ref = node.get("ref")
                element_id = ref[3:] if isinstance(ref, str) and ref.startswith("id:") else None
                found = None if element_id is None else by_id.get(element_id)
                if found is None:
                    problems.append(f"모르는 요소 ref {ref!r}")
                else:
                    if found.owner_id != owner:
                        where = (
                            f"`id:{found.owner_id}` 노드의 children" if found.owner_id else "루트"
                        )
                        problems.append(f"`{ref}` 는 {where} 안(그 아래 프레임 포함)에 둬야 한다")
                    next_owner = found.id
            for child in node.get("children") or []:
                walk(child, next_owner)

        walk(layout, None)
        if problems:
            tree = ", ".join(
                f"{e.id}({e.kind}{'' if e.owner_id is None else ' ⊂ ' + e.owner_id})"
                for e in declared
            )
            problems.append(f"이 화면에 선언된 요소: {tree}")
        return problems

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
        # 컴파일러에는 `.rspdl` 만 넘긴다. 와이어프레임 배치 파일은 RSPDL 이 아니다.
        sources = [file for file in files if is_rspdl_path(file.path)]
        # 파일이 없으면 컴파일러를 부르지 않는다. SDK 가 빈 입력을 거부하기도 하고
        # (RSPDL-SDK-004), 결과를 지어내는 대신 결과가 없음을 그대로 돌려준다.
        if not sources:
            return None, self._runtime
        outcome = await self._analyzer.compile(
            [RspdlSource(path=file.path, text=file.text) for file in sources]
        )
        return self._indexer.index(outcome.result), outcome.runtime


def _names(locator: SymbolLocator, symbol_id: str, owner_id: str | None) -> bool:
    return locator.id == symbol_id and (owner_id is None or locator.owner_id == owner_id)


def _slice_bytes(text: str, start: int, end: int) -> str:
    encoded = text.encode("utf-8")
    return encoded[max(0, start) : max(0, end)].decode("utf-8", "replace")


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
