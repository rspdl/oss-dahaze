"""프로젝트 기획 상태, 컴파일된 초안, 버전 스냅샷 유스케이스."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.application.workspace import WorkspaceService, validate_document_identity
from dahaze_api.domain.planning import DecisionResolutionStatus
from dahaze_api.domain.ports import PlanningRepositoryPort, RspdlCompilerPort
from dahaze_api.domain.rspdl import RspdlSource, project_source_hash, source_fingerprint

ALLOWED_MESSAGE_ROLES = frozenset({"user", "assistant"})
ALLOWED_DECISION_STATUSES = frozenset({"open", "decided", "deferred"})
RESOLVED_DECISION_STATUSES = frozenset({"decided", "deferred"})
RESOLVED_PROPOSAL_STATUSES = frozenset({"adopted", "deferred"})


def _validate_message_roles(messages: Sequence[Mapping[str, Any]]) -> None:
    if any(message.get("role") not in ALLOWED_MESSAGE_ROLES for message in messages):
        raise Conflict("기획 메시지 role은 user 또는 assistant여야 한다")


def _validate_decision_status(status: str, *, resolving: bool = False) -> None:
    allowed = RESOLVED_DECISION_STATUSES if resolving else ALLOWED_DECISION_STATUSES
    if status not in allowed:
        raise Conflict(f"결정 status는 {', '.join(sorted(allowed))} 중 하나여야 한다")


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
        _validate_message_roles(messages)
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.update_state(
            project_id,
            actor_id=actor_id,
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
        _validate_message_roles([{"role": role}])
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
        _validate_decision_status(status)
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

    async def resolve_proposal(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        proposal_id: UUID,
        expected_revision: int,
        status: str,
        rationale: str | None,
    ) -> Mapping[str, Any]:
        if status not in RESOLVED_PROPOSAL_STATUSES:
            raise Conflict("제안 status는 adopted 또는 deferred여야 한다")
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        updated = await self._store.resolve_proposal(
            project_id,
            proposal_id=proposal_id,
            expected_revision=expected_revision,
            status=status,
            rationale=rationale,
        )
        if updated is None:
            raise Conflict("기획 상태가 변경되었거나 제안을 찾을 수 없거나 이미 해결되었다")
        return updated

    async def resolve_decision(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        decision_id: UUID,
        expected_revision: int,
        status: str,
        rationale: str | None,
    ) -> Mapping[str, Any]:
        _validate_decision_status(status, resolving=True)
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        outcome = await self._store.resolve_decision(
            project_id,
            decision_id=decision_id,
            expected_revision=expected_revision,
            status=status,
            rationale=rationale,
        )
        if outcome.status is DecisionResolutionStatus.STALE:
            raise Conflict("기획 상태가 다른 곳에서 변경되었다")
        if outcome.status is DecisionResolutionStatus.NOT_FOUND or outcome.value is None:
            raise NotFound("결정을 찾을 수 없다")
        return outcome.value

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
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        limit: int,
        before_revision: int | None,
    ) -> list[Mapping[str, Any]]:
        await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        return await self._store.list_metadata_revisions(
            project_id, limit=limit, before_revision=before_revision
        )

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
                validate_document_identity(path=path, title=title)
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

    async def propose_edit(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        document_id: UUID,
        base_project_revision: int,
        base_source_hash: str,
        expected_source_hash: str,
        edit: Mapping[str, Any],
        summary: str | None,
    ) -> Mapping[str, Any]:
        """컴파일러 편집 후보를 프로젝트 초안으로 만든다. 확정 문서는 저장하지 않는다."""
        project = await self._workspace.get_project(actor_id=actor_id, project_id=project_id)
        if project.revision != base_project_revision or project.source_hash != base_source_hash:
            raise Conflict("프로젝트 원문이 다른 곳에서 변경되었다")
        membership = await self._workspace.require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        document = await self._workspace.get_document(actor_id=actor_id, document_id=document_id)
        if document.project_id != project_id:
            raise NotFound("문서를 찾을 수 없다")
        if source_fingerprint(document.text) != expected_source_hash:
            raise Conflict("문서 원문이 다른 곳에서 변경되었다")

        edited = await self._compiler.edit(
            RspdlSource(path=document.path, text=document.text),
            expected_source_hash=expected_source_hash,
            edit=edit,
        )
        payload: dict[str, Any] = {
            "supported": edited.supported,
            "unsupported_reason": edited.unsupported_reason,
            "rspdl_version": edited.runtime.rspdl_version,
            "wire_schema_version": edited.runtime.wire_schema_version,
            "locale": edited.runtime.locale,
            "compiler_response": edited.response,
            "draft": None,
        }
        if not edited.supported:
            return payload
        response = edited.response
        if not isinstance(response, Mapping):
            raise RuntimeError("supported rspdl edit did not include a response")
        outcome = response.get("outcome")
        if not isinstance(outcome, Mapping):
            raise RuntimeError("rspdl edit response did not include an outcome")
        if outcome.get("status") == "rejected":
            return payload
        if outcome.get("status") != "applied":
            raise RuntimeError("rspdl edit response included an unknown status")
        candidate_text = response.get("candidate_text")
        candidate_hash = response.get("candidate_source_hash")
        if not isinstance(candidate_text, str) or not isinstance(candidate_hash, str):
            raise RuntimeError("applied rspdl edit did not include a candidate source")
        if source_fingerprint(candidate_text) != candidate_hash:
            raise RuntimeError("rspdl edit candidate hash does not match its source")

        payload["draft"] = await self.create_draft(
            actor_id=actor_id,
            project_id=project_id,
            base_project_revision=base_project_revision,
            base_source_hash=base_source_hash,
            changes=[
                {
                    "operation": "upsert",
                    "path": document.path,
                    "title": document.title,
                    "text": candidate_text,
                }
            ],
            summary=summary,
        )
        return payload

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
