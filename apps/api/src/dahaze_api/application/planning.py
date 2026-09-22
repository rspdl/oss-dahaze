"""프로젝트 기획 상태, 컴파일된 초안, 버전 스냅샷 유스케이스."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.ports import PlanningRepositoryPort, RspdlCompilerPort
from dahaze_api.domain.rspdl import RspdlSource, project_source_hash


def _has_blocking_diagnostics(
    result: Mapping[str, Any] | None, *, expected_paths: set[str]
) -> bool:
    """알 수 없는 결과는 통과시키지 않는다. error 만 적용을 막는다."""
    if not isinstance(result, Mapping):
        return True
    files = result.get("files")
    if not isinstance(files, list) or not files:
        return True
    actual_paths: list[str] = []
    for file in files:
        if not isinstance(file, Mapping) or not isinstance(file.get("diagnostics"), list):
            return True
        path = file.get("path")
        if not isinstance(path, str):
            return True
        actual_paths.append(path)
        module = file.get("module")
        if not isinstance(module, Mapping) or not isinstance(module.get("id"), str):
            return True
        for diagnostic in file["diagnostics"]:
            if not isinstance(diagnostic, Mapping):
                return True
            severity = diagnostic.get("severity")
            if not isinstance(severity, str):
                return True
            if severity.lower() not in {"warning", "info", "error"}:
                return True
            if severity.lower() == "error":
                return True
    return len(actual_paths) != len(set(actual_paths)) or set(actual_paths) != expected_paths


class PlanningService:
    def __init__(
        self,
        *,
        workspace: WorkspaceService,
        store: PlanningRepositoryPort,
        analyzer: AnalyzeWorkspace,
        compiler: RspdlCompilerPort,
    ) -> None:
        self._workspace = workspace
        self._store = store
        self._analyzer = analyzer
        self._compiler = compiler

    async def state(self, *, actor_id: UUID, project_id: UUID) -> Mapping[str, Any]:
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        state = dict(await self._store.get_state(project_id))
        state.update(project_revision=project.revision, source_hash=project.source_hash)
        return state

    async def update_state(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        expected_revision: int,
        messages: Sequence[Mapping[str, Any]],
        decisions: Sequence[Mapping[str, Any]],
        proposals: Sequence[Mapping[str, Any]],
        metadata: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.update_state(
            project_id,
            expected_revision=expected_revision,
            messages=messages,
            decisions=decisions,
            proposals=proposals,
            metadata=metadata,
        )
        if updated is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        result = dict(updated)
        result.update(project_revision=project.revision, source_hash=project.source_hash)
        return result

    async def append_message(
        self, *, actor_id: UUID, project_id: UUID, expected_revision: int, role: str, content: str
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.append_message(
            project_id, expected_revision=expected_revision, role=role, content=content
        )
        if updated is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        return updated

    async def append_decision(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        expected_revision: int,
        title: str,
        rationale: str | None,
        status: str,
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.append_decision(
            project_id,
            expected_revision=expected_revision,
            title=title,
            rationale=rationale,
            status=status,
        )
        if updated is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        return updated

    async def patch_metadata(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        expected_revision: int,
        patch: Mapping[str, Any],
        summary: str | None,
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.patch_metadata(
            project_id,
            actor_id=actor_id,
            expected_revision=expected_revision,
            patch=patch,
            summary=summary,
        )
        if updated is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었거나 복원 대상이 없다")
        return updated

    async def metadata_history(
        self, *, actor_id: UUID, project_id: UUID
    ) -> list[Mapping[str, Any]]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        return await self._store.list_metadata_revisions(project_id)

    async def undo_metadata(
        self, *, actor_id: UUID, project_id: UUID, expected_revision: int, target_revision: int
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.undo_metadata(
            project_id,
            actor_id=actor_id,
            expected_revision=expected_revision,
            target_revision=target_revision,
        )
        if updated is None:
            raise Conflict("기획 상태가 다른 곳에서 변경되었거나 복원 대상이 없다")
        return updated

    async def create_draft(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        base_project_revision: int,
        base_source_hash: str,
        changes: Sequence[Mapping[str, Any]],
        summary: str | None,
    ) -> Mapping[str, Any]:
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        if project.revision != base_project_revision or project.source_hash != base_source_hash:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        documents = await self._workspace.list_documents(actor_id=actor_id, project_id=project_id)
        by_path: dict[str, dict[str, Any]] = {
            d.path: {
                "id": str(d.id),
                "path": d.path,
                "title": d.title,
                "text": d.text,
                "target_rspdl_version": d.target_rspdl_version,
            }
            for d in documents
        }
        enriched_changes: list[dict[str, Any]] = []
        seen_paths: set[str] = set()
        for change in changes:
            path, operation = change.get("path"), change.get("operation")
            if not isinstance(path, str) or operation not in {"upsert", "delete"}:
                raise Conflict("변경안의 operation/path가 올바르지 않다")
            if path in seen_paths:
                raise Conflict(f"한 초안에서 같은 경로를 두 번 변경할 수 없다: {path}")
            seen_paths.add(path)
            before = by_path.get(path)
            enriched_changes.append(
                {
                    **dict(change),
                    "before_exists": before is not None,
                    "before_title": None if before is None else before["title"],
                    "before_text": None if before is None else before["text"],
                }
            )
            if operation == "delete":
                if path not in by_path:
                    raise Conflict(f"삭제할 문서가 없다: {path}")
                del by_path[path]
            else:
                text, title = change.get("text"), change.get("title")
                if not isinstance(text, str) or not isinstance(title, str) or not title:
                    raise Conflict("upsert 변경에는 title과 text가 필요하다")
                by_path[path] = {
                    "id": by_path.get(path, {}).get("id"),
                    "path": path,
                    "title": title,
                    "text": text,
                    "target_rspdl_version": by_path.get(path, {}).get(
                        "target_rspdl_version", project.default_rspdl_version
                    ),
                }
        base_sources = [RspdlSource(path=d.path, text=d.text) for d in documents]
        if project_source_hash(base_sources) != base_source_hash:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")
        sources = [RspdlSource(path=x["path"], text=x["text"]) for x in by_path.values()]
        base_outcome = await self._analyzer.compile(base_sources) if base_sources else None
        outcome = await self._analyzer.compile(sources) if sources else None
        runtime = outcome.runtime if outcome else self._compiler.runtime
        return await self._store.create_draft(
            project_id=project_id,
            base_project_revision=base_project_revision,
            base_source_hash=base_source_hash,
            changes=enriched_changes,
            candidate_documents=list(by_path.values()),
            candidate_source_hash=project_source_hash(sources),
            summary=summary,
            rspdl_version=runtime.rspdl_version,
            wire_schema_version=runtime.wire_schema_version,
            locale=runtime.locale,
            result=None if outcome is None else outcome.result,
            base_result=None if base_outcome is None else base_outcome.result,
        )

    async def draft(self, *, actor_id: UUID, draft_id: UUID) -> Mapping[str, Any]:
        draft = await self._store.get_draft(draft_id)
        if draft is None:
            raise NotFound("초안을 찾을 수 없다")
        await self._workspace.get_project(
            actor_id=actor_id, project_id=UUID(str(draft["project_id"]))
        )
        return draft

    async def drafts(self, *, actor_id: UUID, project_id: UUID) -> list[Mapping[str, Any]]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        return await self._store.list_drafts(project_id)

    async def apply(
        self,
        *,
        actor_id: UUID,
        draft_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
    ) -> Mapping[str, Any]:
        draft = await self.draft(actor_id=actor_id, draft_id=draft_id)
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=UUID(str(draft["project_id"]))
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        candidate_documents = draft.get("candidate_documents")
        runtime_matches = (
            draft["rspdl_version"] == self._compiler.runtime.rspdl_version
            and draft["wire_schema_version"] == self._compiler.runtime.wire_schema_version
            and draft["locale"] == self._compiler.runtime.locale
        )
        candidate_hash_matches = isinstance(candidate_documents, list) and (
            project_source_hash(
                [
                    RspdlSource(path=str(item.get("path", "")), text=str(item.get("text", "")))
                    for item in candidate_documents
                    if isinstance(item, Mapping)
                ]
            )
            == draft.get("candidate_source_hash")
        )
        blocks = (
            not isinstance(candidate_documents, list)
            or (
                bool(candidate_documents)
                and _has_blocking_diagnostics(
                    draft.get("result"),
                    expected_paths={
                        str(item.get("path"))
                        for item in candidate_documents
                        if isinstance(item, Mapping)
                    },
                )
            )
            or (not candidate_documents and draft.get("result") is not None)
            or not runtime_matches
            or not candidate_hash_matches
        )
        if blocks:
            return {
                "applied": False,
                "project_revision": None,
                "source_hash": None,
                "analysis": _analysis(draft),
                "snapshot": None,
            }
        applied = await self._store.apply_draft(
            draft_id=draft_id,
            actor_id=actor_id,
            expected_project_revision=expected_project_revision,
            expected_source_hash=expected_source_hash,
        )
        if applied is None:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")
        return {
            "applied": True,
            "project_revision": applied["project_revision"],
            "source_hash": applied["source_hash"],
            "analysis": _analysis(draft),
            "snapshot": applied,
        }

    async def snapshots(self, *, actor_id: UUID, project_id: UUID) -> list[Mapping[str, Any]]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        return await self._store.list_snapshots(project_id)

    async def capture(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
        summary: str | None,
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        documents = await self._workspace.list_documents(actor_id=actor_id, project_id=project_id)
        sources = [RspdlSource(path=d.path, text=d.text) for d in documents]
        outcome = await self._analyzer.compile(sources) if sources else None
        runtime = outcome.runtime if outcome else self._compiler.runtime
        captured = await self._store.capture_snapshot(
            project_id=project_id,
            actor_id=actor_id,
            expected_project_revision=expected_project_revision,
            expected_source_hash=expected_source_hash,
            expected_planning_revision=expected_planning_revision,
            compiled_source_hash=project_source_hash(sources),
            summary=summary,
            rspdl_version=runtime.rspdl_version,
            wire_schema_version=runtime.wire_schema_version,
            locale=runtime.locale,
            result=None if outcome is None else outcome.result,
        )
        if captured is None:
            raise Conflict("프로젝트 또는 기획 상태가 다른 곳에서 변경되었다")
        return captured

    async def handoff(
        self, *, actor_id: UUID, project_id: UUID, revision: int
    ) -> Mapping[str, Any]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        snapshot = await self._store.get_snapshot(project_id, revision)
        if snapshot is None:
            raise NotFound("프로젝트 스냅샷을 찾을 수 없다")
        return snapshot

    async def restore(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        revision: int,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
    ) -> Mapping[str, Any]:
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        restored = await self._store.restore_snapshot(
            project_id=project_id,
            revision=revision,
            actor_id=actor_id,
            expected_project_revision=expected_project_revision,
            expected_source_hash=expected_source_hash,
            expected_planning_revision=expected_planning_revision,
        )
        if restored is None:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었거나 스냅샷이 없다")
        return restored


def _analysis(draft: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "rspdl_version": draft["rspdl_version"],
        "wire_schema_version": draft["wire_schema_version"],
        "locale": draft["locale"],
        "result": draft.get("result"),
    }
