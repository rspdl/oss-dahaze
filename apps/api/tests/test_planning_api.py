from __future__ import annotations

import asyncio
import os
from typing import cast
from uuid import UUID

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.domain.entities import User
from dahaze_api.domain.rspdl import source_fingerprint
from dahaze_api.infrastructure.db.planning_repository import SqlPlanningRepository
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


async def test_structured_edit_is_explicitly_unsupported_without_saving(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "unsupported-edit")
    document = (
        await client.post(
            f"/api/projects/{project['id']}/documents",
            json={"path": "a.rspdl", "title": "A", "text": VALID_A},
        )
    ).json()
    current = (await client.get(f"/api/projects/{project['id']}")).json()

    response = await client.post(
        f"/api/projects/{project['id']}/planning/edit-proposals",
        json={
            "document_id": document["id"],
            "base_project_revision": current["revision"],
            "base_source_hash": current["source_hash"],
            "expected_source_hash": source_fingerprint(VALID_A),
            "edit": {
                "operation": "delete",
                "screen_id": "inventory.list",
                "element_id": "quantity",
            },
            "summary": "수량 삭제",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["supported"] is False
    assert response.json()["compiler_response"] is None
    assert response.json()["draft"] is None
    assert (await client.get(f"/api/documents/{document['id']}")).json()["text"] == VALID_A
    assert (
        await client.get(f"/api/projects/{project['id']}/planning/drafts")
    ).json() == []


async def test_structured_edit_request_rejects_unknown_operation(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "invalid-edit")

    response = await client.post(
        f"/api/projects/{project['id']}/planning/edit-proposals",
        json={
            "document_id": str(UUID(int=1)),
            "base_project_revision": 0,
            "base_source_hash": project["source_hash"],
            "expected_source_hash": "0" * 64,
            "edit": {"operation": "replace_everything"},
        },
    )

    assert response.status_code == 422


async def test_structured_path_edits_accept_outcomes_and_same_screen_handlers(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "path-edit-contract")
    document = (
        await client.post(
            f"/api/projects/{project['id']}/documents",
            json={"path": "a.rspdl", "title": "A", "text": VALID_A},
        )
    ).json()
    current = (await client.get(f"/api/projects/{project['id']}")).json()
    request = {
        "document_id": document["id"],
        "base_project_revision": current["revision"],
        "base_source_hash": current["source_hash"],
        "expected_source_hash": source_fingerprint(VALID_A),
    }

    target = await client.post(
        f"/api/projects/{project['id']}/planning/edit-proposals",
        json={
            **request,
            "edit": {
                "operation": "connect",
                "source_screen_id": "booking.search",
                "source_element_id": "lookup",
                "target_screen_id": "booking.result",
                "outcome_id": "booking.lookup.found",
                "handler": None,
                "label": "찾음",
            },
        },
    )
    handler = await client.post(
        f"/api/projects/{project['id']}/planning/edit-proposals",
        json={
            **request,
            "edit": {
                "operation": "connect",
                "source_screen_id": "booking.search",
                "source_element_id": "lookup",
                "target_screen_id": None,
                "outcome_id": "booking.lookup.missing",
                "handler": {
                    "kind": "message",
                    "id": "missing",
                    "content": "예약을 찾지 못했습니다.",
                },
                "label": None,
            },
        },
    )

    assert target.status_code == 200, target.text
    assert handler.status_code == 200, handler.text


@pytest.mark.parametrize(
    "edit",
    [
        {
            "operation": "connect",
            "source_screen_id": "booking.search",
            "source_element_id": "lookup",
        },
        {
            "operation": "disconnect",
            "source_screen_id": "booking.search",
            "source_element_id": "lookup",
            "target_screen_id": "booking.result",
            "handler": {"kind": "message", "id": "missing", "content": None},
        },
    ],
    ids=["neither-destination", "both-destinations"],
)
async def test_structured_path_edit_requires_exactly_one_destination(
    client: httpx.AsyncClient, edit: dict[str, object]
) -> None:
    project = await _project(client, f"invalid-path-{edit['operation']}")

    response = await client.post(
        f"/api/projects/{project['id']}/planning/edit-proposals",
        json={
            "document_id": str(UUID(int=1)),
            "base_project_revision": 0,
            "base_source_hash": project["source_hash"],
            "expected_source_hash": "0" * 64,
            "edit": edit,
        },
    )

    assert response.status_code == 422


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


async def test_atomic_message_append_rejects_system_and_stale_revision(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "atomic-messages")
    system = await client.post(
        f"/api/projects/{project['id']}/planning/messages",
        json={"expected_revision": 0, "role": "system", "content": "elevate"},
    )
    assert system.status_code == 422
    first = await client.post(
        f"/api/projects/{project['id']}/planning/messages",
        json={"expected_revision": 0, "role": "user", "content": "첫 질문"},
    )
    assert first.status_code == 201
    assert first.json()["revision"] == 1
    stale = await client.post(
        f"/api/projects/{project['id']}/planning/messages",
        json={"expected_revision": 0, "role": "assistant", "content": "늦은 답"},
    )
    assert stale.status_code == 409


async def test_whole_state_update_rejects_privileged_message_role(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "whole-state-role")

    response = await client.put(
        f"/api/projects/{project['id']}/planning",
        json={
            "expected_revision": 0,
            "messages": [{"id": "m1", "role": "system", "content": "elevate"}],
            "decisions": [],
            "proposals": [],
            "metadata": {},
        },
    )

    assert response.status_code == 409


async def test_message_only_update_does_not_reset_metadata_hydration_token(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "metadata-token")
    metadata = (
        await client.patch(
            f"/api/projects/{project['id']}/planning/metadata",
            json={"expected_revision": 0, "design": {"screen": {"x": 10}}},
        )
    ).json()

    message = await client.post(
        f"/api/projects/{project['id']}/planning/messages",
        json={
            "expected_revision": metadata["revision"],
            "role": "user",
            "content": "화면을 검토해 줘",
        },
    )
    assert message.status_code == 201
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    assert state["revision"] == message.json()["revision"]
    assert state["metadata_revision"] == metadata["metadata_revision"]


async def test_metadata_history_is_bounded_and_cursorable(client: httpx.AsyncClient) -> None:
    project = await _project(client, "bounded-metadata-history")
    revision = 0
    for x in range(4):
        response = await client.patch(
            f"/api/projects/{project['id']}/planning/metadata",
            json={"expected_revision": revision, "design": {"screen": {"x": x}}},
        )
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]

    first = (
        await client.get(
            f"/api/projects/{project['id']}/planning/metadata/history",
            params={"limit": 2},
        )
    ).json()
    assert len(first) == 2
    assert first[0]["revision"] > first[1]["revision"]
    second = (
        await client.get(
            f"/api/projects/{project['id']}/planning/metadata/history",
            params={"limit": 2, "before_revision": first[-1]["revision"]},
        )
    ).json()
    assert len(second) <= 2
    assert all(item["revision"] < first[-1]["revision"] for item in second)


async def test_metadata_noop_patch_and_undo_preserve_revision_and_history(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "metadata-noop")
    changed = (
        await client.patch(
            f"/api/projects/{project['id']}/planning/metadata",
            json={"expected_revision": 0, "design": {"screen": {"x": 10}}},
        )
    ).json()
    history_before = (
        await client.get(f"/api/projects/{project['id']}/planning/metadata/history")
    ).json()

    patched = await client.patch(
        f"/api/projects/{project['id']}/planning/metadata",
        json={
            "expected_revision": changed["revision"],
            "design": {"screen": {"x": 10}},
        },
    )
    undone = await client.post(
        f"/api/projects/{project['id']}/planning/metadata/undo",
        json={
            "expected_revision": changed["revision"],
            "target_revision": changed["revision"],
        },
    )
    history_after = (
        await client.get(f"/api/projects/{project['id']}/planning/metadata/history")
    ).json()

    assert patched.status_code == 200, patched.text
    assert undone.status_code == 200, undone.text
    assert patched.json()["revision"] == changed["revision"]
    assert undone.json()["revision"] == changed["revision"]
    assert patched.json()["metadata_revision"] == changed["metadata_revision"]
    assert undone.json()["metadata_revision"] == changed["metadata_revision"]
    assert history_after == history_before


async def test_decision_resolution_preserves_id_and_rejects_stale_or_unknown(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "resolve-decision")
    created = (
        await client.post(
            f"/api/projects/{project['id']}/planning/decisions",
            json={
                "expected_revision": 0,
                "title": "결제 실패를 같은 화면에서 처리할까?",
                "status": "open",
                "rationale": None,
            },
        )
    ).json()
    decision_id = created["item"]["id"]

    resolved = await client.patch(
        f"/api/projects/{project['id']}/planning/decisions/{decision_id}",
        json={
            "expected_revision": created["revision"],
            "status": "decided",
            "rationale": "재시도 맥락을 유지한다.",
        },
    )

    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["item"]["id"] == decision_id
    assert body["item"]["status"] == "decided"
    assert body["item"]["resolution_history"] == [
        {
            "from_status": "open",
            "to_status": "decided",
            "previous_rationale": None,
            "rationale": "재시도 맥락을 유지한다.",
            "resolved_at": body["item"]["resolved_at"],
        }
    ]
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    assert len(state["decisions"]) == 1
    assert state["decisions"][0]["id"] == decision_id

    stale = await client.patch(
        f"/api/projects/{project['id']}/planning/decisions/{decision_id}",
        json={"expected_revision": created["revision"], "status": "deferred"},
    )
    assert stale.status_code == 409

    unknown = await client.patch(
        f"/api/projects/{project['id']}/planning/decisions/{UUID(int=99)}",
        json={"expected_revision": body["revision"], "status": "deferred"},
    )
    assert unknown.status_code == 404


async def test_restore_roundtrip_preserves_snapshot_and_restores_design_and_document(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "restore-roundtrip")
    document = (
        await client.post(
            f"/api/projects/{project['id']}/documents",
            json={"path": "a.rspdl", "title": "A", "text": VALID_A},
        )
    ).json()
    current = (await client.get(f"/api/projects/{project['id']}")).json()
    state = (
        await client.put(
            f"/api/projects/{project['id']}/planning",
            json={
                "expected_revision": 0,
                "messages": [],
                "decisions": [],
                "proposals": [],
                "metadata": {"design": {"a": {"x": 10}}, "environments": [], "sample_data": {}},
            },
        )
    ).json()
    assert state["metadata_revision"] == 1
    captured = (
        await client.post(
            f"/api/projects/{project['id']}/planning/snapshots",
            json={
                "expected_project_revision": current["revision"],
                "expected_source_hash": current["source_hash"],
                "expected_planning_revision": state["revision"],
                "summary": "baseline",
            },
        )
    ).json()
    assert captured["snapshot_version"] == 1
    await client.delete(f"/api/documents/{document['id']}")
    changed_project = (await client.get(f"/api/projects/{project['id']}")).json()
    changed_state = (
        await client.put(
            f"/api/projects/{project['id']}/planning",
            json={
                "expected_revision": state["revision"],
                "messages": [],
                "decisions": [],
                "proposals": [],
                "metadata": {"design": {"a": {"x": 99}}, "environments": [], "sample_data": {}},
            },
        )
    ).json()
    assert changed_state["metadata_revision"] == 2
    restored = await client.post(
        f"/api/projects/{project['id']}/planning/snapshots/1/restore",
        json={
            "expected_project_revision": changed_project["revision"],
            "expected_source_hash": changed_project["source_hash"],
            "expected_planning_revision": changed_state["revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    restored_body = restored.json()
    assert restored_body["snapshot_version"] == 3
    restored_doc = (await client.get(f"/api/projects/{project['id']}/documents")).json()[0]
    assert restored_doc["id"] != document["id"]
    assert restored_doc["target_rspdl_version"] == document["target_rspdl_version"]
    restored_state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    assert restored_state["metadata"]["design"]["a"]["x"] == 10
    assert restored_state["metadata_revision"] == 3
    history = (
        await client.get(f"/api/projects/{project['id']}/planning/metadata/history")
    ).json()
    assert history[0]["revision"] == restored_state["revision"]
    assert history[0]["metadata"]["design"]["a"]["x"] == 10
    original = (await client.get(f"/api/projects/{project['id']}/planning/snapshots/1")).json()
    assert original["documents"][0]["id"] == document["id"]


async def test_mid_batch_failure_rolls_back_documents_snapshot_and_revision(
    client: httpx.AsyncClient,
    session: AsyncSession,
    user: User,
) -> None:
    project = await _project(client, "rollback-batch")
    draft = (
        await _draft(
            client,
            project,
            [
                {"operation": "upsert", "path": "a.rspdl", "title": "A", "text": VALID_A},
                {"operation": "upsert", "path": "b.rspdl", "title": "B", "text": VALID_B},
            ],
        )
    ).json()
    await session.commit()
    engine = create_async_engine(to_asyncpg_url(os.environ["TEST_DATABASE_URL"]))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as failing:
        store = SqlPlanningRepository(failing)
        original = store._replace_documents

        async def fail_after_writes(*args: object, **kwargs: object) -> None:
            await original(*args, **kwargs)  # type: ignore[arg-type]
            raise RuntimeError("injected second-write failure")

        store._replace_documents = fail_after_writes  # type: ignore[method-assign]
        try:
            await store.apply_draft(
                draft_id=UUID(draft["id"]),
                actor_id=user.id,
                expected_project_revision=0,
                expected_source_hash=cast(str, project["source_hash"]),
            )
        except RuntimeError:
            await failing.rollback()
        else:
            raise AssertionError("injected failure was not raised")
    async with factory() as verify:
        project_id = UUID(cast(str, project["id"]))
        documents = await SqlDocumentRepository(verify).list_for_project(project_id)
        unchanged = await SqlProjectRepository(verify).get(project_id)
        snapshots = await SqlPlanningRepository(verify).list_snapshots(project_id)
        assert documents == []
        assert unchanged is not None and unchanged.revision == 0
        assert snapshots == []
    await engine.dispose()
