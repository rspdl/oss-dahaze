"""MCP 작업 트리 도구 (ADR-0005, ADR-0008).

앱 안의 AI 와 같은 도구 세트다. MCP 쓰기는 토큰 사용자 단위의 잠금 보유자(`mcp:<user>`)로
잠금을 얻고, `unlock` 으로 푼다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.errors import FolderNotEmpty, Locked, NotFound
from dahaze_api.application.tree import TreeService
from dahaze_api.domain.entities import Project, User
from dahaze_api.infrastructure.auth.session import SessionTokens
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.session import get_session
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository
from dahaze_api.interface.mcp import McpTools, mount_mcp
from dahaze_api.interface.rest.dependencies import get_compiler
from dahaze_api.main import create_app

SECRET = "test-only-secret-that-is-long-enough-32"

INVENTORY = (
    "@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
)


@pytest.fixture
def tokens() -> SessionTokens:
    return SessionTokens(SECRET)


@pytest.fixture
def tools(session: AsyncSession, tokens: SessionTokens) -> McpTools:
    @asynccontextmanager
    async def scope() -> AsyncIterator[AsyncSession]:
        yield session

    return McpTools(sessions=scope, tokens=tokens, compiler=get_compiler())


@pytest.fixture
def tree(session: AsyncSession) -> TreeService:
    return TreeService(projects=SqlProjectRepository(session), tree=SqlTreeRepository(session))


@pytest.fixture
async def project(session: AsyncSession, user: User) -> Project:
    return await SqlProjectRepository(session).create(
        owner_id=user.id,
        slug=f"mcp-tree-{uuid4().hex[:8]}",
        name="MCP 트리",
        description=None,
        default_rspdl_version="0.1.4",
    )


@pytest.fixture
def headers(tokens: SessionTokens, user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens.issue_mcp(user.id)}"}


async def test_write_search_compile_commit(
    tools: McpTools, headers: dict[str, str], project: Project
) -> None:
    pid = str(project.id)
    await tools.tree_mkdir(headers, project_id=pid, parent="/", name="재고")
    await tools.tree_add(headers, project_id=pid, parent="/재고", name="항목.rspdl", content="")
    await tools.tree_edit(headers, project_id=pid, path="/재고/항목.rspdl", content=INVENTORY)

    found = await tools.tree_search(headers, project_id=pid, query="재고 항목")
    assert [(m["id"], m["path"], m["start"]["line"]) for m in found["matches"]] == [
        ("inventory.item", "/재고/항목.rspdl", 3)
    ]
    fetched = await tools.tree_fetch(headers, project_id=pid, symbol_id="inventory.item")
    assert fetched["symbols"][0]["name"] == "재고 항목"
    compiled = await tools.tree_compile(headers, project_id=pid)
    assert compiled["compiled"] is True
    grep = await tools.tree_grep(headers, project_id=pid, pattern="필수")
    assert grep["matches"][0]["line"] == 4

    commit = await tools.tree_commit(
        headers, project_id=pid, paths=["/재고/항목.rspdl"], message="재고 항목 추가"
    )
    assert commit["seq"] == 1
    assert commit["changes"][0]["text"] == INVENTORY


async def test_mcp_write_locks_until_unlock(
    tools: McpTools, tree: TreeService, headers: dict[str, str], user: User, project: Project
) -> None:
    pid = str(project.id)
    await tools.tree_add(headers, project_id=pid, parent="/", name="a.rspdl", content="")

    listed = await tools.tree_ls(headers, project_id=pid)
    assert listed[0]["locked_by"] == f"mcp:{user.id}"
    # 사람의 저장은 막힌다.
    with pytest.raises(Locked):
        await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")

    assert await tools.tree_unlock(headers, project_id=pid) == {"released": 1}
    await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")


async def test_delete_non_empty_folder_needs_recursive(
    tools: McpTools, headers: dict[str, str], project: Project
) -> None:
    pid = str(project.id)
    await tools.tree_mkdir(headers, project_id=pid, parent="/", name="a")
    await tools.tree_add(headers, project_id=pid, parent="/a", name="f.rspdl", content="")
    with pytest.raises(FolderNotEmpty):
        await tools.tree_delete(headers, project_id=pid, path="/a")
    deleted = await tools.tree_delete(headers, project_id=pid, path="/a", recursive=True)
    assert deleted == {"deleted_files": ["/a/f.rspdl"]}


async def test_mv_keeps_file_id(tools: McpTools, headers: dict[str, str], project: Project) -> None:
    pid = str(project.id)
    created = await tools.tree_add(headers, project_id=pid, parent="/", name="a.rspdl", content="")
    moved = await tools.tree_mv(headers, project_id=pid, source="/a.rspdl", target="/b.rspdl")
    assert [(f["id"], f["path"]) for f in moved] == [(created["id"], "/b.rspdl")]


async def test_foreign_project_is_invisible(
    tools: McpTools, tokens: SessionTokens, other_user: User, project: Project
) -> None:
    stranger = {"Authorization": f"Bearer {tokens.issue_mcp(other_user.id)}"}
    with pytest.raises(NotFound):
        await tools.tree_ls(stranger, project_id=str(project.id))


async def test_unlock_does_not_release_other_users_locks(
    tools: McpTools,
    tree: TreeService,
    tokens: SessionTokens,
    headers: dict[str, str],
    other_user: User,
    project: Project,
) -> None:
    await tools.tree_add(
        headers, project_id=str(project.id), parent="/", name="a.rspdl", content=""
    )
    stranger = {"Authorization": f"Bearer {tokens.issue_mcp(other_user.id)}"}
    assert await tools.tree_unlock(stranger) == {"released": 0}


async def test_tree_tool_round_trip_over_http(
    session: AsyncSession, tools: McpTools, headers: dict[str, str], project: Project
) -> None:
    app = create_app()

    async def _session_override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _session_override
    mount_mcp(app, tools=tools)
    call_headers = {"Accept": "application/json, text/event-stream", **headers}

    def call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as mcp,
    ):
        added = await mcp.post(
            "/mcp",
            json=call(
                "add",
                {"project_id": str(project.id), "parent": "/", "name": "a.rspdl", "content": "x"},
            ),
            headers=call_headers,
        )
        assert not added.json()["result"].get("isError"), added.text
        read = await mcp.post(
            "/mcp",
            json=call("read", {"project_id": str(project.id), "path": "/a.rspdl"}),
            headers=call_headers,
        )
    assert read.json()["result"]["structuredContent"]["text"] == "x"
