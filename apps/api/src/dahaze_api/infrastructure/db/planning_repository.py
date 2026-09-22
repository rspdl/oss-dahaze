from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.planning import DecisionResolutionOutcome, DecisionResolutionStatus
from dahaze_api.domain.rspdl import RspdlSource, project_source_hash
from dahaze_api.infrastructure.db.models import (
    DocumentRevisionRow,
    DocumentRow,
    PlanningDraftRow,
    PlanningMetadataRevisionRow,
    PlanningStateRow,
    ProjectRow,
    ProjectSnapshotRow,
)


def _state(row: PlanningStateRow) -> dict[str, Any]:
    return {
        "revision": row.revision,
        "messages": row.messages,
        "decisions": row.decisions,
        "proposals": row.proposals,
        "metadata": row.metadata_,
    }


def _draft(row: PlanningDraftRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "base_project_revision": row.base_project_revision,
        "base_source_hash": row.base_source_hash,
        "changes": row.changes,
        "candidate_documents": row.candidate_documents,
        "candidate_source_hash": row.candidate_source_hash,
        "summary": row.summary,
        "rspdl_version": row.rspdl_version,
        "wire_schema_version": row.wire_schema_version,
        "locale": row.locale,
        "result": row.result,
        "base_result": row.base_result,
        "applied_revision": row.applied_revision,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _snapshot(row: ProjectSnapshotRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "snapshot_version": row.snapshot_version,
        "project_revision": row.project_revision,
        "planning_revision": row.planning_revision,
        "source_hash": row.source_hash,
        "documents": row.documents,
        "planning_state": row.planning_state,
        "rspdl_version": row.rspdl_version,
        "wire_schema_version": row.wire_schema_version,
        "locale": row.locale,
        "result": row.result,
        "change_kind": row.change_kind,
        "summary": row.summary,
        "author_id": row.author_id,
        "created_at": row.created_at,
    }


class SqlPlanningRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _ensure_state(self, project_id: UUID) -> PlanningStateRow:
        stmt = (
            insert(PlanningStateRow)
            .values(
                project_id=project_id,
                revision=0,
                messages=[],
                decisions=[],
                proposals=[],
                metadata_={},
            )
            .on_conflict_do_nothing()
        )
        await self._session.execute(stmt)
        row = await self._session.get(PlanningStateRow, project_id)
        assert row is not None
        return row

    async def get_state(self, project_id: UUID) -> Mapping[str, Any]:
        return _state(await self._ensure_state(project_id))

    async def update_state(
        self,
        project_id: UUID,
        *,
        expected_revision: int,
        messages: Sequence[Mapping[str, Any]],
        decisions: Sequence[Mapping[str, Any]],
        proposals: Sequence[Mapping[str, Any]],
        metadata: Mapping[str, Any],
    ) -> Mapping[str, Any] | None:
        await self._ensure_state(project_id)
        row = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if row.revision != expected_revision:
            return None
        row.revision += 1
        row.messages, row.decisions, row.proposals = (
            list(messages),
            list(decisions),
            list(proposals),
        )
        row.metadata_ = dict(metadata)
        await self._session.flush()
        await self._session.refresh(row)
        return _state(row)

    async def append_message(
        self, project_id: UUID, *, expected_revision: int, role: str, content: str
    ) -> Mapping[str, Any] | None:
        row = await self._lock_state(project_id)
        if row.revision != expected_revision:
            return None
        item = {
            "id": str(uuid4()),
            "role": role,
            "content": content,
            "created_at": datetime.now(UTC).isoformat(),
        }
        row.messages = [*row.messages, item]
        row.revision += 1
        await self._session.flush()
        return {"item": item, "state": _state(row)}

    async def append_decision(
        self,
        project_id: UUID,
        *,
        expected_revision: int,
        title: str,
        rationale: str | None,
        status: str,
    ) -> Mapping[str, Any] | None:
        row = await self._lock_state(project_id)
        if row.revision != expected_revision:
            return None
        item = {
            "id": str(uuid4()),
            "title": title,
            "rationale": rationale,
            "status": status,
            "created_at": datetime.now(UTC).isoformat(),
        }
        row.decisions = [*row.decisions, item]
        row.revision += 1
        await self._session.flush()
        return {"item": item, "state": _state(row)}

    async def resolve_decision(
        self,
        project_id: UUID,
        *,
        decision_id: UUID,
        expected_revision: int,
        status: str,
        rationale: str | None,
    ) -> DecisionResolutionOutcome:
        row = await self._lock_state(project_id)
        if row.revision != expected_revision:
            return DecisionResolutionOutcome(DecisionResolutionStatus.STALE)
        index = next(
            (
                index
                for index, value in enumerate(row.decisions)
                if isinstance(value, Mapping) and value.get("id") == str(decision_id)
            ),
            None,
        )
        if index is None:
            return DecisionResolutionOutcome(DecisionResolutionStatus.NOT_FOUND)
        current = row.decisions[index]
        assert isinstance(current, Mapping)
        resolved_at = datetime.now(UTC).isoformat()
        history = current.get("resolution_history", [])
        if not isinstance(history, list):
            history = []
        event = {
            "from_status": current.get("status"),
            "to_status": status,
            "previous_rationale": current.get("rationale"),
            "rationale": rationale,
            "resolved_at": resolved_at,
        }
        item = {
            **dict(current),
            "status": status,
            "rationale": rationale,
            "resolved_at": resolved_at,
            "resolution_history": [*history, event],
        }
        decisions = list(row.decisions)
        decisions[index] = item
        row.decisions = decisions
        row.revision += 1
        await self._session.flush()
        return DecisionResolutionOutcome(
            DecisionResolutionStatus.UPDATED,
            {"item": item, "state": _state(row)},
        )

    async def _lock_state(self, project_id: UUID) -> PlanningStateRow:
        await self._ensure_state(project_id)
        return (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def patch_metadata(
        self,
        project_id: UUID,
        *,
        actor_id: UUID,
        expected_revision: int,
        patch: Mapping[str, Any],
        summary: str | None,
    ) -> Mapping[str, Any] | None:
        row = await self._lock_state(project_id)
        if row.revision != expected_revision:
            return None
        baseline = (
            await self._session.execute(
                select(PlanningMetadataRevisionRow).where(
                    PlanningMetadataRevisionRow.project_id == project_id,
                    PlanningMetadataRevisionRow.revision == row.revision,
                )
            )
        ).scalar_one_or_none()
        if baseline is None:
            self._session.add(
                PlanningMetadataRevisionRow(
                    id=uuid4(),
                    project_id=project_id,
                    revision=row.revision,
                    metadata_=dict(row.metadata_),
                    author_id=actor_id,
                    summary="메타데이터 변경 전 기준",
                )
            )
        metadata = dict(row.metadata_)
        metadata.update(dict(patch))
        row.revision += 1
        row.metadata_ = metadata
        history = PlanningMetadataRevisionRow(
            id=uuid4(),
            project_id=project_id,
            revision=row.revision,
            metadata_=metadata,
            author_id=actor_id,
            summary=summary,
        )
        self._session.add(history)
        await self._session.flush()
        return {"revision": row.revision, "metadata": metadata}

    async def list_metadata_revisions(self, project_id: UUID) -> list[Mapping[str, Any]]:
        rows = (
            (
                await self._session.execute(
                    select(PlanningMetadataRevisionRow)
                    .where(PlanningMetadataRevisionRow.project_id == project_id)
                    .order_by(PlanningMetadataRevisionRow.revision.desc())
                )
            )
            .scalars()
            .all()
        )
        return [
            {
                "revision": item.revision,
                "metadata": item.metadata_,
                "author_id": item.author_id,
                "summary": item.summary,
                "created_at": item.created_at,
            }
            for item in rows
        ]

    async def undo_metadata(
        self, project_id: UUID, *, actor_id: UUID, expected_revision: int, target_revision: int
    ) -> Mapping[str, Any] | None:
        row = await self._lock_state(project_id)
        if row.revision != expected_revision:
            return None
        target = (
            await self._session.execute(
                select(PlanningMetadataRevisionRow).where(
                    PlanningMetadataRevisionRow.project_id == project_id,
                    PlanningMetadataRevisionRow.revision == target_revision,
                )
            )
        ).scalar_one_or_none()
        if target is None:
            return None
        row.revision += 1
        row.metadata_ = dict(target.metadata_)
        self._session.add(
            PlanningMetadataRevisionRow(
                id=uuid4(),
                project_id=project_id,
                revision=row.revision,
                metadata_=row.metadata_,
                author_id=actor_id,
                summary=f"메타데이터 리비전 {target_revision} 복원",
            )
        )
        await self._session.flush()
        return {"revision": row.revision, "metadata": row.metadata_}

    async def create_draft(
        self,
        *,
        project_id: UUID,
        base_project_revision: int,
        base_source_hash: str,
        changes: Sequence[Mapping[str, Any]],
        candidate_documents: Sequence[Mapping[str, Any]],
        candidate_source_hash: str,
        summary: str | None,
        rspdl_version: str,
        wire_schema_version: int,
        locale: str,
        result: Mapping[str, Any] | None,
        base_result: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]:
        row = PlanningDraftRow(
            id=uuid4(),
            project_id=project_id,
            base_project_revision=base_project_revision,
            base_source_hash=base_source_hash,
            changes=list(changes),
            candidate_documents=list(candidate_documents),
            candidate_source_hash=candidate_source_hash,
            summary=summary,
            rspdl_version=rspdl_version,
            wire_schema_version=wire_schema_version,
            locale=locale,
            result=None if result is None else dict(result),
            base_result=None if base_result is None else dict(base_result),
        )
        self._session.add(row)
        await self._session.flush()
        return _draft(row)

    async def get_draft(self, draft_id: UUID) -> Mapping[str, Any] | None:
        row = await self._session.get(PlanningDraftRow, draft_id)
        return _draft(row) if row else None

    async def list_drafts(self, project_id: UUID) -> list[Mapping[str, Any]]:
        rows = (
            (
                await self._session.execute(
                    select(PlanningDraftRow)
                    .where(PlanningDraftRow.project_id == project_id)
                    .order_by(PlanningDraftRow.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [_draft(row) for row in rows]

    async def apply_draft(
        self,
        *,
        draft_id: UUID,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
    ) -> Mapping[str, Any] | None:
        draft = await self._session.get(PlanningDraftRow, draft_id)
        if draft is None:
            return None
        project = (
            await self._session.execute(
                select(ProjectRow)
                .where(ProjectRow.id == draft.project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if (
            project.revision != expected_project_revision
            or project.source_hash != expected_source_hash
            or draft.base_project_revision != expected_project_revision
            or draft.base_source_hash != expected_source_hash
            or draft.applied_revision is not None
        ):
            return None
        await self._ensure_state(project.id)
        state = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        current = (
            (
                await self._session.execute(
                    select(DocumentRow)
                    .where(DocumentRow.project_id == project.id, DocumentRow.deleted_at.is_(None))
                    .order_by(DocumentRow.path)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        baseline_docs = [self._doc_payload(row) for row in current]
        project.snapshot_version += 1
        await self._write_snapshot(
            project=project,
            documents=baseline_docs,
            state=state,
            result=draft.base_result,
            rspdl_version=draft.rspdl_version,
            wire_schema_version=draft.wire_schema_version,
            locale=draft.locale,
            change_kind="baseline",
            summary="적용 전 기준",
            author_id=actor_id,
        )
        await self._replace_documents(
            project,
            current,
            cast(list[Mapping[str, Any]], draft.candidate_documents),
            actor_id,
            draft.summary or "기획 변경안 적용",
        )
        project.revision += 1
        project.source_hash = draft.candidate_source_hash
        project.snapshot_version += 1
        draft.applied_revision = project.revision
        await self._session.flush()
        applied_rows = (
            (
                await self._session.execute(
                    select(DocumentRow)
                    .where(DocumentRow.project_id == project.id, DocumentRow.deleted_at.is_(None))
                    .order_by(DocumentRow.path)
                )
            )
            .scalars()
            .all()
        )
        snap = await self._write_snapshot(
            project=project,
            documents=[self._doc_payload(row) for row in applied_rows],
            state=state,
            result=draft.result,
            rspdl_version=draft.rspdl_version,
            wire_schema_version=draft.wire_schema_version,
            locale=draft.locale,
            change_kind="apply",
            summary=draft.summary,
            author_id=actor_id,
        )
        return _snapshot(snap)

    async def list_snapshots(self, project_id: UUID) -> list[Mapping[str, Any]]:
        rows = (
            (
                await self._session.execute(
                    select(ProjectSnapshotRow)
                    .where(ProjectSnapshotRow.project_id == project_id)
                    .order_by(ProjectSnapshotRow.snapshot_version.desc())
                )
            )
            .scalars()
            .all()
        )
        return [_snapshot(row) for row in rows]

    async def capture_snapshot(
        self,
        *,
        project_id: UUID,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
        compiled_source_hash: str,
        summary: str | None,
        rspdl_version: str,
        wire_schema_version: int,
        locale: str,
        result: Mapping[str, Any] | None,
    ) -> Mapping[str, Any] | None:
        project = (
            await self._session.execute(
                select(ProjectRow)
                .where(ProjectRow.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        await self._ensure_state(project_id)
        state = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if (
            project.revision != expected_project_revision
            or project.source_hash != expected_source_hash
            or state.revision != expected_planning_revision
        ):
            return None
        documents = (
            (
                await self._session.execute(
                    select(DocumentRow)
                    .where(DocumentRow.project_id == project_id, DocumentRow.deleted_at.is_(None))
                    .order_by(DocumentRow.path)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        locked_hash = project_source_hash(
            [RspdlSource(path=item.path, text=item.text) for item in documents]
        )
        if locked_hash != compiled_source_hash or locked_hash != expected_source_hash:
            return None
        project.snapshot_version += 1
        await self._session.flush()
        row = await self._write_snapshot(
            project=project,
            documents=[self._doc_payload(item) for item in documents],
            state=state,
            result=result,
            rspdl_version=rspdl_version,
            wire_schema_version=wire_schema_version,
            locale=locale,
            change_kind="capture",
            summary=summary,
            author_id=actor_id,
        )
        return _snapshot(row)

    async def get_snapshot(self, project_id: UUID, revision: int) -> Mapping[str, Any] | None:
        row = (
            await self._session.execute(
                select(ProjectSnapshotRow).where(
                    ProjectSnapshotRow.project_id == project_id,
                    ProjectSnapshotRow.snapshot_version == revision,
                )
            )
        ).scalar_one_or_none()
        return _snapshot(row) if row else None

    async def restore_snapshot(
        self,
        *,
        project_id: UUID,
        revision: int,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
    ) -> Mapping[str, Any] | None:
        target = (
            await self._session.execute(
                select(ProjectSnapshotRow).where(
                    ProjectSnapshotRow.project_id == project_id,
                    ProjectSnapshotRow.snapshot_version == revision,
                )
            )
        ).scalar_one_or_none()
        if target is None:
            return None
        project = (
            await self._session.execute(
                select(ProjectRow)
                .where(ProjectRow.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if (
            project.revision != expected_project_revision
            or project.source_hash != expected_source_hash
        ):
            return None
        await self._ensure_state(project_id)
        state = (
            await self._session.execute(
                select(PlanningStateRow)
                .where(PlanningStateRow.project_id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if state.revision != expected_planning_revision:
            return None
        current = (
            (
                await self._session.execute(
                    select(DocumentRow)
                    .where(DocumentRow.project_id == project_id, DocumentRow.deleted_at.is_(None))
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        current_documents = [self._doc_payload(row) for row in current]
        project.snapshot_version += 1
        await self._write_snapshot(
            project=project,
            documents=current_documents,
            state=state,
            result=None,
            rspdl_version=target.rspdl_version,
            wire_schema_version=target.wire_schema_version,
            locale=target.locale,
            change_kind="baseline",
            summary=f"버전 {revision} 복원 전 기준",
            author_id=actor_id,
        )
        await self._replace_documents(
            project,
            current,
            cast(list[Mapping[str, Any]], target.documents),
            actor_id,
            f"프로젝트 버전 {revision} 복원",
        )
        state.revision += 1
        target_state = cast(dict[str, Any], target.planning_state)
        state.messages = cast(list[object], target_state.get("messages", []))
        state.decisions = cast(list[object], target_state.get("decisions", []))
        state.proposals = cast(list[object], target_state.get("proposals", []))
        state.metadata_ = cast(dict[str, object], target_state.get("metadata", {}))
        project.revision += 1
        project.source_hash = target.source_hash
        project.snapshot_version += 1
        await self._session.flush()
        restored_rows = (
            (
                await self._session.execute(
                    select(DocumentRow)
                    .where(DocumentRow.project_id == project.id, DocumentRow.deleted_at.is_(None))
                    .order_by(DocumentRow.path)
                )
            )
            .scalars()
            .all()
        )
        snap = await self._write_snapshot(
            project=project,
            documents=[self._doc_payload(row) for row in restored_rows],
            state=state,
            result=target.result,
            rspdl_version=target.rspdl_version,
            wire_schema_version=target.wire_schema_version,
            locale=target.locale,
            change_kind="restore",
            summary=f"버전 {revision} 복원",
            author_id=actor_id,
        )
        return _snapshot(snap)

    async def _write_snapshot(
        self,
        *,
        project: ProjectRow,
        documents: Sequence[Mapping[str, Any]],
        state: PlanningStateRow,
        result: Mapping[str, Any] | None,
        rspdl_version: str,
        wire_schema_version: int,
        locale: str,
        change_kind: str,
        summary: str | None,
        author_id: UUID,
    ) -> ProjectSnapshotRow:
        existing = (
            await self._session.execute(
                select(ProjectSnapshotRow).where(
                    ProjectSnapshotRow.project_id == project.id,
                    ProjectSnapshotRow.snapshot_version == project.snapshot_version,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        row = ProjectSnapshotRow(
            id=uuid4(),
            project_id=project.id,
            snapshot_version=project.snapshot_version,
            project_revision=project.revision,
            planning_revision=state.revision,
            source_hash=project.source_hash,
            documents=list(documents),
            planning_state=_state(state),
            rspdl_version=rspdl_version,
            wire_schema_version=wire_schema_version,
            locale=locale,
            result=None if result is None else dict(result),
            change_kind=change_kind,
            summary=summary,
            author_id=author_id,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def _replace_documents(
        self,
        project: ProjectRow,
        current: Sequence[DocumentRow],
        desired: Sequence[Mapping[str, Any]],
        actor_id: UUID,
        summary: str,
    ) -> None:
        by_path = {row.path: row for row in current}
        desired_paths = {str(item["path"]) for item in desired}
        for path, row in by_path.items():
            if path not in desired_paths:
                row.deleted_at = datetime.now(UTC)
        for item in desired:
            path, text, title = str(item["path"]), str(item["text"]), str(item["title"])
            existing = by_path.get(path)
            target_row: DocumentRow
            if existing is None:
                target_row = DocumentRow(
                    id=uuid4(),
                    project_id=project.id,
                    path=path,
                    title=title,
                    text=text,
                    target_rspdl_version=str(
                        item.get("target_rspdl_version", project.default_rspdl_version)
                    ),
                )
                self._session.add(target_row)
                next_no = 1
            elif existing.text == text and existing.title == title:
                continue
            else:
                target_row = existing
                count = (
                    await self._session.execute(
                        select(DocumentRevisionRow.revision_no)
                        .where(DocumentRevisionRow.document_id == target_row.id)
                        .order_by(DocumentRevisionRow.revision_no.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                next_no = (count or 0) + 1
                target_row.text, target_row.title = text, title
                target_row.target_rspdl_version = str(
                    item.get("target_rspdl_version", target_row.target_rspdl_version)
                )
            self._session.add(
                DocumentRevisionRow(
                    id=uuid4(),
                    document_id=target_row.id,
                    revision_no=next_no,
                    text=text,
                    target_rspdl_version=target_row.target_rspdl_version,
                    author_id=actor_id,
                    summary=summary,
                )
            )

    @staticmethod
    def _doc_payload(row: DocumentRow) -> dict[str, Any]:
        return {
            "id": str(row.id),
            "path": row.path,
            "title": row.title,
            "text": row.text,
            "target_rspdl_version": row.target_rspdl_version,
        }
