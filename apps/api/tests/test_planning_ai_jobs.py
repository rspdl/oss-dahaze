from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.infrastructure.db.models import PlanningDraftRow
from dahaze_api.infrastructure.db.session import to_asyncpg_url
from dahaze_api.infrastructure.planning_worker import PlanningAiWorker
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler

VALID_TEXT = (
    "@모듈 재고(inventory)\n\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
)
BASE_TEXT = (
    "@모듈 기존(existing)\n\n"
    "기존 항목(existing_item)은 다음 필드들로 구성되어 있다.\n"
    "    코드(code): 필수 문자열\n"
)


class FakePlanningLlm:
    def __init__(self) -> None:
        self.interview_contexts: list[Mapping[str, Any]] = []
        self.plan_contexts: list[Mapping[str, Any]] = []
        self.draft_calls = 0

    @property
    def model(self) -> str:
        return "fake-planning-model"

    async def interview_project(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        self.interview_contexts.append(context)
        return {
            "assistant_message": "환불 가능 시점을 먼저 정해야 합니다.",
            "policy_first_questions": [
                {"question": "언제까지 환불할 수 있나요?", "reason": "정책 영향", "subject": None}
            ],
            "proposals": [{"title": "출발 전 환불", "rationale": "검토 제안", "subject": "refund"}],
            "decision_updates": [],
            "selected_subject": context.get("selected_subject"),
            "unsupported": [],
        }

    async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
        self.plan_contexts.append(context)
        return {
            "summary": "재고 문서 추가",
            "questions": [],
            "changes": [
                {
                    "operation": "upsert",
                    "path": "inventory.rspdl",
                    "title": "재고",
                    "instruction": "재고 이름을 선언한다.",
                }
            ],
        }

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
        grammar: EbnfGrammar,
        system_prompt: str | None = None,
    ) -> str:
        self.draft_calls += 1
        return VALID_TEXT

    async def close(self) -> None:
        return None


def _factory() -> async_sessionmaker[AsyncSession]:
    url = os.environ.get(
        "TEST_DATABASE_URL", "postgresql://dahaze:dahaze@localhost:55432/dahaze_test"
    )
    engine = create_async_engine(to_asyncpg_url(url))
    return async_sessionmaker(engine, expire_on_commit=False)


async def _project(client: httpx.AsyncClient, slug: str) -> dict[str, Any]:
    response = await client.post("/api/projects", json={"slug": slug, "name": slug})
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


async def test_interview_job_is_idempotent_and_persists_structured_result(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    project = await _project(client, "durable-interview")
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    request_id = str(uuid4())
    payload = {
        "request_id": request_id,
        "kind": "interview",
        "expected_planning_revision": state["revision"],
        "instruction": "환불 정책을 정하고 싶어요.",
        "selected_subject": {
            "kind": "screen",
            "id": "booking.refund",
            "source_path": "booking.rspdl",
            "stable_id": "booking.refund",
            "label": "환불 화면",
        },
    }
    first = await client.post(f"/api/projects/{project['id']}/planning/ai-jobs", json=payload)
    repeated = await client.post(f"/api/projects/{project['id']}/planning/ai-jobs", json=payload)
    assert first.status_code == repeated.status_code == 202
    assert first.json()["id"] == repeated.json()["id"]
    planning = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    assert [item["role"] for item in planning["messages"]] == ["user"]
    await session.commit()

    llm = FakePlanningLlm()
    worker = PlanningAiWorker(
        sessions=_factory(),
        compiler=LocalRspdlCompiler(),
        llm=llm,
        planning_llm=llm,
    )
    assert await worker.run_once() is True
    session.expire_all()
    result = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{first.json()['id']}")
    ).json()
    assert result["status"] == "succeeded"
    assert result["result"]["disposition"] == "current"
    assert result["result"]["proposals"][0]["status"] == "open"
    planning = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    assert [item["role"] for item in planning["messages"]] == ["user", "assistant"]
    assert planning["proposals"][0]["status"] == "open"
    assert not planning["decisions"]
    adopted = await client.patch(
        f"/api/projects/{project['id']}/planning/proposals/{planning['proposals'][0]['id']}",
        json={
            "expected_revision": planning["revision"],
            "status": "adopted",
            "rationale": "시험 정책으로 채택",
        },
    )
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["decision"]["proposal_id"] == planning["proposals"][0]["id"]
    assert adopted.json()["decision"]["rationale"] == "검토 제안"
    assert adopted.json()["decision"]["resolution_rationale"] == "시험 정책으로 채택"
    assert adopted.json()["decision"]["subject"] == "refund"
    assert adopted.json()["decision"]["source_path"] == "booking.rspdl"
    assert adopted.json()["decision"]["stable_id"] == "booking.refund"
    assert adopted.json()["item"]["rationale"] == "검토 제안"
    assert adopted.json()["item"]["resolution_rationale"] == "시험 정책으로 채택"


