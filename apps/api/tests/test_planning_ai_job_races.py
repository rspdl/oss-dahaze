"""PostgreSQL concurrency and provenance contracts for planning AI jobs.

Run this module only against its dedicated disposable database::

    TEST_DATABASE_URL=postgresql://dahaze:dahaze@localhost:55432/dahaze_ai_job_races_20260923 \
      uv run --project apps/api pytest apps/api/tests/test_planning_ai_job_races.py
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.application.errors import Conflict, NotFound
from dahaze_api.application.planning_ai import PlanningAiService
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Project, User
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.infrastructure.db.models import (
    PlanningAiJobRow,
    PlanningDraftRow,
    PlanningStateRow,
    ProjectRow,
)
from dahaze_api.infrastructure.db.planning_ai_repository import SqlPlanningAiJobRepository
from dahaze_api.infrastructure.db.planning_repository import SqlPlanningRepository
from dahaze_api.infrastructure.db.repositories import SqlDocumentRepository, SqlProjectRepository
from dahaze_api.infrastructure.db.session import to_asyncpg_url

RACE_DATABASE_NAME = "dahaze_ai_job_races_20260923"
RACE_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if urlsplit(RACE_DATABASE_URL).path.removeprefix("/") != RACE_DATABASE_NAME:
    pytest.skip(
        f"set TEST_DATABASE_URL to the dedicated {RACE_DATABASE_NAME} database",
        allow_module_level=True,
    )


@pytest.fixture
async def race_sessions(_database: None) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(to_asyncpg_url(RACE_DATABASE_URL))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture(autouse=True)
async def cleanup_race_projects(
    race_sessions: async_sessionmaker[AsyncSession],
) -> AsyncIterator[None]:
    yield
    async with race_sessions() as cleanup:
        project_ids = (
            await cleanup.execute(select(ProjectRow.id).where(ProjectRow.slug.like("race-%")))
        ).scalars()
        await cleanup.execute(delete(ProjectRow).where(ProjectRow.id.in_(list(project_ids))))
        await cleanup.commit()


def _service(session: AsyncSession) -> PlanningAiService:
    workspace = WorkspaceService(
        projects=SqlProjectRepository(session),
        documents=SqlDocumentRepository(session),
        # These job use cases only read projects and memberships. A compiler call here is a bug.
        compiler=cast(RspdlCompilerPort, object()),
    )
    return PlanningAiService(
        workspace=workspace,
        planning=SqlPlanningRepository(session),
        jobs=SqlPlanningAiJobRepository(session),
    )


async def _create_project(session: AsyncSession, owner_id: UUID) -> Project:
    project = await SqlProjectRepository(session).create(
        owner_id=owner_id,
        slug=f"race-{uuid4().hex}",
        name="AI job race",
        description=None,
        default_rspdl_version="0.1.2",
    )
    session.add(
        PlanningStateRow(
            project_id=project.id,
            revision=0,
            metadata_revision=0,
            messages=[],
            decisions=[],
            proposals=[],
            metadata_={},
        )
    )
    await session.commit()
    return project


async def _enqueue(
    session: AsyncSession,
    *,
    project: Project,
    actor_id: UUID,
    request_id: UUID | None = None,
    instruction: str = "환불 정책을 검토해 주세요.",
    kind: str = "interview",
) -> Mapping[str, Any]:
    result = await SqlPlanningAiJobRepository(session).enqueue(
        project_id=project.id,
        actor_id=actor_id,
        request_id=request_id or uuid4(),
        kind=kind,
        instruction=instruction,
        expected_planning_revision=0,
        frozen_project_revision=project.revision,
        frozen_source_hash=project.source_hash,
        context={"selected_subject": None},
        source_draft_id=None,
        retry_of_job_id=None,
        attempt=1,
        max_attempts=3,
    )
    assert result is not None
    return result


async def test_simultaneous_duplicate_request_returns_one_job_and_one_user_message(
    session: AsyncSession,
    user: User,
    race_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    request_id = uuid4()
    start = asyncio.Event()

    async def submit() -> Mapping[str, Any]:
        async with race_sessions() as concurrent:
            await start.wait()
            job = await _enqueue(
                concurrent,
                project=project,
                actor_id=user.id,
                request_id=request_id,
            )
            await concurrent.commit()
            return job

    submissions = [asyncio.create_task(submit()) for _ in range(2)]
    start.set()
    first, second = await asyncio.gather(*submissions)

    assert first["id"] == second["id"]
    async with race_sessions() as verify:
        job_count = await verify.scalar(
            select(func.count()).select_from(PlanningAiJobRow).where(
                PlanningAiJobRow.project_id == project.id,
                PlanningAiJobRow.request_id == request_id,
            )
        )
        state = await verify.get(PlanningStateRow, project.id)
        assert job_count == 1
        assert state is not None
        assert [cast(Mapping[str, Any], message)["request_id"] for message in state.messages] == [
            str(request_id)
        ]


@pytest.mark.xfail(
    strict=True,
    reason="implementation gap: idempotency key does not bind a canonical request payload",
)
async def test_same_request_key_with_different_payload_conflicts_safely(
    session: AsyncSession,
    user: User,
    race_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    request_id = uuid4()
    start = asyncio.Event()

    async def submit(instruction: str) -> Mapping[str, Any] | BaseException:
        async with race_sessions() as concurrent:
            await start.wait()
            try:
                result = await _service(concurrent).enqueue(
                    actor_id=user.id,
                    project_id=project.id,
                    request_id=request_id,
                    kind="interview",
                    instruction=instruction,
                    expected_planning_revision=0,
                    base_project_revision=project.revision,
                    base_source_hash=project.source_hash,
                    selected_subject=None,
                    source_draft_id=None,
                )
                await concurrent.commit()
                return result
            except BaseException as error:
                await concurrent.rollback()
                return error

    submissions = [
        asyncio.create_task(submit("환불 정책을 검토해 주세요.")),
        asyncio.create_task(submit("재고 정책을 새로 작성해 주세요.")),
    ]
    start.set()
    outcomes = await asyncio.gather(*submissions)

    assert sum(isinstance(outcome, Conflict) for outcome in outcomes) == 1
    assert sum(isinstance(outcome, Mapping) for outcome in outcomes) == 1


@pytest.mark.xfail(
    strict=True,
    reason="implementation gap: concurrent retries can hit the retry_of unique constraint",
)
async def test_concurrent_retry_of_one_failed_job_is_deduplicated(
    session: AsyncSession,
    user: User,
    race_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    original = await _enqueue(session, project=project, actor_id=user.id)
    repository = SqlPlanningAiJobRepository(session)
    claimed = await repository.claim(lease_seconds=30)
    assert claimed is not None and claimed["id"] == original["id"]
    assert await repository.finish_failed(
        UUID(str(original["id"])),
        lease_token=UUID(str(claimed["lease_token"])),
        error={"code": "timeout", "message": "시간 초과", "retryable": True},
    )
    await session.commit()
    start = asyncio.Event()

    async def retry() -> Mapping[str, Any] | BaseException:
        async with race_sessions() as concurrent:
            await start.wait()
            try:
                result = await _service(concurrent).retry(
                    actor_id=user.id,
                    project_id=project.id,
                    job_id=UUID(str(original["id"])),
                )
                await concurrent.commit()
                return result
            except BaseException as error:
                await concurrent.rollback()
                return error

    retries = [asyncio.create_task(retry()) for _ in range(2)]
    start.set()
    outcomes = await asyncio.gather(*retries)

    assert all(isinstance(outcome, Mapping) for outcome in outcomes)
    retry_ids = {str(cast(Mapping[str, Any], outcome)["id"]) for outcome in outcomes}
    assert len(retry_ids) == 1


@pytest.mark.xfail(
    strict=True,
    reason="implementation gap: stale draft provenance is accepted against a newer project head",
)
async def test_stale_source_draft_cannot_rebase_over_new_accepted_source(
    session: AsyncSession,
    user: User,
) -> None:
    project = await _create_project(session, user.id)
    draft_id = uuid4()
    session.add(
        PlanningDraftRow(
            id=draft_id,
            project_id=project.id,
            base_project_revision=project.revision,
            base_source_hash=project.source_hash,
            changes=[],
            candidate_documents=[],
            candidate_source_hash="draft-candidate",
            summary="old draft",
            rspdl_version="0.1.2",
            wire_schema_version=1,
            locale="ko-KR",
            result=None,
            base_result=None,
            applied_revision=None,
        )
    )
    await session.flush()
    await SqlDocumentRepository(session).create(
        project_id=project.id,
        path="accepted.rspdl",
        title="Accepted source",
        text="@모듈 accepted(accepted)\n",
        target_rspdl_version="0.1.2",
        author_id=user.id,
    )
    await session.commit()
    current = await SqlProjectRepository(session).get(project.id)
    assert current is not None and current.revision > project.revision

    with pytest.raises(Conflict):
        await _service(session).enqueue(
            actor_id=user.id,
            project_id=project.id,
            request_id=uuid4(),
            kind="generate",
            instruction="이 예전 초안을 이어서 작성해 주세요.",
            expected_planning_revision=0,
            base_project_revision=current.revision,
            base_source_hash=current.source_hash,
            selected_subject=None,
            source_draft_id=draft_id,
        )


async def test_cancelled_running_job_with_expired_lease_is_terminalized_by_reaper(
    session: AsyncSession,
    user: User,
    race_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue(session, project=project, actor_id=user.id)
    repository = SqlPlanningAiJobRepository(session)
    claimed = await repository.claim(lease_seconds=30)
    assert claimed is not None and claimed["id"] == job["id"]
    await session.commit()

    async with race_sessions() as crash_reaper:
        crash_repository = SqlPlanningAiJobRepository(crash_reaper)
        cancelled = await crash_repository.request_cancel(UUID(str(job["id"])))
        assert cancelled is not None and cancelled["cancel_requested"] is True
        await crash_reaper.execute(
            update(PlanningAiJobRow)
            .where(PlanningAiJobRow.id == job["id"])
            .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await crash_reaper.commit()

    async with race_sessions() as next_worker:
        assert await SqlPlanningAiJobRepository(next_worker).claim(lease_seconds=30) is None
        await next_worker.commit()

    async with race_sessions() as verify:
        stored = await SqlPlanningAiJobRepository(verify).get(UUID(str(job["id"])))
        assert stored is not None
        assert stored["status"] == "cancelled"
        assert stored["finished_at"] is not None
        assert stored["lease_token"] is None
        assert stored["lease_expires_at"] is None


async def test_expired_lease_prevents_old_worker_from_publishing(
    session: AsyncSession,
    user: User,
    race_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue(session, project=project, actor_id=user.id)
    first_repository = SqlPlanningAiJobRepository(session)
    first_claim = await first_repository.claim(lease_seconds=30)
    assert first_claim is not None and first_claim["id"] == job["id"]
    old_token = UUID(str(first_claim["lease_token"]))
    await session.execute(
        update(PlanningAiJobRow)
        .where(PlanningAiJobRow.id == job["id"])
        .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await session.commit()

    async with race_sessions() as new_worker:
        new_repository = SqlPlanningAiJobRepository(new_worker)
        second_claim = await new_repository.claim(lease_seconds=30)
        assert second_claim is not None and second_claim["id"] == job["id"]
        new_token = UUID(str(second_claim["lease_token"]))
        assert new_token != old_token
        await new_worker.commit()

    async with race_sessions() as old_worker:
        published = await SqlPlanningAiJobRepository(old_worker).finish_interview(
            UUID(str(job["id"])),
            lease_token=old_token,
            result={"assistant_message": "오래된 worker 결과", "proposals": []},
        )
        assert published is False
        await old_worker.commit()

    async with race_sessions() as verify:
        stored = await SqlPlanningAiJobRepository(verify).get(UUID(str(job["id"])))
        state = await verify.get(PlanningStateRow, project.id)
        assert stored is not None and stored["status"] == "running" and stored["result"] is None
        assert state is not None
        assert [cast(Mapping[str, Any], message)["role"] for message in state.messages] == [
            "user"
        ]


async def test_retry_retains_original_decisions_and_checkpoints(
    session: AsyncSession,
    user: User,
) -> None:
    project = await _create_project(session, user.id)
    state = await session.get(PlanningStateRow, project.id)
    assert state is not None
    original_decision = {"id": "refund-window", "value": "출발 24시간 전"}
    state.decisions = [original_decision]
    await session.flush()
    original = await _enqueue(session, project=project, actor_id=user.id)
    repository = SqlPlanningAiJobRepository(session)
    claimed = await repository.claim(lease_seconds=30)
    assert claimed is not None and claimed["id"] == original["id"]
    checkpoint = {"interview": {"round": 2, "question_ids": ["refund-window"]}}
    assert await repository.checkpoint(
        UUID(str(original["id"])),
        lease_token=UUID(str(claimed["lease_token"])),
        checkpoints=checkpoint,
        progress={"stage": "interview", "completed": 2, "total": 3, "message": None},
    )
    assert await repository.finish_failed(
        UUID(str(original["id"])),
        lease_token=UUID(str(claimed["lease_token"])),
        error={"code": "timeout", "message": "시간 초과", "retryable": True},
    )
    state.decisions = [{"id": "refund-window", "value": "출발 48시간 전"}]
    state.revision += 1
    await session.commit()

    retried = await _service(session).retry(
        actor_id=user.id,
        project_id=project.id,
        job_id=UUID(str(original["id"])),
    )
    await session.commit()

    assert retried["attempt"] == 2
    assert retried["retry_of_job_id"] == original["id"]
    assert retried["checkpoints"] == checkpoint
    assert retried["context"]["planning_state"]["decisions"] == [original_decision]
    state = await session.get(PlanningStateRow, project.id, populate_existing=True)
    assert state is not None
    assert [cast(Mapping[str, Any], message)["role"] for message in state.messages] == ["user"]


async def test_cross_project_actor_cannot_read_cancel_or_retry_job(
    session: AsyncSession,
    user: User,
    other_user: User,
) -> None:
    owner_project = await _create_project(session, user.id)
    other_project = await _create_project(session, other_user.id)
    job = await _enqueue(session, project=owner_project, actor_id=user.id)
    await session.commit()
    service = _service(session)

    calls = [
        service.get(
            actor_id=other_user.id,
            project_id=owner_project.id,
            job_id=UUID(str(job["id"])),
        ),
        service.cancel(
            actor_id=other_user.id,
            project_id=owner_project.id,
            job_id=UUID(str(job["id"])),
        ),
        service.retry(
            actor_id=other_user.id,
            project_id=owner_project.id,
            job_id=UUID(str(job["id"])),
        ),
        service.get(
            actor_id=other_user.id,
            project_id=other_project.id,
            job_id=UUID(str(job["id"])),
        ),
    ]
    for call in calls:
        with pytest.raises(NotFound):
            await call
