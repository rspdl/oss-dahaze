"""프로젝트 AI 작업의 enqueue/read/cancel/retry 유스케이스."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID, uuid4

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.ports import PlanningAiJobRepositoryPort, PlanningRepositoryPort

AI_JOB_KINDS = frozenset({"interview", "generate"})
RETRYABLE_STATUSES = frozenset({"failed", "cancelled"})
MAX_JOB_ATTEMPTS = 3


class PlanningAiService:
    def __init__(
        self,
        *,
        workspace: WorkspaceService,
        planning: PlanningRepositoryPort,
        jobs: PlanningAiJobRepositoryPort,
    ) -> None:
        self._workspace = workspace
        self._planning = planning
        self._jobs = jobs

    async def enqueue(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        request_id: UUID,
        kind: str,
        instruction: str,
        expected_planning_revision: int,
        base_project_revision: int | None,
        base_source_hash: str | None,
        selected_subject: Mapping[str, Any] | None,
        source_draft_id: UUID | None,
    ) -> Mapping[str, Any]:
        if kind not in AI_JOB_KINDS:
            raise Conflict("AI 작업 kind는 interview 또는 generate여야 한다")
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        existing = await self._jobs.get_by_request(
            project_id=project_id, actor_id=actor_id, request_id=request_id
        )
        if existing is not None:
            if not _same_request(
                existing,
                kind=kind,
                instruction=instruction,
                source_draft_id=source_draft_id,
                selected_subject=selected_subject,
            ):
                raise Conflict("같은 request_id가 다른 AI 작업 요청에 이미 사용되었다")
            return existing
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        if base_project_revision is not None and base_project_revision != project.revision:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")
        if base_source_hash is not None and base_source_hash != project.source_hash:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")

        context: dict[str, Any] = {
            "selected_subject": None if selected_subject is None else dict(selected_subject)
        }
        result = await self._jobs.enqueue(
            project_id=project_id,
            actor_id=actor_id,
            request_id=request_id,
            kind=kind,
            instruction=instruction,
            expected_planning_revision=expected_planning_revision,
            frozen_project_revision=project.revision,
            frozen_source_hash=project.source_hash,
            context=context,
            source_draft_id=source_draft_id,
            retry_of_job_id=None,
            attempt=1,
            max_attempts=MAX_JOB_ATTEMPTS,
        )
        if result is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        return result

    async def get(self, *, actor_id: UUID, project_id: UUID, job_id: UUID) -> Mapping[str, Any]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        job = await self._jobs.get(job_id)
        if job is None or UUID(str(job["project_id"])) != project_id:
            raise NotFound("AI 작업을 찾을 수 없다")
        return job

    async def list(
        self, *, actor_id: UUID, project_id: UUID, limit: int
    ) -> list[Mapping[str, Any]]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        return await self._jobs.list(project_id, limit=limit)

    async def cancel(self, *, actor_id: UUID, project_id: UUID, job_id: UUID) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        await self.get(actor_id=actor_id, project_id=project_id, job_id=job_id)
        job = await self._jobs.request_cancel(job_id)
        if job is None:
            raise NotFound("AI 작업을 찾을 수 없다")
        return job

    async def retry(self, *, actor_id: UUID, project_id: UUID, job_id: UUID) -> Mapping[str, Any]:
        original = await self.get(actor_id=actor_id, project_id=project_id, job_id=job_id)
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        if original["status"] not in RETRYABLE_STATUSES:
            raise Conflict("실패하거나 취소된 AI 작업만 재시도할 수 있다")
        existing_retry = await self._jobs.get_retry(job_id)
        if existing_retry is not None:
            return existing_retry
        attempt = int(original["attempt"]) + 1
        if attempt > int(original["max_attempts"]):
            raise Conflict("AI 작업의 최대 재시도 횟수를 넘었다")
        state = await self._planning.get_state(project_id)
        result = await self._jobs.enqueue(
            project_id=project_id,
            actor_id=actor_id,
            request_id=uuid4(),
            kind=str(original["kind"]),
            instruction=str(original["request"]["instruction"]),
            expected_planning_revision=int(state["revision"]),
            frozen_project_revision=int(original["frozen_project_revision"]),
            frozen_source_hash=str(original["frozen_source_hash"]),
            context={
                **original["context"],
                "preserve_source": True,
                "retry_checkpoints": original.get("checkpoints", {}),
            },
            source_draft_id=original.get("source_draft_id"),
            retry_of_job_id=job_id,
            attempt=attempt,
            max_attempts=int(original["max_attempts"]),
            append_user_message=False,
        )
        if result is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        return result


def _same_request(
    job: Mapping[str, Any],
    *,
    kind: str,
    instruction: str,
    source_draft_id: UUID | None,
    selected_subject: Mapping[str, Any] | None,
) -> bool:
    context = job.get("context")
    return (
        job.get("kind") == kind
        and isinstance(job.get("request"), Mapping)
        and job["request"].get("instruction") == instruction
        and job.get("source_draft_id") == source_draft_id
        and isinstance(context, Mapping)
        and context.get("selected_subject")
        == (None if selected_subject is None else dict(selected_subject))
    )
