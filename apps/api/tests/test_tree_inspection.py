"""작업 트리의 compile·search·grep. 실제 컴파일러를 쓴다."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import Conflict, NotFound
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.domain.entities import Project, User
from dahaze_api.domain.rspdl import RspdlIndex, TextPosition, byte_offset_to_position
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler
from dahaze_api.infrastructure.rspdl.indexer import LocalRspdlIndexer
from dahaze_api.infrastructure.text import Re2PatternMatcher

INVENTORY = """@모듈 재고(inventory)

재고 항목(item)은 다음 필드들로 구성되어 있다.
    이름(name): 필수 문자열
    수량(quantity): 필수 정수

재고 항목의 수량은 0 이상이어야 한다.
"""

BROKEN = """@모듈 깨짐(broken)

재고 항목(item)은 다음 필드들로 구성되어 있다
"""


@pytest.fixture
def tree(session: AsyncSession) -> TreeService:
    return TreeService(projects=SqlProjectRepository(session), tree=SqlTreeRepository(session))


@pytest.fixture
def inspector(session: AsyncSession, tree: TreeService) -> TreeInspector:
    compiler = LocalRspdlCompiler()
    return TreeInspector(
        tree=tree,
        analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
        indexer=LocalRspdlIndexer(),
        matcher=Re2PatternMatcher(),
        runtime=compiler.runtime,
    )


@pytest.fixture
async def project(session: AsyncSession, user: User, tree: TreeService) -> Project:
    project = await SqlProjectRepository(session).create(
        owner_id=user.id,
        slug=f"inspect-{uuid4().hex[:8]}",
        name="검사",
        description=None,
        default_rspdl_version="0.1.4",
    )
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="재고")
    await tree.add(
        actor_id=user.id,
        project_id=project.id,
        parent="/재고",
        name="항목.rspdl",
        content=INVENTORY,
    )
    await tree.add(
        actor_id=user.id, project_id=project.id, parent="/", name="깨짐.rspdl", content=BROKEN
    )
    return project


# ---------------------------------------------------------------------- 위치 변환


def test_byte_offset_counts_korean_as_one_column() -> None:
    text = "@모듈 재고\n재고 항목"
    assert byte_offset_to_position(text, 0) == TextPosition(1, 1)
    # "재고 " 뒤: '재'·'고' 는 각 3바이트, 공백 1바이트
    offset = len("@모듈 재고\n재고 ".encode())
    assert byte_offset_to_position(text, offset) == TextPosition(2, 4)


def test_byte_offset_inside_character_or_out_of_range_is_clamped() -> None:
    text = "재고"
    assert byte_offset_to_position(text, 1) == TextPosition(1, 1)
    assert byte_offset_to_position(text, 999) == TextPosition(1, 3)


# ---------------------------------------------------------------------- compile


async def test_compile_locates_diagnostics_in_lines(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    result = await inspector.compile(actor_id=user.id, project_id=project.id)

    assert result.compiled
    broken = [d for d in result.diagnostics if d.path == "/깨짐.rspdl"]
    assert broken, "구문 오류 파일의 진단이 있어야 한다"
    first = broken[0]
    assert first.diagnostic["severity"] == "error"
    # 진단은 3번째 줄 "재고 항목(item)은 …" 을 가리킨다.
    assert first.start is not None and first.start.line == 3
    # 컴파일러가 준 진단은 그대로다. span 도 남아 있다.
    assert "span" in first.diagnostic


async def test_compile_empty_project_does_not_call_compiler(
    session: AsyncSession, inspector: TreeInspector, user: User
) -> None:
    empty = await SqlProjectRepository(session).create(
        owner_id=user.id,
        slug=f"empty-{uuid4().hex[:8]}",
        name="빈",
        description=None,
        default_rspdl_version="0.1.4",
    )
    result = await inspector.compile(actor_id=user.id, project_id=empty.id)
    assert not result.compiled
    assert result.diagnostics == ()


async def test_compile_skips_wireframe_layout_files(
    inspector: TreeInspector, tree: TreeService, user: User, project: Project
) -> None:
    """배치 파일은 RSPDL 이 아니다. 컴파일러에 넘기면 구문 오류 진단이 생긴다."""
    await tree.add(
        actor_id=user.id,
        project_id=project.id,
        parent="/재고",
        name="항목.wireframe.json",
        content='{"version": 1, "screens": {}}',
    )
    result = await inspector.compile(actor_id=user.id, project_id=project.id)
    assert result.compiled
    assert not [d for d in result.diagnostics if d.path.endswith(".wireframe.json")]


# ---------------------------------------------------------------------- search


async def test_search_by_korean_name_returns_location(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    found = await inspector.search(actor_id=user.id, project_id=project.id, query="재고 항목")

    models = [m for m in found.matches if m.kind == "models"]
    assert [(m.id, m.path) for m in models] == [("inventory.item", "/재고/항목.rspdl")]
    assert models[0].start.line == 3


async def test_search_by_id_prefix_includes_fields(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    found = await inspector.search(actor_id=user.id, project_id=project.id, query="inventory.item")
    assert {m.id for m in found.matches} >= {
        "inventory.item",
        "inventory.item.name",
        "inventory.item.quantity",
    }


async def test_search_filters_by_kind(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    found = await inspector.search(actor_id=user.id, project_id=project.id, kind="models.fields")
    assert {m.name for m in found.matches} == {"이름", "수량"}


async def test_search_reports_files_it_could_not_read(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    """구문 오류 파일의 심볼은 찾을 수 없다. 그 사실을 결과로 알린다."""
    found = await inspector.search(actor_id=user.id, project_id=project.id, query="broken")
    assert found.matches == ()
    assert [(u.path, u.error_count > 0) for u in found.unparsed] == [("/깨짐.rspdl", True)]


async def test_search_does_not_match_plain_text(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    # "필드들로" 는 원문에만 있는 단어다. 심볼 검색에 걸리면 안 된다.
    found = await inspector.search(actor_id=user.id, project_id=project.id, query="필드들로")
    assert found.matches == ()


async def test_search_needs_query_or_kind(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    with pytest.raises(Conflict):
        await inspector.search(actor_id=user.id, project_id=project.id, query=" ")


# ---------------------------------------------------------------------- grep


async def test_grep_returns_path_and_line(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    result = await inspector.grep(actor_id=user.id, project_id=project.id, pattern=r"필수 \S+")
    assert [(m.path, m.line) for m in result.matches] == [
        ("/재고/항목.rspdl", 4),
        ("/재고/항목.rspdl", 5),
    ]
    assert not result.truncated


async def test_grep_path_glob(inspector: TreeInspector, user: User, project: Project) -> None:
    result = await inspector.grep(
        actor_id=user.id, project_id=project.id, pattern="재고 항목", path_glob="/재고/*"
    )
    assert {m.path for m in result.matches} == {"/재고/항목.rspdl"}


async def test_grep_rejects_invalid_pattern(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    with pytest.raises(Conflict):
        await inspector.grep(actor_id=user.id, project_id=project.id, pattern="(")


async def test_grep_runs_catastrophic_pattern_in_linear_time(
    inspector: TreeInspector, tree: TreeService, user: User, project: Project
) -> None:
    await tree.add(
        actor_id=user.id,
        project_id=project.id,
        parent="/",
        name="긴줄.rspdl",
        content="a" * 50_000 + "b",
    )
    result = await inspector.grep(actor_id=user.id, project_id=project.id, pattern="(a+)+$")
    assert result.matches == ()


async def test_non_member_cannot_inspect(
    inspector: TreeInspector, other_user: User, project: Project
) -> None:
    with pytest.raises(NotFound):
        await inspector.grep(actor_id=other_user.id, project_id=project.id, pattern="a")


# ---------------------------------------------------------------------- fetch


async def test_fetch_returns_declaration_text(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    result = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.item.quantity"
    )
    [symbol] = result.symbols
    assert (symbol.kind, symbol.path, symbol.start.line) == ("models.fields", "/재고/항목.rspdl", 5)
    assert symbol.text.strip() == "수량(quantity): 필수 정수"


async def test_fetch_unknown_symbol_is_not_found(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    with pytest.raises(NotFound):
        await inspector.fetch(actor_id=user.id, project_id=project.id, symbol_id="nope.x")


class _WithReferences:
    """참조 목록을 주는 컴파일러의 결과 모양 (rspdl-core#41) 을 흉내 낸다."""

    def __init__(self, references: list[dict[str, object]]) -> None:
        self._inner = LocalRspdlIndexer()
        self._references = references

    def index(self, result: Mapping[str, Any]) -> RspdlIndex:
        return self._inner.index({**result, "references": self._references})


async def test_fetch_follows_references_both_ways(
    session: AsyncSession, tree: TreeService, user: User, project: Project
) -> None:
    compiler = LocalRspdlCompiler()
    constraint_span = {"start": INVENTORY.encode().index("재고 항목의 수량".encode()), "end": 0}
    constraint_span["end"] = len(INVENTORY.encode().rstrip())
    inspector = TreeInspector(
        tree=tree,
        analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
        indexer=_WithReferences(
            [
                {
                    "path": "/재고/항목.rspdl",
                    "from": {"kind": "constraint", "id": "inventory.constraint_1"},
                    "to": {"kind": "model", "id": "inventory.item"},
                    "field": "model_id",
                    "span": constraint_span,
                }
            ]
        ),
        matcher=Re2PatternMatcher(),
        runtime=compiler.runtime,
    )

    item = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.item"
    )
    assert item.references_supported
    [link] = item.referenced_by
    assert (link.kind, link.id, link.field, link.start.line) == (
        "constraint",
        "inventory.constraint_1",
        "model_id",
        7,
    )
    assert item.references == ()

    constraint = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.constraint_1"
    )
    assert [(r.id, r.field) for r in constraint.references] == [("inventory.item", "model_id")]


