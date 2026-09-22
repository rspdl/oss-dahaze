from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import AccessDenied, Conflict
from dahaze_api.application.planning import PlanningService
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Document, Project, ProjectMembership, ProjectRole
from dahaze_api.domain.ports import PlanningRepositoryPort, RspdlCompilerPort
from dahaze_api.domain.rspdl import (
    AnalysisKind,
    AnalysisOutcome,
    InvalidRspdlEditRequest,
    RspdlEditOutcome,
    RspdlRuntime,
    RspdlSource,
    project_source_hash,
    source_fingerprint,
)
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler, local_adapter

RUNTIME = RspdlRuntime(rspdl_version="test", wire_schema_version=1, locale="ko-KR")
ACTOR_ID = UUID("00000000-0000-0000-0000-000000000001")
PROJECT_ID = UUID("00000000-0000-0000-0000-000000000002")
DOCUMENT_ID = UUID("00000000-0000-0000-0000-000000000003")
SOURCE = "@모듈 예약(booking)\n"
CANDIDATE = "@모듈 예약(booking)\n\n"


class FakeWorkspace:
    def __init__(self, *, role: ProjectRole = ProjectRole.OWNER) -> None:
        now = datetime.now(UTC)
        self.document = Document(
            id=DOCUMENT_ID,
            project_id=PROJECT_ID,
            path="booking.rspdl",
            title="예약",
            text=SOURCE,
            target_rspdl_version="test",
            created_at=now,
            updated_at=now,
        )
        self.project = Project(
            id=PROJECT_ID,
            slug="booking",
            name="예약",
            description=None,
            default_rspdl_version="test",
            revision=3,
            source_hash=project_source_hash(
                [RspdlSource(path=self.document.path, text=self.document.text)]
            ),
            snapshot_version=0,
            created_at=now,
            updated_at=now,
        )
        self.membership = ProjectMembership(project_id=PROJECT_ID, user_id=ACTOR_ID, role=role)

    async def get_project(self, *, actor_id: UUID, project_id: UUID) -> Project:
        assert actor_id == ACTOR_ID and project_id == PROJECT_ID
        return self.project

    async def require_membership(self, *, actor_id: UUID, project_id: UUID) -> ProjectMembership:
        assert actor_id == ACTOR_ID and project_id == PROJECT_ID
        return self.membership

    async def get_document(self, *, actor_id: UUID, document_id: UUID) -> Document:
        assert actor_id == ACTOR_ID and document_id == DOCUMENT_ID
        return self.document

    async def list_documents(self, *, actor_id: UUID, project_id: UUID) -> list[Document]:
        assert actor_id == ACTOR_ID and project_id == PROJECT_ID
        return [self.document]


class FakeCompiler:
    def __init__(self, outcome: RspdlEditOutcome) -> None:
        self.runtime = RUNTIME
        self.outcome = outcome
        self.edit_calls: list[tuple[RspdlSource, str, Mapping[str, Any]]] = []

    async def edit(
        self,
        source: RspdlSource,
        *,
        expected_source_hash: str,
        edit: Mapping[str, Any],
    ) -> RspdlEditOutcome:
        self.edit_calls.append((source, expected_source_hash, edit))
        return self.outcome


class FakeAnalyzer:
    def __init__(self, diagnostics: list[dict[str, Any]] | None = None) -> None:
        self.diagnostics = diagnostics or []
        self.calls: list[Sequence[RspdlSource]] = []

    async def compile(self, sources: Sequence[RspdlSource]) -> AnalysisOutcome:
        self.calls.append(sources)
        return AnalysisOutcome(
            kind=AnalysisKind.COMPILE,
            runtime=RUNTIME,
            result={
                "files": [
                    {
                        "path": source.path,
                        "module": {"id": "booking"},
                        "diagnostics": self.diagnostics,
                    }
                    for source in sources
                ]
            },
        )


class FakePlanningStore:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []

    async def create_draft(self, **values: Any) -> Mapping[str, Any]:
        self.created.append(values)
        return {
            "id": uuid4(),
            "project_id": values["project_id"],
            **values,
        }


def _compiler_response(*, status: str) -> dict[str, Any]:
    response: dict[str, Any] = {
        "schema_version": 1,
        "wire_schema_version": 1,
        "rspdl_version": "test",
        "locale": "ko-KR",
        "source_hash": source_fingerprint(SOURCE),
        "outcome": {"status": status},
        "tombstones": [],
        "id_remap": {},
    }
    if status == "applied":
        response.update(
            candidate_text=CANDIDATE,
            candidate_source_hash=source_fingerprint(CANDIDATE),
            compilation={
                "files": [
                    {
                        "path": "booking.rspdl",
                        "diagnostics": [
                            {"severity": "error", "code": "RSPDL-TEST", "message": "error"}
                        ],
                    }
                ]
            },
        )
    else:
        response["outcome"] = {
            "status": "rejected",
            "code": "RSPDL-EDIT-NOT-FOUND",
            "reason": "element not found",
        }
    return response