async def test_generate_job_creates_compiled_draft_without_mutating_source(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    project = await _project(client, "durable-generation")
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    response = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "generate",
            "expected_planning_revision": state["revision"],
            "instruction": "결정된 범위의 재고 명세를 작성해 주세요.",
            "base_project_revision": project["revision"],
            "base_source_hash": project["source_hash"],
        },
    )
    assert response.status_code == 202, response.text
    await session.commit()
    llm = FakePlanningLlm()
    worker = PlanningAiWorker(
        sessions=_factory(),
        compiler=LocalRspdlCompiler(),
        llm=llm,
        planning_llm=llm,
    )
    assert await worker.run_once() is True
    session.expire_all()
    job = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{response.json()['id']}")
    ).json()
    assert job["status"] == "succeeded"
    assert job["result"]["draft_id"]
    assert "text" not in job["result"]["changes"][0]
    assert (await client.get(f"/api/projects/{project['id']}/documents")).json() == []
    draft = (await client.get(f"/api/planning/drafts/{job['result']['draft_id']}")).json()
    assert draft["candidate_documents"][0]["text"] == VALID_TEXT
    assert not draft["result"]["files"][0]["diagnostics"]
    assert llm.plan_contexts[0]["authoring_contract"]["profile"]
    assert isinstance(llm.plan_contexts[0]["compiler"]["capabilities"], list)
    assert "system_prompt" not in llm.plan_contexts[0]["authoring_contract"]


async def test_generation_persists_compiled_accepted_baseline(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    project = await _project(client, "generation-base-result")
    created = await client.post(
        f"/api/projects/{project['id']}/documents",
        json={"path": "inventory.rspdl", "title": "기존", "text": BASE_TEXT},
    )
    assert created.status_code == 201, created.text
    project = (await client.get(f"/api/projects/{project['id']}")).json()
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    enqueued = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "generate",
            "expected_planning_revision": state["revision"],
            "instruction": "기존 문서를 확정된 범위로 갱신해 주세요.",
            "base_project_revision": project["revision"],
            "base_source_hash": project["source_hash"],
        },
    )
    assert enqueued.status_code == 202, enqueued.text
    await session.commit()
    llm = FakePlanningLlm()
    assert await PlanningAiWorker(
        sessions=_factory(), compiler=LocalRspdlCompiler(), llm=llm, planning_llm=llm
    ).run_once()

    job = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{enqueued.json()['id']}")
    ).json()
    session.expire_all()
    draft = await session.get(PlanningDraftRow, UUID(job["result"]["draft_id"]))
    assert draft is not None and draft.base_result is not None
    files = cast(list[Mapping[str, Any]], draft.base_result["files"])
    assert files[0]["path"] == "inventory.rspdl"


async def test_generation_from_draft_keeps_original_accepted_base_result(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    project = await _project(client, "generation-draft-base-result")
    await client.post(
        f"/api/projects/{project['id']}/documents",
        json={"path": "inventory.rspdl", "title": "기존", "text": BASE_TEXT},
    )
    project = (await client.get(f"/api/projects/{project['id']}")).json()
    source_draft = await client.post(
        f"/api/projects/{project['id']}/planning/drafts",
        json={
            "base_project_revision": project["revision"],
            "base_source_hash": project["source_hash"],
            "changes": [
                {
                    "operation": "upsert",
                    "path": "inventory.rspdl",
                    "title": "후보",
                    "text": VALID_TEXT,
                }
            ],
            "summary": "후보",
        },
    )
    assert source_draft.status_code == 201, source_draft.text
    source_draft_id = source_draft.json()["id"]
    original = await session.get(PlanningDraftRow, UUID(source_draft_id))
    assert original is not None and original.base_result is not None
    expected_base_result = original.base_result
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    enqueued = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "generate",
            "expected_planning_revision": state["revision"],
            "instruction": "후보의 진단을 고쳐 주세요.",
            "source_draft_id": source_draft_id,
            "base_project_revision": project["revision"],
            "base_source_hash": project["source_hash"],
        },
    )
    assert enqueued.status_code == 202, enqueued.text
    await session.commit()
    llm = FakePlanningLlm()
    assert await PlanningAiWorker(
        sessions=_factory(), compiler=LocalRspdlCompiler(), llm=llm, planning_llm=llm
    ).run_once()

    job = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{enqueued.json()['id']}")
    ).json()
    session.expire_all()
    derived = await session.get(PlanningDraftRow, UUID(job["result"]["draft_id"]))
    assert derived is not None
    assert derived.base_result == expected_base_result