class _WithoutReferences:
    """참조 목록을 주지 않는 컴파일러(0.1.4 이하)의 결과 모양."""

    def index(self, result: Mapping[str, Any]) -> RspdlIndex:
        return LocalRspdlIndexer().index({k: v for k, v in result.items() if k != "references"})


async def test_fetch_marks_compiler_without_references(
    session: AsyncSession, tree: TreeService, user: User, project: Project
) -> None:
    """참조를 주지 않는 컴파일러면 빈 목록을 "참조 없음" 으로 읽지 않게 표시한다."""
    compiler = LocalRspdlCompiler()
    inspector = TreeInspector(
        tree=tree,
        analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
        indexer=_WithoutReferences(),
        matcher=Re2PatternMatcher(),
        runtime=compiler.runtime,
    )
    result = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.item"
    )
    assert result.references_supported is False
    assert result.referenced_by == ()


async def test_fetch_with_real_compiler_references(
    inspector: TreeInspector, user: User, project: Project
) -> None:
    """설치된 컴파일러가 참조를 줄 때만 돈다 (rspdl-core#41 이 들어간 버전)."""
    item = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.item"
    )
    if not item.references_supported:
        pytest.skip("설치된 컴파일러가 참조 목록을 주지 않는다")
    assert [(r.kind, r.field) for r in item.referenced_by] == [("constraints", "model_id")]
    quantity = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="inventory.item.quantity"
    )
    assert [(r.kind, r.field) for r in quantity.referenced_by] == [("constraints", "left")]


async def test_fetch_owner_filters_local_ids(
    session: AsyncSession, tree: TreeService, user: User, project: Project
) -> None:
    compiler = LocalRspdlCompiler()

    def ref(owner: str) -> dict[str, object]:
        return {
            "path": "/재고/항목.rspdl",
            "from": {"kind": "screens", "id": f"inventory.{owner}"},
            "to": {"kind": "screen_layouts.elements", "id": "pay", "owner_id": owner},
            "field": "source_element_id",
            "span": {"start": 0, "end": 1},
        }

    inspector = TreeInspector(
        tree=tree,
        analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
        indexer=_WithReferences([ref("desktop"), ref("mobile")]),
        matcher=Re2PatternMatcher(),
        runtime=compiler.runtime,
    )
    both = await inspector.fetch(actor_id=user.id, project_id=project.id, symbol_id="pay")
    assert len(both.referenced_by) == 2
    one = await inspector.fetch(
        actor_id=user.id, project_id=project.id, symbol_id="pay", owner_id="mobile"
    )
    assert [r.id for r in one.referenced_by] == ["inventory.mobile"]
