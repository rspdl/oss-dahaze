"""프로젝트·멤버 엔드포인트의 HTTP 계약 테스트.

가장 중요한 것은 **접근 격리**다. 한 사용자가 여러 프로젝트를 갖고, 프로젝트마다 멤버가
다르므로, 남의 프로젝트가 새어 나가는 경로가 없어야 한다.
"""

from __future__ import annotations

import httpx
import pytest

from dahaze_api.domain.entities import User


async def _create_project(client: httpx.AsyncClient, slug: str) -> dict[str, object]:
    response = await client.post("/api/projects", json={"slug": slug, "name": f"{slug} 프로젝트"})
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


# ------------------------------------------------------------------ 프로젝트


async def test_create_project_defaults_to_server_rspdl_version(
    client: httpx.AsyncClient,
) -> None:
    """버전을 지정하지 않으면 서버 컴파일러 버전을 기본으로 삼는다."""
    project = await _create_project(client, "inventory")

    runtime = (await client.get("/api/analysis/runtime")).json()
    assert project["default_rspdl_version"] == runtime["rspdl_version"]


async def test_user_can_own_multiple_projects(client: httpx.AsyncClient) -> None:
    """한 사용자가 여러 프로젝트를 관리할 수 있다."""
    await _create_project(client, "alpha")
    await _create_project(client, "beta")
    await _create_project(client, "gamma")

    response = await client.get("/api/projects")

    assert response.status_code == 200
    slugs = sorted(p["slug"] for p in response.json())
    assert slugs == ["alpha", "beta", "gamma"]


async def test_duplicate_slug_is_rejected(client: httpx.AsyncClient) -> None:
    await _create_project(client, "duplicate")

    response = await client.post("/api/projects", json={"slug": "duplicate", "name": "또 하나"})

    assert response.status_code == 409


@pytest.mark.parametrize("slug", ["Has Space", "UPPER", "--leading", "한글"])
async def test_invalid_slug_is_rejected(client: httpx.AsyncClient, slug: str) -> None:
    response = await client.post("/api/projects", json={"slug": slug, "name": "x"})

    assert response.status_code == 409


async def test_projects_are_isolated_between_users(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient
) -> None:
    """남의 프로젝트는 목록에 보이지 않는다."""
    await _create_project(client, "mine")

    response = await other_client.get("/api/projects")

    assert response.status_code == 200
    assert response.json() == []


async def test_reading_someone_elses_project_is_404_not_403(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient
) -> None:
    """권한 없음을 404 로 감춘다.

    403 을 주면 "그 id 의 프로젝트가 존재한다" 는 사실이 새어 나간다.
    """
    project = await _create_project(client, "secret")

    response = await other_client.get(f"/api/projects/{project['id']}")

    assert response.status_code == 404


async def test_anonymous_request_is_401(anon_client: httpx.AsyncClient) -> None:
    response = await anon_client.get("/api/projects")

    assert response.status_code == 401


async def test_archive_removes_the_project_from_the_default_list(
    client: httpx.AsyncClient,
) -> None:
    """보관 엔드포인트에 테스트가 없어서 500 이 오래 살아 있었다.

    `updated_at` 은 서버가 `onupdate` 로 계산하므로 flush 직후 그 값은 만료 상태다.
    refresh 없이 읽으면 SQLAlchemy 가 동기 lazy 조회를 걸고, async 컨텍스트에서 그것은
    `MissingGreenlet` 이 된다 — 즉 화면의 "보관" 버튼이 항상 500 이었다.
    """
    project = await _create_project(client, "to-archive")

    archived = await client.post(f"/api/projects/{project['id']}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None

    # 기본 목록에서는 빠지고, 단건 조회로는 여전히 닿는다. 보관은 삭제가 아니다.
    listed = (await client.get("/api/projects")).json()
    assert [p["id"] for p in listed] == []
    assert (await client.get(f"/api/projects/{project['id']}")).status_code == 200


async def test_non_owner_cannot_archive(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, other_user: User
) -> None:
    project = await _create_project(client, "owner-only-archive")
    await client.post(
        f"/api/projects/{project['id']}/members",
        json={"user_id": str(other_user.id), "role": "editor"},
    )

    response = await other_client.post(f"/api/projects/{project['id']}/archive")

    assert response.status_code == 403


# ---------------------------------------------------------------------- 멤버


async def test_owner_is_recorded_as_a_member(client: httpx.AsyncClient, user: User) -> None:
    """소유자도 멤버 테이블에 들어간다. 접근 검사 경로를 하나로 유지하기 위해서다."""
    project = await _create_project(client, "owned")

    response = await client.get(f"/api/projects/{project['id']}/members")

    assert response.status_code == 200
    members = response.json()
    assert len(members) == 1
    assert members[0]["user_id"] == str(user.id)
    assert members[0]["role"] == "owner"


async def test_added_member_can_read_the_project(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, other_user: User
) -> None:
    project = await _create_project(client, "shared")

    added = await client.post(
        f"/api/projects/{project['id']}/members",
        json={"user_id": str(other_user.id), "role": "editor"},
    )
    assert added.status_code == 201

    response = await other_client.get(f"/api/projects/{project['id']}")
    assert response.status_code == 200


async def test_non_owner_cannot_add_members(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, other_user: User
) -> None:
    project = await _create_project(client, "membership")
    await client.post(
        f"/api/projects/{project['id']}/members",
        json={"user_id": str(other_user.id), "role": "editor"},
    )

    response = await other_client.post(
        f"/api/projects/{project['id']}/members",
        json={"user_id": str(other_user.id), "role": "editor"},
    )

    assert response.status_code == 403
