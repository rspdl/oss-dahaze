"""Durable planning worker recovery contracts against a dedicated PostgreSQL database."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.application.planning_ai import PlanningAiService
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Project, User
from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.infrastructure.db.models import (
    DocumentRow,
    PlanningAiJobRow,
    PlanningDraftRow,
    PlanningStateRow,
    ProjectRow,
)
from dahaze_api.infrastructure.db.planning_ai_repository import SqlPlanningAiJobRepository
from dahaze_api.infrastructure.db.planning_repository import SqlPlanningRepository
from dahaze_api.infrastructure.db.repositories import SqlDocumentRepository, SqlProjectRepository
from dahaze_api.infrastructure.db.session import to_asyncpg_url
from dahaze_api.infrastructure.planning_worker import PlanningAiWorker
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler

RECOVERY_DATABASE_NAME = "dahaze_ai_worker_recovery_20260923"
RECOVERY_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if urlsplit(RECOVERY_DATABASE_URL).path.removeprefix("/") != RECOVERY_DATABASE_NAME:
    pytest.skip(
        f"set TEST_DATABASE_URL to the dedicated {RECOVERY_DATABASE_NAME} database",
        allow_module_level=True,
    )

FIRST_TEXT = (
    "@모듈 첫번째(first)\n\n"
    "첫번째 항목(first_item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
)
SECOND_TEXT = (
    "@모듈 두번째(second)\n\n"
    "두번째 항목(second_item)은 다음 필드들로 구성되어 있다.\n"
    "    코드(code): 필수 문자열\n"
)
RECLAIMED_TEXT = (
    "@모듈 새작업(reclaimed)\n\n"
    "새 항목(new_item)은 다음 필드들로 구성되어 있다.\n"
    "    값(value): 필수 문자열\n"
)


@pytest.fixture
async def recovery_sessions(_database: None) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(to_asyncpg_url(RECOVERY_DATABASE_URL))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture(autouse=True)
async def cleanup_recovery_projects(
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> AsyncIterator[None]:
    yield
    async with recovery_sessions() as cleanup:
        ids = list(
            (
                await cleanup.execute(
                    select(ProjectRow.id).where(ProjectRow.slug.like("worker-recovery-%"))
                )
            ).scalars()
        )
        await cleanup.execute(delete(ProjectRow).where(ProjectRow.id.in_(ids)))
        await cleanup.commit()


class StaticPlanningLlm:
    def __init__(self, changes: Sequence[Mapping[str, Any]]) -> None:
        self._changes = [dict(change) for change in changes]
        self.plan_calls = 0

    @property
    def model(self) -> str:
        return "fake-worker-recovery"

    async def interview_project(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        raise AssertionError("generation recovery must not call interview_project")

    async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        self.plan_calls += 1
        return {"summary": "복구 테스트", "questions": [], "changes": self._changes}

    async def close(self) -> None:
        return None


class ScriptedDraftLlm:
    def __init__(self, responses: Mapping[str, Sequence[str | Exception]]) -> None:
        self._responses = {key: list(values) for key, values in responses.items()}
        self.calls: list[dict[str, Any]] = []

    @property
    def model(self) -> str:
        return "fake-worker-recovery"

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
        grammar: EbnfGrammar,
        system_prompt: str | None = None,
    ) -> str:
        self.calls.append(
            {
                "instruction": instruction,
                "current_text": current_text,
                "diagnostics": list(diagnostics),
                "grammar": grammar.name,
                "system_prompt": system_prompt,
            }
        )
        scripted = self._responses.get(instruction, [])
        if not scripted:
            raise AssertionError(f"unexpected draft call: {instruction}")
        response = scripted.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class BlockingDraftLlm:
    def __init__(self, text: str) -> None:
        self.text = text
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0

    @property
    def model(self) -> str:
        return "fake-worker-recovery"

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
        grammar: EbnfGrammar,
        system_prompt: str | None = None,
    ) -> str:
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return self.text


def _service(session: AsyncSession) -> PlanningAiService:
    return PlanningAiService(
        workspace=WorkspaceService(
            projects=SqlProjectRepository(session),
            documents=SqlDocumentRepository(session),
            compiler=cast(RspdlCompilerPort, object()),
        ),
        planning=SqlPlanningRepository(session),
        jobs=SqlPlanningAiJobRepository(session),
    )


async def _create_project(session: AsyncSession, owner_id: UUID) -> Project:
    project = await SqlProjectRepository(session).create(
        owner_id=owner_id,
        slug=f"worker-recovery-{uuid4().hex}",
        name="Worker recovery",
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


async def _enqueue_generation(
    session: AsyncSession, *, project: Project, actor_id: UUID
) -> Mapping[str, Any]:
    job = await SqlPlanningAiJobRepository(session).enqueue(
        project_id=project.id,
        actor_id=actor_id,
        request_id=uuid4(),
        kind="generate",
        instruction="두 문서를 작성해 주세요.",
        expected_planning_revision=0,
        frozen_project_revision=project.revision,
        frozen_source_hash=project.source_hash,
        context={"selected_subject": None},
        source_draft_id=None,
        retry_of_job_id=None,
        attempt=1,
        max_attempts=3,
    )
    assert job is not None
    await session.commit()
    return job


def _worker(
    sessions: async_sessionmaker[AsyncSession],
    *,
    planning_llm: StaticPlanningLlm,
    draft_llm: ScriptedDraftLlm | BlockingDraftLlm,
) -> PlanningAiWorker:
    return PlanningAiWorker(
        sessions=sessions,
        compiler=LocalRspdlCompiler(),
        llm=draft_llm,
        planning_llm=planning_llm,
    )


async def _stored_job(
    sessions: async_sessionmaker[AsyncSession], job_id: object
) -> Mapping[str, Any]:
    async with sessions() as verify:
        stored = await SqlPlanningAiJobRepository(verify).get(UUID(str(job_id)))
        assert stored is not None
        return stored


async def test_retry_reuses_first_compiled_document_and_only_regenerates_second(
    session: AsyncSession,
    user: User,
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    original = await _enqueue_generation(session, project=project, actor_id=user.id)
    changes = [
        {
            "operation": "upsert",
            "path": "first.rspdl",
            "title": "첫번째",
            "instruction": "first",
        },
        {
            "operation": "upsert",
            "path": "second.rspdl",
            "title": "두번째",
            "instruction": "second",
        },
    ]
    planning_llm = StaticPlanningLlm(changes)
    draft_llm = ScriptedDraftLlm(
        {"first": [FIRST_TEXT], "second": [RuntimeError("provider interrupted"), SECOND_TEXT]}
    )
    worker = _worker(recovery_sessions, planning_llm=planning_llm, draft_llm=draft_llm)

    assert await worker.run_once() is True
    failed = await _stored_job(recovery_sessions, original["id"])
    assert failed["status"] == "failed"
    assert failed["checkpoints"]["completed_paths"] == ["first.rspdl"]
    checkpoint_documents = {
        item["path"]: item["text"] for item in failed["checkpoints"]["candidate_documents"]
    }
    assert checkpoint_documents == {"first.rspdl": FIRST_TEXT}
    assert failed["checkpoints"]["compiler_result"]["files"][0]["diagnostics"] == []

    retried = await _service(session).retry(
        actor_id=user.id,
        project_id=project.id,
        job_id=UUID(str(original["id"])),
    )
    await session.commit()
    assert await worker.run_once() is True

    completed = await _stored_job(recovery_sessions, retried["id"])
    assert completed["status"] == "succeeded"
    async with recovery_sessions() as verify:
        draft = await verify.get(PlanningDraftRow, UUID(str(completed["result"]["draft_id"])))
        assert draft is not None
        documents = {
            cast(Mapping[str, Any], item)["path"]: cast(Mapping[str, Any], item)["text"]
            for item in draft.candidate_documents
        }
        assert documents == {"first.rspdl": FIRST_TEXT, "second.rspdl": SECOND_TEXT}
    assert [call["instruction"] for call in draft_llm.calls] == ["first", "second", "second"]
    assert planning_llm.plan_calls == 1


async def test_cancellation_during_llm_prevents_draft_publication(
    session: AsyncSession,
    user: User,
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue_generation(session, project=project, actor_id=user.id)
    planning_llm = StaticPlanningLlm(
        [
            {
                "operation": "upsert",
                "path": "cancelled.rspdl",
                "title": "취소",
                "instruction": "cancelled",
            }
        ]
    )
    draft_llm = BlockingDraftLlm(FIRST_TEXT)
    running = asyncio.create_task(
        _worker(recovery_sessions, planning_llm=planning_llm, draft_llm=draft_llm).run_once()
    )
    await asyncio.wait_for(draft_llm.started.wait(), timeout=2)

    async with recovery_sessions() as cancel_session:
        cancelled = await SqlPlanningAiJobRepository(cancel_session).request_cancel(
            UUID(str(job["id"]))
        )
        assert cancelled is not None and cancelled["cancel_requested"] is True
        await cancel_session.commit()
    draft_llm.release.set()
    assert await asyncio.wait_for(running, timeout=2) is True

    stored = await _stored_job(recovery_sessions, job["id"])
    assert stored["status"] == "cancelled"
    assert stored["result"] is None
    async with recovery_sessions() as verify:
        draft_count = await verify.scalar(
            select(func.count()).select_from(PlanningDraftRow).where(
                PlanningDraftRow.project_id == project.id
            )
        )
        assert draft_count == 0


async def test_expired_lease_old_worker_cannot_publish_after_reclaim(
    session: AsyncSession,
    user: User,
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue_generation(session, project=project, actor_id=user.id)
    changes = [
        {
            "operation": "upsert",
            "path": "reclaimed.rspdl",
            "title": "재할당",
            "instruction": "reclaimed",
        }
    ]
    old_planning = StaticPlanningLlm(changes)
    old_llm = BlockingDraftLlm(FIRST_TEXT)
    old_run = asyncio.create_task(
        _worker(recovery_sessions, planning_llm=old_planning, draft_llm=old_llm).run_once()
    )
    await asyncio.wait_for(old_llm.started.wait(), timeout=2)

    async with recovery_sessions() as expire:
        await expire.execute(
            update(PlanningAiJobRow)
            .where(PlanningAiJobRow.id == job["id"])
            .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await expire.commit()

    new_planning = StaticPlanningLlm(changes)
    new_llm = ScriptedDraftLlm({"reclaimed": [RECLAIMED_TEXT]})
    assert await _worker(
        recovery_sessions, planning_llm=new_planning, draft_llm=new_llm
    ).run_once() is True
    old_llm.release.set()
    assert await asyncio.wait_for(old_run, timeout=2) is True

    stored = await _stored_job(recovery_sessions, job["id"])
    assert stored["status"] == "succeeded"
    async with recovery_sessions() as verify:
        drafts = (
            (
                await verify.execute(
                    select(PlanningDraftRow).where(PlanningDraftRow.project_id == project.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(drafts) == 1
        reclaimed = cast(Mapping[str, Any], drafts[0].candidate_documents[0])
        assert reclaimed["text"] == RECLAIMED_TEXT
        assert FIRST_TEXT not in str(drafts[0].candidate_documents)


async def test_three_diagnostic_attempts_publish_reviewable_unaccepted_draft(
    session: AsyncSession,
    user: User,
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue_generation(session, project=project, actor_id=user.id)
    planning_llm = StaticPlanningLlm(
        [
            {
                "operation": "upsert",
                "path": "broken.rspdl",
                "title": "검토 필요",
                "instruction": "broken",
            }
        ]
    )
    draft_llm = ScriptedDraftLlm(
        {"broken": ["첫 실패", "두번째 실패", "세번째 실패"]}
    )

    assert await _worker(
        recovery_sessions, planning_llm=planning_llm, draft_llm=draft_llm
    ).run_once() is True

    stored = await _stored_job(recovery_sessions, job["id"])
    assert stored["status"] == "succeeded"
    assert len(draft_llm.calls) == 3
    assert draft_llm.calls[0]["diagnostics"] == []
    assert draft_llm.calls[1]["diagnostics"]
    assert draft_llm.calls[2]["diagnostics"]
    async with recovery_sessions() as verify:
        draft = await verify.get(PlanningDraftRow, UUID(str(stored["result"]["draft_id"])))
        assert draft is not None
        candidate = cast(Mapping[str, Any], draft.candidate_documents[0])
        assert candidate["text"] == "세번째 실패"
        assert draft.result is not None
        files = cast(list[Mapping[str, Any]], draft.result["files"])
        assert files[0]["diagnostics"]
        accepted_count = await verify.scalar(
            select(func.count())
            .select_from(DocumentRow)
            .where(DocumentRow.project_id == project.id)
        )
        current_project = await verify.get(ProjectRow, project.id)
        assert accepted_count == 0
        assert current_project is not None and current_project.revision == project.revision


async def test_duplicate_planned_paths_are_rejected_before_drafting(
    session: AsyncSession,
    user: User,
    recovery_sessions: async_sessionmaker[AsyncSession],
) -> None:
    project = await _create_project(session, user.id)
    job = await _enqueue_generation(session, project=project, actor_id=user.id)
    duplicate = {
        "operation": "upsert",
        "path": "duplicate.rspdl",
        "title": "중복",
        "instruction": "duplicate",
    }
    planning_llm = StaticPlanningLlm([duplicate, duplicate])
    draft_llm = ScriptedDraftLlm({})

    assert await _worker(
        recovery_sessions, planning_llm=planning_llm, draft_llm=draft_llm
    ).run_once() is True

    stored = await _stored_job(recovery_sessions, job["id"])
    assert stored["status"] == "failed"
    assert planning_llm.plan_calls == 3
    assert stored["error"] == {
        "code": "invalid_output",
        "message": "AI 문서 변경 계획의 형식을 세 번 검증했지만 고치지 못했다.",
        "retryable": True,
    }
    assert draft_llm.calls == []
    async with recovery_sessions() as verify:
        draft_count = await verify.scalar(
            select(func.count()).select_from(PlanningDraftRow).where(
                PlanningDraftRow.project_id == project.id
            )
        )
        assert draft_count == 0
