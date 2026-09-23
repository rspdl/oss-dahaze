from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.infrastructure.db.models import (
    DocumentRow,
    PlanningAiJobRow,
    PlanningDraftRow,
    PlanningStateRow,
    ProjectRow,
)

TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})
MAX_WORKER_RUNS = 5


def _payload(row: PlanningAiJobRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "actor_id": row.actor_id,
        "request_id": row.request_id,
        "kind": row.kind,
        "status": row.status,
        "request": row.request,
        "context": row.context,
        "frozen_planning_revision": row.frozen_planning_revision,
        "frozen_project_revision": row.frozen_project_revision,
        "frozen_source_hash": row.frozen_source_hash,
        "source_draft_id": row.source_draft_id,
        "retry_of_job_id": row.retry_of_job_id,
        "attempt": row.attempt,
        "max_attempts": row.max_attempts,
        "run_count": row.run_count,
        "progress": row.progress,
        "checkpoints": row.checkpoints,
        "result": row.result,
        "error": row.error,
        "cancel_requested": row.cancel_requested,
        "lease_token": row.lease_token,
        "lease_expires_at": row.lease_expires_at,
        "heartbeat_at": row.heartbeat_at,
        "started_at": row.started_at,
        "finished_at": row.finished_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


class SqlPlanningAiJobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def enqueue(
        self,
        *,
        project_id: UUID,
        actor_id: UUID,
        request_id: UUID,
        kind: str,
        instruction: str,
        expected_planning_revision: int,
        frozen_project_revision: int,
        frozen_source_hash: str,
        context: Mapping[str, Any],
        source_draft_id: UUID | None,
        retry_of_job_id: UUID | None,
        attempt: int,
        max_attempts: int,
        append_user_message: bool = True,
    ) -> Mapping[str, Any] | None:
        existing = await self._find_request(project_id, actor_id, request_id)
        if existing is not None:
            return (
                _payload(existing)
                if _same_enqueue(existing, kind, instruction, source_draft_id, context)
                else None
            )

        project = (
            await self._session.execute(
                select(ProjectRow)
                .where(ProjectRow.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if project is None:
            return None
        existing = await self._find_request(project_id, actor_id, request_id)
        if existing is not None:
            return (
                _payload(existing)
                if _same_enqueue(existing, kind, instruction, source_draft_id, context)
                else None
            )
        if retry_of_job_id is not None:
            existing_retry = (
                await self._session.execute(
                    select(PlanningAiJobRow).where(
                        PlanningAiJobRow.retry_of_job_id == retry_of_job_id
                    )
                )
            ).scalar_one_or_none()
            if existing_retry is not None:
                return _payload(existing_retry)
        if project.revision != frozen_project_revision or project.source_hash != frozen_source_hash:
            return None

        state = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if state is None:
            state = PlanningStateRow(
                project_id=project_id,
                revision=0,
                metadata_revision=0,
                messages=[],
                decisions=[],
                proposals=[],
                metadata_={},
            )
            self._session.add(state)
            await self._session.flush()
        if state.revision != expected_planning_revision:
            return None
        if append_user_message:
            state.messages = [
                *state.messages,
                {
                    "id": str(uuid4()),
                    "role": "user",
                    "content": instruction,
                    "created_at": datetime.now(UTC).isoformat(),
                    "request_id": str(request_id),
                },
            ]
            state.revision += 1
        frozen_context = dict(context)
        preserve_context = bool(frozen_context.get("preserve_source"))
        job_project_revision = frozen_project_revision
        job_source_hash = frozen_source_hash
        if not preserve_context:
            if source_draft_id is None:
                documents = (
                    (
                        await self._session.execute(
                            select(DocumentRow)
                            .where(
                                DocumentRow.project_id == project_id,
                                DocumentRow.deleted_at.is_(None),
                            )
                            .order_by(DocumentRow.path)
                        )
                    )
                    .scalars()
                    .all()
                )
                frozen_context.update(
                    source_kind="accepted",
                    documents=[
                        {
                            "id": str(item.id),
                            "path": item.path,
                            "title": item.title,
                            "text": item.text,
                            "target_rspdl_version": item.target_rspdl_version,
                        }
                        for item in documents
                    ],
                    compiler_result=None,
                )
            else:
                draft = await self._session.get(PlanningDraftRow, source_draft_id)
                if draft is None or draft.project_id != project_id:
                    return None
                if kind == "generate" and (
                    draft.base_project_revision != project.revision
                    or draft.base_source_hash != project.source_hash
                ):
                    return None
                frozen_context.update(
                    source_kind="draft",
                    source_draft_id=str(source_draft_id),
                    documents=draft.candidate_documents,
                    source_changes=draft.changes,
                    compiler_result=draft.result,
                    base_compiler_result=draft.base_result,
                    base_project_revision=draft.base_project_revision,
                    base_source_hash=draft.base_source_hash,
                )
                job_project_revision = draft.base_project_revision
                job_source_hash = draft.base_source_hash
        frozen_context.pop("preserve_source", None)
        retry_checkpoints = frozen_context.pop("retry_checkpoints", {})
        job_planning_revision = state.revision
        if preserve_context:
            original_state = frozen_context.get("planning_state")
            if isinstance(original_state, Mapping) and isinstance(
                original_state.get("revision"), int
            ):
                job_planning_revision = int(original_state["revision"])
        else:
            frozen_context["planning_state"] = {
                "revision": state.revision,
                "metadata_revision": state.metadata_revision,
                "messages": state.messages,
                "decisions": state.decisions,
                "proposals": state.proposals,
                "metadata": state.metadata_,
            }
        job = PlanningAiJobRow(
            id=uuid4(),
            project_id=project_id,
            actor_id=actor_id,
            request_id=request_id,
            kind=kind,
            status="queued",
            request={"instruction": instruction},
            context=frozen_context,
            frozen_planning_revision=job_planning_revision,
            frozen_project_revision=job_project_revision,
            frozen_source_hash=job_source_hash,
            source_draft_id=source_draft_id,
            retry_of_job_id=retry_of_job_id,
            attempt=attempt,
            max_attempts=max_attempts,
            run_count=0,
            progress={"stage": "queued", "completed": 0, "total": 1, "message": None},
            checkpoints=(dict(retry_checkpoints) if isinstance(retry_checkpoints, Mapping) else {}),
            cancel_requested=False,
        )
        self._session.add(job)
        await self._session.flush()
        await self._session.refresh(job)
        return _payload(job)

    async def get(self, job_id: UUID) -> Mapping[str, Any] | None:
        row = await self._session.get(PlanningAiJobRow, job_id)
        return None if row is None else _payload(row)

    async def get_by_request(
        self, *, project_id: UUID, actor_id: UUID, request_id: UUID
    ) -> Mapping[str, Any] | None:
        row = await self._find_request(project_id, actor_id, request_id)
        return None if row is None else _payload(row)

    async def get_retry(self, job_id: UUID) -> Mapping[str, Any] | None:
        row = (
            await self._session.execute(
                select(PlanningAiJobRow).where(PlanningAiJobRow.retry_of_job_id == job_id)
            )
        ).scalar_one_or_none()
        return None if row is None else _payload(row)

    async def list(self, project_id: UUID, *, limit: int) -> list[Mapping[str, Any]]:
        rows = (
            (
                await self._session.execute(
                    select(PlanningAiJobRow)
                    .where(PlanningAiJobRow.project_id == project_id)
                    .order_by(PlanningAiJobRow.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return [_payload(row) for row in rows]

    async def request_cancel(self, job_id: UUID) -> Mapping[str, Any] | None:
        row = await self._lock(job_id)
        if row is None:
            return None
        if row.status in TERMINAL_STATUSES:
            return _payload(row)
        row.cancel_requested = True
        if row.status == "queued":
            row.status = "cancelled"
            row.finished_at = datetime.now(UTC)
            row.progress = {"stage": "cancelled", "completed": 0, "total": 1, "message": None}
        await self._session.flush()
        await self._session.refresh(row)
        return _payload(row)

    async def claim(self, *, lease_seconds: int) -> Mapping[str, Any] | None:
        while True:
            now = datetime.now(UTC)
            row = (
                await self._session.execute(
                    select(PlanningAiJobRow)
                    .where(
                        or_(
                            PlanningAiJobRow.status == "queued",
                            (
                                (PlanningAiJobRow.status == "running")
                                & (PlanningAiJobRow.lease_expires_at < now)
                            ),
                        ),
                    )
                    .order_by(PlanningAiJobRow.created_at)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            if row.cancel_requested:
                self._finish(row, "cancelled")
                await self._session.flush()
                continue
            if row.run_count >= MAX_WORKER_RUNS:
                row.error = {
                    "code": "provider_failure",
                    "message": "작업 실행기가 여러 번 중단되어 작업을 마치지 못했다.",
                    "retryable": True,
                }
                self._finish(row, "failed")
                await self._session.flush()
                continue
            break
        token = uuid4()
        row.status = "running"
        row.lease_token = token
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
        row.heartbeat_at = now
        row.started_at = row.started_at or now
        row.run_count += 1
        row.progress = {"stage": "starting", "completed": 0, "total": 1, "message": None}
        await self._session.flush()
        await self._session.refresh(row)
        return _payload(row)

    async def heartbeat(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        lease_seconds: int,
        progress: Mapping[str, Any],
    ) -> bool:
        row = await self._fenced(job_id, lease_token)
        if row is None:
            return False
        now = datetime.now(UTC)
        row.heartbeat_at = now
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
        row.progress = dict(progress)
        await self._session.flush()
        return True

    async def cancelled(self, job_id: UUID, *, lease_token: UUID) -> bool:
        row = await self._fenced(job_id, lease_token)
        return row is None or row.cancel_requested

    async def checkpoint(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        checkpoints: Mapping[str, Any],
        progress: Mapping[str, Any],
    ) -> bool:
        row = await self._fenced(job_id, lease_token)
        if row is None or row.cancel_requested:
            return False
        row.checkpoints = dict(checkpoints)
        row.progress = dict(progress)
        await self._session.flush()
        return True

    async def renew_lease(self, job_id: UUID, *, lease_token: UUID, lease_seconds: int) -> bool:
        row = await self._fenced(job_id, lease_token)
        if row is None or row.cancel_requested:
            return False
        now = datetime.now(UTC)
        row.heartbeat_at = now
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
        await self._session.flush()
        return True

    async def finish_cancelled(self, job_id: UUID, *, lease_token: UUID) -> bool:
        row = await self._fenced(job_id, lease_token)
        if row is None:
            return False
        self._finish(row, "cancelled")
        return True

    async def finish_failed(
        self, job_id: UUID, *, lease_token: UUID, error: Mapping[str, Any]
    ) -> bool:
        row = await self._fenced(job_id, lease_token)
        if row is None:
            return False
        row.error = dict(error)
        self._finish(row, "failed")
        return True

    async def finish_interview(
        self, job_id: UUID, *, lease_token: UUID, result: Mapping[str, Any]
    ) -> bool:
        ordered = await self._lock_project_state_job(job_id)
        if ordered is None:
            return False
        project, state, row = ordered
        if row.status != "running" or row.lease_token != lease_token:
            return False
        if row.cancel_requested:
            self._finish(row, "cancelled")
            return True
        stale_reasons: list[str] = []
        if state.revision != row.frozen_planning_revision:
            stale_reasons.append("planning_revision_changed")
        if project.revision != row.frozen_project_revision:
            stale_reasons.append("project_revision_changed")
        if project.source_hash != row.frozen_source_hash:
            stale_reasons.append("source_hash_changed")
        current = not stale_reasons
        stored = dict(result)
        stored["disposition"] = "current" if current else "stale"
        if current:
            assistant = stored.get("assistant_message")
            if isinstance(assistant, str) and assistant:
                state.messages = [
                    *state.messages,
                    {
                        "id": str(uuid4()),
                        "role": "assistant",
                        "content": assistant,
                        "created_at": datetime.now(UTC).isoformat(),
                        "job_id": str(row.id),
                    },
                ]
            proposals = stored.get("proposals")
            if isinstance(proposals, list):
                state.proposals = [*state.proposals, *proposals]
            state.revision += 1
            stored["planning_revision"] = state.revision
        else:
            stored["conflict"] = {
                "frozen_planning_revision": row.frozen_planning_revision,
                "current_planning_revision": state.revision,
                "frozen_project_revision": row.frozen_project_revision,
                "current_project_revision": project.revision,
                "frozen_source_hash": row.frozen_source_hash,
                "current_source_hash": project.source_hash,
                "reasons": stale_reasons,
            }
        row.result = stored
        self._finish(row, "succeeded")
        return True

    async def finish_generation(
        self, job_id: UUID, *, lease_token: UUID, result: Mapping[str, Any]
    ) -> bool:
        ordered = await self._lock_project_state_job(job_id)
        if ordered is None:
            return False
        project, state, row = ordered
        if row.status != "running" or row.lease_token != lease_token:
            return False
        if row.cancel_requested:
            self._finish(row, "cancelled")
            return True
        stale_reasons: list[str] = []
        if state.revision != row.frozen_planning_revision:
            stale_reasons.append("planning_revision_changed")
        if project.revision != row.frozen_project_revision:
            stale_reasons.append("project_revision_changed")
        if project.source_hash != row.frozen_source_hash:
            stale_reasons.append("source_hash_changed")
        stored = dict(result)
        stored["disposition"] = "current" if not stale_reasons else "stale"
        if stale_reasons:
            stored["conflict"] = {
                "reasons": stale_reasons,
                "frozen_planning_revision": row.frozen_planning_revision,
                "current_planning_revision": state.revision,
                "frozen_project_revision": row.frozen_project_revision,
                "current_project_revision": project.revision,
                "frozen_source_hash": row.frozen_source_hash,
                "current_source_hash": project.source_hash,
            }
        row.result = stored
        self._finish(row, "succeeded")
        return True

    async def finish_generation_draft(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        draft: Mapping[str, Any],
        result: Mapping[str, Any],
    ) -> bool:
        ordered = await self._lock_project_state_job(job_id)
        if ordered is None:
            return False
        project, state, row = ordered
        if row.status != "running" or row.lease_token != lease_token or row.cancel_requested:
            if row.cancel_requested and row.status == "running" and row.lease_token == lease_token:
                self._finish(row, "cancelled")
                return True
            return False
        draft_id = uuid4()
        self._session.add(
            PlanningDraftRow(
                id=draft_id,
                project_id=row.project_id,
                base_project_revision=int(draft["base_project_revision"]),
                base_source_hash=str(draft["base_source_hash"]),
                changes=list(draft["changes"]),
                candidate_documents=list(draft["candidate_documents"]),
                candidate_source_hash=str(draft["candidate_source_hash"]),
                summary=draft.get("summary"),
                rspdl_version=str(draft["rspdl_version"]),
                wire_schema_version=int(draft["wire_schema_version"]),
                locale=str(draft["locale"]),
                result=draft.get("result"),
                base_result=draft.get("base_result"),
                applied_revision=None,
            )
        )
        stored = {**dict(result), "draft_id": str(draft_id)}
        stale_reasons: list[str] = []
        if state.revision != row.frozen_planning_revision:
            stale_reasons.append("planning_revision_changed")
        if project.revision != row.frozen_project_revision:
            stale_reasons.append("project_revision_changed")
        if project.source_hash != row.frozen_source_hash:
            stale_reasons.append("source_hash_changed")
        stored["disposition"] = "current" if not stale_reasons else "stale"
        if stale_reasons:
            stored["conflict"] = {
                "reasons": stale_reasons,
                "frozen_planning_revision": row.frozen_planning_revision,
                "current_planning_revision": state.revision,
                "frozen_project_revision": row.frozen_project_revision,
                "current_project_revision": project.revision,
                "frozen_source_hash": row.frozen_source_hash,
                "current_source_hash": project.source_hash,
            }
        row.result = stored
        self._finish(row, "succeeded")
        await self._session.flush()
        return True

    async def _lock(self, job_id: UUID) -> PlanningAiJobRow | None:
        return (
            await self._session.execute(
                select(PlanningAiJobRow)
                .where(PlanningAiJobRow.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()

    async def _find_request(
        self, project_id: UUID, actor_id: UUID, request_id: UUID
    ) -> PlanningAiJobRow | None:
        return (
            await self._session.execute(
                select(PlanningAiJobRow).where(
                    PlanningAiJobRow.project_id == project_id,
                    PlanningAiJobRow.actor_id == actor_id,
                    PlanningAiJobRow.request_id == request_id,
                )
            )
        ).scalar_one_or_none()

    async def _lock_project_state_job(
        self, job_id: UUID
    ) -> tuple[ProjectRow, PlanningStateRow, PlanningAiJobRow] | None:
        unlocked = await self._session.get(PlanningAiJobRow, job_id)
        if unlocked is None:
            return None
        project = (
            await self._session.execute(
                select(ProjectRow)
                .where(ProjectRow.id == unlocked.project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if project is None:
            return None
        state = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == unlocked.project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        row = await self._lock(job_id)
        if row is None:
            return None
        return project, state, row

    async def _fenced(self, job_id: UUID, lease_token: UUID) -> PlanningAiJobRow | None:
        row = await self._lock(job_id)
        if row is None or row.status != "running" or row.lease_token != lease_token:
            return None
        return row

    def _finish(self, row: PlanningAiJobRow, status: str) -> None:
        row.status = status
        row.finished_at = datetime.now(UTC)
        row.lease_token = None
        row.lease_expires_at = None
        row.progress = {"stage": status, "completed": 1, "total": 1, "message": None}


def _same_enqueue(
    existing: PlanningAiJobRow,
    kind: str,
    instruction: str,
    source_draft_id: UUID | None,
    context: Mapping[str, Any],
) -> bool:
    return (
        existing.kind == kind
        and existing.request.get("instruction") == instruction
        and existing.source_draft_id == source_draft_id
        and existing.context.get("selected_subject") == context.get("selected_subject")
    )
