"""작업 트리의 compile·search·grep. 실제 컴파일러를 쓴다."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import Conflict, NotFound
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.domain.entities import Project, User
from dahaze_api.domain.rspdl import TextPosition, byte_offset_to_position
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
