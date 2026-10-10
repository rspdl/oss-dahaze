"""AI 대화·프로젝트 이벤트 REST 계약과 SSE (ADR-0005, ADR-0008)."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.domain.entities import ExternalIdentity
from dahaze_api.infrastructure.agent_scope import build_tree
from dahaze_api.infrastructure.db.models import ProjectRow, UserRow
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository, SqlUserRepository
from dahaze_api.infrastructure.db.session import to_asyncpg_url
from dahaze_api.infrastructure.event_feed import PgEventListener, ProjectEventFeed
from dahaze_api.interface.rest.agent import sse_frames

DEFAULT_TEST_DB = "postgresql://dahaze:dahaze@localhost:55432/dahaze_test"


@pytest.fixture
async def project_id(client: httpx.AsyncClient) -> str:
    response = await client.post(
        "/api/projects", json={"slug": f"agent-{uuid4().hex[:8]}", "name": "에이전트"}
    )
    return str(response.json()["id"])


async def _session(client: httpx.AsyncClient, project_id: str) -> dict[str, object]:
    response = await client.post(f"/api/projects/{project_id}/agent/sessions", json={})
    assert response.status_code == 201, response.text
    return dict(response.json())


async def test_session_message_flow(client: httpx.AsyncClient, project_id: str) -> None:
    session = await _session(client, project_id)
    assert session["title"] == "새 대화"

    request_id = str(uuid4())
    sent = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "재고 모델 만들어 줘", "request_id": request_id},
    )
    assert sent.status_code == 202
    assert sent.json()["status"] == "queued"

    # 같은 요청 ID 는 한 번만 기록한다.
    again = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "재고 모델 만들어 줘", "request_id": request_id},
    )
    assert again.json()["id"] == sent.json()["id"]
    # 응답 중에 다른 메시지를 보내면 409.
    busy = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "또", "request_id": str(uuid4())},
    )
    assert busy.status_code == 409

    items = await client.get(f"/api/agent/sessions/{session['id']}/items")
    assert [(i["seq"], i["kind"], i["payload"]) for i in items.json()] == [
        (1, "user_message", {"text": "재고 모델 만들어 줘"})
    ]
    turns = await client.get(f"/api/agent/sessions/{session['id']}/turns")
    assert [t["id"] for t in turns.json()] == [sent.json()["id"]]
    listed = await client.get(f"/api/projects/{project_id}/agent/sessions")
    assert [s["id"] for s in listed.json()] == [session["id"]]


async def test_message_keeps_viewing_context(client: httpx.AsyncClient, project_id: str) -> None:
    session = await _session(client, project_id)
    sent = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={
            "text": "이 화면을 shadcn 으로",
            "request_id": str(uuid4()),
            "context": {"view": "wireframe", "screen_id": "m.a", "screen_name": "가 화면"},
        },
    )
    assert sent.status_code == 202, sent.text

    items = await client.get(f"/api/agent/sessions/{session['id']}/items")
    assert items.json()[0]["payload"] == {
        "text": "이 화면을 shadcn 으로",
        "context": {"view": "wireframe", "screen_id": "m.a", "screen_name": "가 화면"},
    }


async def test_cancel_queued_turn(client: httpx.AsyncClient, project_id: str) -> None:
    session = await _session(client, project_id)
    sent = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "a", "request_id": str(uuid4())},
    )
    cancelled = await client.post(f"/api/agent/turns/{sent.json()['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    # 끝난 턴이면 새 메시지를 보낼 수 있다.
    next_message = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "b", "request_id": str(uuid4())},
    )
    assert next_message.status_code == 202


async def test_approval_on_turn_not_waiting_is_409(
    client: httpx.AsyncClient, project_id: str
) -> None:
    session = await _session(client, project_id)
    sent = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "a", "request_id": str(uuid4())},
    )
    response = await client.post(
        f"/api/agent/turns/{sent.json()['id']}/approval", json={"approved": True}
    )
    assert response.status_code == 409


async def test_empty_message_is_422(client: httpx.AsyncClient, project_id: str) -> None:
    session = await _session(client, project_id)
    response = await client.post(
        f"/api/agent/sessions/{session['id']}/messages",
        json={"text": "", "request_id": str(uuid4())},
    )
    assert response.status_code == 422


async def test_settings_round_trip(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/me/agent-settings")).json() == {
        "auto_approve_recursive_delete": False
    }
    updated = await client.put(
        "/api/me/agent-settings", json={"auto_approve_recursive_delete": True}
    )
    assert updated.json() == {"auto_approve_recursive_delete": True}
    assert (await client.get("/api/me/agent-settings")).json()[
        "auto_approve_recursive_delete"
    ] is True


async def test_tree_changes_become_events(client: httpx.AsyncClient, project_id: str) -> None:
    await client.post(
        f"/api/projects/{project_id}/tree/files",
        json={"parent": "/", "name": "a.rspdl", "content": ""},
    )
    await client.post(
        f"/api/projects/{project_id}/commits", json={"paths": ["/a.rspdl"], "message": "m"}
    )
    events = await client.get(f"/api/projects/{project_id}/events")
    assert [e["type"] for e in events.json()] == ["tree.changed", "commit.created"]
    assert events.json()[0]["payload"]["paths"] == ["/a.rspdl"]
    after = await client.get(
        f"/api/projects/{project_id}/events", params={"after_seq": events.json()[0]["seq"]}
    )
    assert [e["type"] for e in after.json()] == ["commit.created"]


async def test_non_member_cannot_touch_sessions_or_events(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, project_id: str
) -> None:
    session = await _session(client, project_id)
    assert (await other_client.get(f"/api/agent/sessions/{session['id']}")).status_code == 404
    assert (await other_client.get(f"/api/projects/{project_id}/events")).status_code == 404
    assert (
        await other_client.post(f"/api/projects/{project_id}/agent/sessions", json={})
    ).status_code == 404


async def test_stream_requires_login(anon_client: httpx.AsyncClient, project_id: str) -> None:
    response = await anon_client.get(f"/api/projects/{project_id}/events/stream")
    assert response.status_code == 401


# ---------------------------------------------------------------------- SSE 와 LISTEN


@pytest.fixture
async def committed(
    _database: None,
) -> AsyncIterator[tuple[async_sessionmaker[AsyncSession], UUID, UUID]]:
    """실제로 커밋된 사용자·프로젝트. 알림은 커밋될 때만 전달된다."""
    engine = create_async_engine(
        to_asyncpg_url(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB))
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        user = await SqlUserRepository(s).create_from_identity(
            ExternalIdentity(provider="github", provider_user_id=str(uuid4()), login="sse")
        )
        project = await SqlProjectRepository(s).create(
            owner_id=user.id,
            slug=f"sse-{uuid4().hex[:8]}",
            name="SSE",
            description=None,
            default_rspdl_version="0.1.4",
        )
        await s.commit()
    yield sessions, user.id, project.id
    async with sessions() as s:
        await s.execute(delete(ProjectRow).where(ProjectRow.id == project.id))
        await s.execute(delete(UserRow).where(UserRow.id == user.id))
        await s.commit()
    await engine.dispose()


async def test_sse_wakes_on_committed_change(
    committed: tuple[async_sessionmaker[AsyncSession], UUID, UUID],
) -> None:
    sessions, user_id, project_id = committed
    listener = PgEventListener(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB))
    feed = ProjectEventFeed(sessions=sessions, listener=listener)
    stop = asyncio.Event()

    async def disconnected() -> bool:
        return stop.is_set()

    frames = sse_frames(feed, project_id, 0, disconnected, keepalive=30)
    try:
        assert await anext(frames) == "retry: 3000\n\n"
        # 구독을 연 뒤 변경을 커밋한다. keepalive(30초)를 기다리지 않고 바로 깨어나야 한다.
        pending = asyncio.ensure_future(anext(frames))
        await asyncio.sleep(0.2)
        assert listener.listening
        async with sessions() as s:
            await build_tree(s).add(
                actor_id=user_id, project_id=project_id, parent="/", name="a.rspdl", content=""
            )
            await s.commit()
        frame = await asyncio.wait_for(pending, timeout=5)
    finally:
        stop.set()
        await frames.aclose()
        await listener.close()

    assert frame.startswith("id: ")
    assert "event: tree.changed" in frame
    assert '"paths":["/a.rspdl"]' in frame


async def test_sse_resumes_after_cursor(
    committed: tuple[async_sessionmaker[AsyncSession], UUID, UUID],
) -> None:
    sessions, user_id, project_id = committed
    async with sessions() as s:
        tree = build_tree(s)
        for name in ("a.rspdl", "b.rspdl"):
            await tree.add(
                actor_id=user_id, project_id=project_id, parent="/", name=name, content=""
            )
        await s.commit()
    listener = PgEventListener(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB))
    feed = ProjectEventFeed(sessions=sessions, listener=listener)
    first = (await feed.load(project_id=project_id, after_seq=0, limit=10))[0]

    stop = asyncio.Event()

    async def disconnected() -> bool:
        return stop.is_set()

    frames = sse_frames(feed, project_id, first.seq, disconnected, keepalive=30)
    try:
        await anext(frames)
        frame = await asyncio.wait_for(anext(frames), timeout=5)
    finally:
        stop.set()
        await frames.aclose()
        await listener.close()
    assert '"paths":["/b.rspdl"]' in frame