def _service(
    *,
    role: ProjectRole = ProjectRole.OWNER,
    response: Mapping[str, Any] | None = None,
    supported: bool = True,
    diagnostics: list[dict[str, Any]] | None = None,
) -> tuple[PlanningService, FakeWorkspace, FakeCompiler, FakeAnalyzer, FakePlanningStore]:
    workspace = FakeWorkspace(role=role)
    compiler = FakeCompiler(
        RspdlEditOutcome(
            runtime=RUNTIME,
            supported=supported,
            response=response,
            unsupported_reason=None if supported else "structured editing unavailable",
        )
    )
    analyzer = FakeAnalyzer(diagnostics)
    store = FakePlanningStore()
    service = PlanningService(
        workspace=cast(WorkspaceService, workspace),
        store=cast(PlanningRepositoryPort, store),
        analyzer=cast(AnalyzeWorkspace, analyzer),
        compiler=cast(RspdlCompilerPort, compiler),
    )
    return service, workspace, compiler, analyzer, store


async def _propose(service: PlanningService, workspace: FakeWorkspace) -> Mapping[str, Any]:
    return await service.propose_edit(
        actor_id=ACTOR_ID,
        project_id=PROJECT_ID,
        document_id=DOCUMENT_ID,
        base_project_revision=workspace.project.revision,
        base_source_hash=workspace.project.source_hash,
        expected_source_hash=source_fingerprint(workspace.document.text),
        edit={
            "operation": "update",
            "screen_id": "booking.checkout",
            "element_id": "title",
            "patch": {"text": "결제"},
        },
        summary="제목 변경",
    )


async def test_viewer_cannot_propose_compiler_edit() -> None:
    service, workspace, compiler, _, store = _service(
        role=ProjectRole.VIEWER, response=_compiler_response(status="applied")
    )

    with pytest.raises(AccessDenied):
        await _propose(service, workspace)

    assert compiler.edit_calls == []
    assert store.created == []


async def test_stale_document_hash_is_rejected_before_compiler_call() -> None:
    service, workspace, compiler, _, store = _service(response=_compiler_response(status="applied"))

    with pytest.raises(Conflict):
        await service.propose_edit(
            actor_id=ACTOR_ID,
            project_id=PROJECT_ID,
            document_id=DOCUMENT_ID,
            base_project_revision=workspace.project.revision,
            base_source_hash=workspace.project.source_hash,
            expected_source_hash="0" * 64,
            edit={"operation": "delete", "screen_id": "x", "element_id": "y"},
            summary=None,
        )

    assert compiler.edit_calls == []
    assert store.created == []


async def test_compiler_rejection_is_returned_without_creating_draft() -> None:
    response = _compiler_response(status="rejected")
    service, workspace, _, analyzer, store = _service(response=response)

    result = await _propose(service, workspace)

    assert result["compiler_response"] is response
    assert result["draft"] is None
    assert analyzer.calls == []
    assert store.created == []


async def test_error_bearing_candidate_creates_draft_without_saving_document() -> None:
    response = _compiler_response(status="applied")
    full_project_error = [{"severity": "error", "code": "RSPDL-FULL", "message": "error"}]
    service, workspace, _, analyzer, store = _service(
        response=response, diagnostics=full_project_error
    )

    result = await _propose(service, workspace)

    assert result["compiler_response"] is response
    assert result["draft"] is not None
    assert store.created[0]["candidate_documents"][0]["text"] == CANDIDATE
    assert store.created[0]["result"]["files"][0]["diagnostics"] == full_project_error
    assert len(analyzer.calls) == 2  # 확정 기준과 후보 프로젝트 전체
    assert workspace.document.text == SOURCE


async def test_unsupported_runtime_is_explicit_and_does_not_guess_edit() -> None:
    service, workspace, compiler, analyzer, store = _service(supported=False, response=None)

    result = await _propose(service, workspace)

    assert result["supported"] is False
    assert result["unsupported_reason"] == "structured editing unavailable"
    assert result["compiler_response"] is None
    assert result["draft"] is None
    assert len(compiler.edit_calls) == 1
    assert analyzer.calls == []
    assert store.created == []


