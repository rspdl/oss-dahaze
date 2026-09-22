from __future__ import annotations

import asyncio
import os
from typing import cast

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.domain.entities import User
from dahaze_api.infrastructure.db.repositories import SqlDocumentRepository, SqlProjectRepository
from dahaze_api.infrastructure.db.session import to_asyncpg_url

VALID_A = (
    "@모듈 재고(inventory)\n\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n    이름(name): 필수 문자열\n"
)
VALID_B = (
    "@모듈 주문(order)\n\n"
    "주문 항목(item)은 다음 필드들로 구성되어 있다.\n    번호(number): 필수 문자열\n"
)


async def _project(client: httpx.AsyncClient, slug: str) -> dict[str, object]:
    response = await client.post("/api/projects", json={"slug": slug, "name": slug})
    assert response.status_code == 201, response.text
    return cast(dict[str, object], response.json())


async def _draft(
    client: httpx.AsyncClient, project: dict[str, object], changes: list[dict[str, object]]
) -> httpx.Response:
    return await client.post(
        f"/api/projects/{project['id']}/planning/drafts",
        json={
            "base_project_revision": project["revision"],
            "base_source_hash": project["source_hash"],
            "changes": changes,
            "summary": "여러 문서 변경",
        },
    )


async def test_error_bearing_draft_is_persisted_but_not_applied(client: httpx.AsyncClient) -> None:
    project = await _project(client, "broken-draft")
    created = await _draft(
        client,
        project,
        [{"operation": "upsert", "path": "bad.rspdl", "title": "깨진 초안", "text": "not rspdl"}],
    )
    assert created.status_code == 201, created.text
    draft = created.json()
    assert draft["result"]["files"][0]["diagnostics"]

    applied = await client.post(
        f"/api/planning/drafts/{draft['id']}/apply",
        json={
            "expected_project_revision": project["revision"],
            "expected_source_hash": project["source_hash"],
        },
    )
    assert applied.status_code == 200
    assert applied.json()["applied"] is False
    assert (await client.get(f"/api/projects/{project['id']}/documents")).json() == []


async def test_multi_document_apply_is_atomic_and_creates_baseline(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "atomic-apply")
    created = await _draft(
        client,
        project,
        [
            {"operation": "upsert", "path": "a.rspdl", "title": "A", "text": VALID_A},
            {"operation": "upsert", "path": "b.rspdl", "title": "B", "text": VALID_B},
        ],
    )
    assert created.status_code == 201, created.text
    draft = created.json()
    applied = await client.post(
        f"/api/planning/drafts/{draft['id']}/apply",
        json={"expected_project_revision": 0, "expected_source_hash": project["source_hash"]},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert [
        x["path"] for x in (await client.get(f"/api/projects/{project['id']}/documents")).json()
    ] == ["a.rspdl", "b.rspdl"]
    snapshots = (await client.get(f"/api/projects/{project['id']}/planning/snapshots")).json()
    assert [(x["snapshot_version"], x["change_kind"]) for x in snapshots] == [
        (2, "apply"),
        (1, "baseline"),
    ]


async def test_ordinary_document_edit_makes_draft_stale(client: httpx.AsyncClient) -> None:
    project = await _project(client, "stale-draft")
    draft = (
        await _draft(
            client,
            project,
            [{"operation": "upsert", "path": "a.rspdl", "title": "A", "text": VALID_A}],
        )
    ).json()
    await client.post(
        f"/api/projects/{project['id']}/documents",
        json={"path": "other.rspdl", "title": "다른 탭", "text": VALID_B},
    )
    response = await client.post(
        f"/api/planning/drafts/{draft['id']}/apply",
        json={"expected_project_revision": 0, "expected_source_hash": project["source_hash"]},
    )
    assert response.status_code == 409


async def test_viewer_cannot_change_planning_state(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, other_user: User
) -> None:
    project = await _project(client, "planning-permission")
    await client.post(
        f"/api/projects/{project['id']}/members",
        json={"user_id": str(other_user.id), "role": "viewer"},
    )
    response = await other_client.put(
        f"/api/projects/{project['id']}/planning",
        json={
            "expected_revision": 0,
            "messages": [{"id": "m1", "role": "user", "content": "hi"}],
            "decisions": [],
            "proposals": [],
            "metadata": {},
        },
    )
    assert response.status_code == 403


async def test_restore_rejects_newer_planning_state(client: httpx.AsyncClient) -> None:
    project = await _project(client, "restore-state")
    draft = (
        await _draft(
            client,
            project,
            [{"operation": "upsert", "path": "a.rspdl", "title": "A", "text": VALID_A}],
        )
    ).json()
    applied = (
        await client.post(
            f"/api/planning/drafts/{draft['id']}/apply",
            json={"expected_project_revision": 0, "expected_source_hash": project["source_hash"]},
        )
    ).json()
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    await client.put(
        f"/api/projects/{project['id']}/planning",
        json={
            "expected_revision": state["revision"],
            "messages": [],
            "decisions": [{"id": "new"}],
            "proposals": [],
            "metadata": {},
        },
    )
    response = await client.post(
        f"/api/projects/{project['id']}/planning/snapshots/1/restore",
        json={
            "expected_project_revision": applied["project_revision"],
            "expected_source_hash": applied["source_hash"],
            "expected_planning_revision": 0,
        },
    )
    assert response.status_code == 409


async def test_concurrent_document_writes_serialize_project_revision(
    client: httpx.AsyncClient,
    session: AsyncSession,
) -> None:
    project = await _project(client, "concurrent-write")
    created = (
        await client.post(
            f"/api/projects/{project['id']}/documents",
            json={"path": "a.rspdl", "title": "A", "text": VALID_A},
        )
    ).json()
    # 독립 세션이 픽스처가 만든 행을 볼 수 있게 현재 요청 세션을 먼저 커밋한다.
    await session.commit()
    database_url = os.environ["TEST_DATABASE_URL"]
    engine = create_async_engine(to_asyncpg_url(database_url))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as first, factory() as second:
        repo1, repo2 = SqlDocumentRepository(first), SqlDocumentRepository(second)
        await repo1.update_text(
            document_id=created["id"], text=VALID_A + "\n", author_id=None, summary="first"
        )
        second_write = asyncio.create_task(
            repo2.update_text(
                document_id=created["id"], text=VALID_A + "\n\n", author_id=None, summary="second"
            )
        )
        await asyncio.sleep(0.05)
        assert not second_write.done()
        await first.commit()
        await second_write
        await second.commit()
        final = await SqlProjectRepository(second).get(created["project_id"])
        assert final is not None
        assert final.revision == 3
    await engine.dispose()
