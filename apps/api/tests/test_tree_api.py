"""작업 트리·commit REST 계약 (ADR-0008)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.tree import TreeService
from dahaze_api.domain.entities import User
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository

BROKEN = "@모듈 깨짐(broken)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다\n"


@pytest.fixture
async def project_id(client: httpx.AsyncClient) -> str:
    response = await client.post(
        "/api/projects", json={"slug": f"tree-{uuid4().hex[:8]}", "name": "트리"}
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def _add(client: httpx.AsyncClient, project_id: str, name: str, content: str = "") -> Any:
    response = await client.post(
        f"/api/projects/{project_id}/tree/files",
        json={"parent": "/", "name": name, "content": content},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_save_read_and_list(client: httpx.AsyncClient, project_id: str) -> None:
    folder = await client.post(
        f"/api/projects/{project_id}/tree/folders", json={"parent": "/", "name": "주문"}
    )
    assert folder.status_code == 201
    created = await client.post(
        f"/api/projects/{project_id}/tree/files",
        json={"parent": "/주문", "name": "결제.rspdl", "content": "v1"},
    )
    assert created.status_code == 201

    saved = await client.put(
        f"/api/projects/{project_id}/tree/file",
        json={"path": "/주문/결제.rspdl", "content": "v2"},
    )
    assert saved.status_code == 200
    assert saved.json()["text"] == "v2"
    assert saved.json()["change"] == "add"

    listed = await client.get(f"/api/projects/{project_id}/tree")
    assert [(e["kind"], e["path"]) for e in listed.json()] == [
        ("folder", "/주문"),
        ("file", "/주문/결제.rspdl"),
    ]
    read = await client.get(
        f"/api/projects/{project_id}/tree/file", params={"path": "/주문/결제.rspdl"}
    )
    assert read.json()["text"] == "v2"


async def test_bad_request_body_is_422(client: httpx.AsyncClient, project_id: str) -> None:
    response = await client.post(f"/api/projects/{project_id}/tree/files", json={"parent": "/"})
    assert response.status_code == 422
    response = await client.post(
        f"/api/projects/{project_id}/commits", json={"paths": [], "message": "m"}
    )
    assert response.status_code == 422


async def test_invalid_path_is_409(client: httpx.AsyncClient, project_id: str) -> None:
    response = await client.post(
        f"/api/projects/{project_id}/tree/files",
        json={"parent": "/", "name": "../x.rspdl", "content": ""},
    )
    assert response.status_code == 409


async def test_saving_file_locked_by_ai_is_409_locked(
    session: AsyncSession, client: httpx.AsyncClient, user: User, project_id: str
) -> None:
    await _add(client, project_id, "a.rspdl")
    ai = TreeService(projects=SqlProjectRepository(session), tree=SqlTreeRepository(session))
    await ai.edit(
        actor_id=user.id,
        project_id=UUID(project_id),
        path="/a.rspdl",
        content="ai",
        holder="session:ai",
    )

    response = await client.put(
        f"/api/projects/{project_id}/tree/file", json={"path": "/a.rspdl", "content": "me"}
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "locked"
    assert detail["paths"] == ["/a.rspdl"]
    assert detail["holders"] == ["session:ai"]
    listed = await client.get(f"/api/projects/{project_id}/tree")
    assert listed.json()[0]["locked_by"] == "session:ai"


async def test_deleting_non_empty_folder_is_409_folder_not_empty(
    client: httpx.AsyncClient, project_id: str
) -> None:
    await client.post(f"/api/projects/{project_id}/tree/folders", json={"parent": "/", "name": "a"})
    await client.post(
        f"/api/projects/{project_id}/tree/files",
        json={"parent": "/a", "name": "f.rspdl", "content": ""},
    )
    response = await client.post(f"/api/projects/{project_id}/tree/delete", json={"path": "/a"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "folder_not_empty"
    assert response.json()["detail"]["entries"] == 1

    response = await client.post(
        f"/api/projects/{project_id}/tree/delete", json={"path": "/a", "recursive": True}
    )
    assert response.status_code == 200
    assert response.json() == {"deleted_files": ["/a/f.rspdl"]}


async def test_move_keeps_file_id(client: httpx.AsyncClient, project_id: str) -> None:
    created = await _add(client, project_id, "a.rspdl")
    response = await client.post(
        f"/api/projects/{project_id}/tree/move", json={"source": "/a.rspdl", "target": "/b.rspdl"}
    )
    assert response.status_code == 200
    assert [(f["id"], f["path"]) for f in response.json()] == [(created["id"], "/b.rspdl")]


async def test_commit_flow(client: httpx.AsyncClient, project_id: str) -> None:
    await _add(client, project_id, "a.rspdl", "v1\n")
    await _add(client, project_id, "b.rspdl", "v1\n")

    changes = await client.get(f"/api/projects/{project_id}/tree/changes")
    assert [f["path"] for f in changes.json()] == ["/a.rspdl", "/b.rspdl"]

    commit = await client.post(
        f"/api/projects/{project_id}/commits", json={"paths": ["/a.rspdl"], "message": "a 추가"}
    )
    assert commit.status_code == 201
    body = commit.json()
    assert body["seq"] == 1
    assert body["changes"][0]["kind"] == "add"
    assert body["changes"][0]["text"] == "v1\n"

    listed = await client.get(f"/api/projects/{project_id}/commits")
    assert [c["id"] for c in listed.json()] == [body["id"]]
    fetched = await client.get(f"/api/commits/{body['id']}")
    assert fetched.json()["message"] == "a 추가"

    again = await client.post(
        f"/api/projects/{project_id}/commits", json={"paths": ["/a.rspdl"], "message": "다시"}
    )
    assert again.status_code == 409


async def test_compile_diagnostics_are_200(client: httpx.AsyncClient, project_id: str) -> None:
    """진단은 오류 응답이 아니다. 에디터가 위치를 표시하려면 200 안에 있어야 한다."""
    await _add(client, project_id, "깨짐.rspdl", BROKEN)

    response = await client.get(f"/api/projects/{project_id}/tree/compile")

    assert response.status_code == 200
    body = response.json()
    assert body["compiled"] is True
    diagnostic = body["diagnostics"][0]
    assert diagnostic["path"] == "/깨짐.rspdl"
    assert diagnostic["start"]["line"] == 3
    assert diagnostic["diagnostic"]["severity"] == "error"


async def test_search_and_grep(client: httpx.AsyncClient, project_id: str) -> None:
    await _add(
        client,
        project_id,
        "재고.rspdl",
        "@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
        "    이름(name): 필수 문자열\n",
    )
    await _add(client, project_id, "깨짐.rspdl", BROKEN)

    search = await client.get(
        f"/api/projects/{project_id}/tree/search", params={"query": "재고 항목"}
    )
    assert search.status_code == 200
    assert [m["id"] for m in search.json()["matches"]] == ["inventory.item"]
    assert search.json()["unparsed"] == [{"path": "/깨짐.rspdl", "error_count": 1}]

    grep = await client.get(f"/api/projects/{project_id}/tree/grep", params={"pattern": "필수"})
    assert grep.json()["matches"] == [
        {"path": "/재고.rspdl", "line": 4, "text": "    이름(name): 필수 문자열"}
    ]

    bad = await client.get(f"/api/projects/{project_id}/tree/grep", params={"pattern": "("})
    assert bad.status_code == 409


async def test_non_member_gets_404(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, project_id: str
) -> None:
    created = await _add(client, project_id, "a.rspdl")
    assert (await other_client.get(f"/api/projects/{project_id}/tree")).status_code == 404
    assert (
        await other_client.put(
            f"/api/projects/{project_id}/tree/file", json={"path": "/a.rspdl", "content": ""}
        )
    ).status_code == 404
    commit = await client.post(
        f"/api/projects/{project_id}/commits", json={"paths": ["/a.rspdl"], "message": "m"}
    )
    assert created["id"]
    assert (await other_client.get(f"/api/commits/{commit.json()['id']}")).status_code == 404