@pytest.mark.parametrize(
    ("path", "title"),
    [("../export.rspdl", "내보내기"), ("notes.txt", "메모"), ("valid.rspdl", "가" * 201)],
)
async def test_invalid_generated_file_identity_fails_before_document_llm(
    client: httpx.AsyncClient,
    session: AsyncSession,
    path: str,
    title: str,
) -> None:
    project = await _project(client, f"invalid-plan-{uuid4().hex[:8]}")
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    created = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "generate",
            "expected_planning_revision": state["revision"],
            "instruction": "잘못된 계획 검증",
        },
    )
    await session.commit()

    class InvalidPlanLlm(FakePlanningLlm):
        async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
            self.plan_contexts.append(context)
            return {
                "summary": "잘못된 경로",
                "questions": [],
                "changes": [
                    {
                        "operation": "upsert",
                        "path": path,
                        "title": title,
                        "instruction": "작성",
                    }
                ],
            }

    llm = InvalidPlanLlm()
    assert await PlanningAiWorker(
        sessions=_factory(), compiler=LocalRspdlCompiler(), llm=llm, planning_llm=llm
    ).run_once()
    job = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{created.json()['id']}")
    ).json()
    assert job["status"] == "failed"
    assert job["error"]["code"] == "invalid_output"
    assert job["error"]["retryable"] is True
    assert len(llm.plan_contexts) == 3
    assert llm.draft_calls == 0
    draft_count = await session.scalar(
        select(func.count())
        .select_from(PlanningDraftRow)
        .where(PlanningDraftRow.project_id == UUID(project["id"]))
    )
    assert draft_count == 0


async def test_invalid_plan_is_replaced_with_bounded_validation_feedback(
    client: httpx.AsyncClient, session: AsyncSession
) -> None:
    project = await _project(client, "plan-format-repair")
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    created = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "generate",
            "expected_planning_revision": state["revision"],
            "instruction": "재고 문서를 작성해 주세요.",
        },
    )
    await session.commit()

    class RepairingPlanLlm(FakePlanningLlm):
        async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]:
            self.plan_contexts.append(context)
            if len(self.plan_contexts) == 1:
                duplicate = {
                    "operation": "upsert",
                    "path": "inventory.rspdl",
                    "title": "재고",
                    "instruction": "재고 문서를 작성한다.",
                }
                return {"summary": "중복", "questions": [], "changes": [duplicate, duplicate]}
            assert context["validation_feedback"]["attempt"] == 1
            return {
                "summary": "재고 문서 추가",
                "questions": [],
                "changes": [
                    {
                        "operation": "upsert",
                        "path": "inventory.rspdl",
                        "title": "재고",
                        "instruction": "재고 이름을 선언한다.",
                    }
                ],
            }

    llm = RepairingPlanLlm()
    assert await PlanningAiWorker(
        sessions=_factory(), compiler=LocalRspdlCompiler(), llm=llm, planning_llm=llm
    ).run_once()
    job = (
        await client.get(f"/api/projects/{project['id']}/planning/ai-jobs/{created.json()['id']}")
    ).json()
    assert job["status"] == "succeeded"
    assert job["result"]["draft_id"]
    assert len(llm.plan_contexts) == 2
    assert llm.draft_calls == 1


async def test_cancel_and_retry_are_persistent_and_idempotent(
    client: httpx.AsyncClient,
) -> None:
    project = await _project(client, "durable-cancel-retry")
    state = (await client.get(f"/api/projects/{project['id']}/planning")).json()
    created = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs",
        json={
            "request_id": str(uuid4()),
            "kind": "interview",
            "expected_planning_revision": state["revision"],
            "instruction": "취소할 인터뷰",
        },
    )
    job_id = created.json()["id"]
    listed = await client.get(f"/api/projects/{project['id']}/planning/ai-jobs")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == job_id
    cancelled = await client.post(f"/api/projects/{project['id']}/planning/ai-jobs/{job_id}/cancel")
    assert cancelled.status_code == 202
    assert cancelled.json()["status"] == "cancelled"
    first_retry = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs/{job_id}/retry"
    )
    second_retry = await client.post(
        f"/api/projects/{project['id']}/planning/ai-jobs/{job_id}/retry"
    )
    assert first_retry.status_code == second_retry.status_code == 202
    assert first_retry.json()["id"] == second_retry.json()["id"]
    assert first_retry.json()["retry_of_job_id"] == job_id