async def test_pinned_rspdl_without_edit_api_reports_unsupported() -> None:
    compiler = LocalRspdlCompiler()

    result = await compiler.edit(
        RspdlSource(path="booking.rspdl", text=SOURCE),
        expected_source_hash=source_fingerprint(SOURCE),
        edit={"operation": "delete", "screen_id": "x", "element_id": "y"},
    )

    assert result.supported is False
    assert result.response is None
    assert "does not provide structured editing" in cast(str, result.unsupported_reason)


async def test_malformed_native_edit_request_is_a_client_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_request(request: Mapping[str, Any]) -> dict[str, Any]:
        raise RuntimeError("RSPDL-SDK-001: invalid request: unknown field")

    monkeypatch.setattr(local_adapter.rspdl, "edit", reject_request, raising=False)  # type: ignore[attr-defined]
    monkeypatch.setattr(local_adapter.rspdl, "EDIT_SCHEMA_VERSION", 1, raising=False)  # type: ignore[attr-defined]
    compiler = LocalRspdlCompiler()

    with pytest.raises(InvalidRspdlEditRequest, match="unknown field"):
        await compiler.edit(
            RspdlSource(path="booking.rspdl", text=SOURCE),
            expected_source_hash=source_fingerprint(SOURCE),
            edit={"operation": "unknown"},
        )


async def test_native_internal_edit_failure_remains_a_server_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_response(request: Mapping[str, Any]) -> dict[str, Any]:
        raise RuntimeError("RSPDL-SDK-005: failed to serialize SDK response")

    monkeypatch.setattr(local_adapter.rspdl, "edit", fail_response, raising=False)  # type: ignore[attr-defined]
    monkeypatch.setattr(local_adapter.rspdl, "EDIT_SCHEMA_VERSION", 1, raising=False)  # type: ignore[attr-defined]
    compiler = LocalRspdlCompiler()

    with pytest.raises(RuntimeError, match="RSPDL-SDK-005"):
        await compiler.edit(
            RspdlSource(path="booking.rspdl", text=SOURCE),
            expected_source_hash=source_fingerprint(SOURCE),
            edit={"operation": "delete", "screen_id": "x", "element_id": "y"},
        )


async def test_native_path_edit_serialization_preserves_exact_edge_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[Mapping[str, Any]] = []
    compiler = LocalRspdlCompiler()

    def record_request(request: Mapping[str, Any]) -> dict[str, Any]:
        requests.append(request)
        source = cast(Mapping[str, str], request["source"])
        return {
            "schema_version": request["schema_version"],
            "wire_schema_version": compiler.runtime.wire_schema_version,
            "rspdl_version": compiler.runtime.rspdl_version,
            "locale": compiler.runtime.locale,
            "source_hash": source_fingerprint(source["text"]),
            "outcome": {"status": "rejected"},
            "tombstones": [],
            "id_remap": {},
        }

    monkeypatch.setattr(local_adapter.rspdl, "edit", record_request, raising=False)  # type: ignore[attr-defined]
    monkeypatch.setattr(local_adapter.rspdl, "EDIT_SCHEMA_VERSION", 1, raising=False)  # type: ignore[attr-defined]
    common = {
        "operation": "disconnect",
        "source_screen_id": "booking.search",
        "source_element_id": "lookup",
        "target_screen_id": "booking.result",
        "handler": None,
        "label": None,
    }
    found = {**common, "outcome_id": "booking.lookup.found"}
    missing = {**common, "outcome_id": "booking.lookup.missing"}
    same_screen = {
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
    }
    clear_conflict = {
        "operation": "update",
        "screen_id": "booking.search",
        "element_id": "lookup",
        "patch": {
            "text": None,
            "field_id": None,
            "model_id": None,
            "field_ids": None,
            "name": None,
            "action_id": "booking.lookup",
            "clear_action": True,
        },
    }
    for edit in (found, missing, same_screen, clear_conflict):
        await compiler.edit(
            RspdlSource(path="booking.rspdl", text=SOURCE),
            expected_source_hash=source_fingerprint(SOURCE),
            edit=edit,
        )

    assert [request["edit"] for request in requests] == [
        found,
        missing,
        same_screen,
        clear_conflict,
    ]
    assert requests[0]["edit"] != requests[1]["edit"]


def test_source_fingerprint_uses_exact_utf8_bytes() -> None:
    assert source_fingerprint("가\n") == (
        "bd11c1e19b82e8495d553c142a6ba622cf4484df0781ed5ce6400fb67cd92d4d"
    )
    assert source_fingerprint("가\r\n") != source_fingerprint("가\n")
