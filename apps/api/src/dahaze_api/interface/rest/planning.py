from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.interface.rest.dependencies import CurrentUser, Planning
from dahaze_api.interface.rest.schemas import (
    ApplyPlanningDraftRequest,
    ApplyPlanningDraftResponse,
    CaptureProjectSnapshotRequest,
    CreatePlanningDraftRequest,
    PlanningDraftResponse,
    PlanningStateResponse,
    ProjectSnapshotResponse,
    RestoreProjectSnapshotRequest,
    UpdatePlanningStateRequest,
)

router = APIRouter(prefix="/api", tags=["planning"])


def _raise(exc: Exception) -> NoReturn:
    code = (
        status.HTTP_404_NOT_FOUND
        if isinstance(exc, NotFound)
        else (
            status.HTTP_403_FORBIDDEN if isinstance(exc, AccessDenied) else status.HTTP_409_CONFLICT
        )
    )
    raise HTTPException(code, str(exc)) from exc


@router.get("/projects/{project_id}/planning", name="get_planning_state")
async def get_planning_state(
    project_id: UUID, user: CurrentUser, planning: Planning
) -> PlanningStateResponse:
    try:
        return PlanningStateResponse.model_validate(
            await planning.state(actor_id=user.id, project_id=project_id)
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.put("/projects/{project_id}/planning", name="update_planning_state")
async def update_planning_state(
    project_id: UUID, body: UpdatePlanningStateRequest, user: CurrentUser, planning: Planning
) -> PlanningStateResponse:
    try:
        return PlanningStateResponse.model_validate(
            await planning.update_state(
                actor_id=user.id,
                project_id=project_id,
                expected_revision=body.expected_revision,
                messages=body.messages,
                decisions=body.decisions,
                proposals=body.proposals,
                metadata=body.metadata.model_dump(),
            )
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.post(
    "/projects/{project_id}/planning/drafts",
    name="create_planning_draft",
    status_code=status.HTTP_201_CREATED,
)
async def create_planning_draft(
    project_id: UUID, body: CreatePlanningDraftRequest, user: CurrentUser, planning: Planning
) -> PlanningDraftResponse:
    try:
        value = await planning.create_draft(
            actor_id=user.id,
            project_id=project_id,
            base_project_revision=body.base_project_revision,
            base_source_hash=body.base_source_hash,
            changes=[x.model_dump() for x in body.changes],
            summary=body.summary,
        )
        return PlanningDraftResponse.model_validate(value)
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.get("/projects/{project_id}/planning/drafts", name="list_planning_drafts")
async def list_planning_drafts(
    project_id: UUID, user: CurrentUser, planning: Planning
) -> list[PlanningDraftResponse]:
    try:
        return [
            PlanningDraftResponse.model_validate(x)
            for x in await planning.drafts(actor_id=user.id, project_id=project_id)
        ]
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.get("/planning/drafts/{draft_id}", name="get_planning_draft")
async def get_planning_draft(
    draft_id: UUID, user: CurrentUser, planning: Planning
) -> PlanningDraftResponse:
    try:
        return PlanningDraftResponse.model_validate(
            await planning.draft(actor_id=user.id, draft_id=draft_id)
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.post("/planning/drafts/{draft_id}/apply", name="apply_planning_draft")
async def apply_planning_draft(
    draft_id: UUID, body: ApplyPlanningDraftRequest, user: CurrentUser, planning: Planning
) -> ApplyPlanningDraftResponse:
    try:
        return ApplyPlanningDraftResponse.model_validate(
            await planning.apply(
                actor_id=user.id,
                draft_id=draft_id,
                expected_project_revision=body.expected_project_revision,
                expected_source_hash=body.expected_source_hash,
            )
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.get("/projects/{project_id}/planning/snapshots", name="list_project_snapshots")
async def list_project_snapshots(
    project_id: UUID, user: CurrentUser, planning: Planning
) -> list[ProjectSnapshotResponse]:
    try:
        return [
            ProjectSnapshotResponse.model_validate(x)
            for x in await planning.snapshots(actor_id=user.id, project_id=project_id)
        ]
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.post(
    "/projects/{project_id}/planning/snapshots",
    name="capture_project_snapshot",
    status_code=status.HTTP_201_CREATED,
)
async def capture_project_snapshot(
    project_id: UUID,
    body: CaptureProjectSnapshotRequest,
    user: CurrentUser,
    planning: Planning,
) -> ProjectSnapshotResponse:
    try:
        return ProjectSnapshotResponse.model_validate(
            await planning.capture(
                actor_id=user.id,
                project_id=project_id,
                expected_project_revision=body.expected_project_revision,
                expected_source_hash=body.expected_source_hash,
                expected_planning_revision=body.expected_planning_revision,
                summary=body.summary,
            )
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.post(
    "/projects/{project_id}/planning/snapshots/{revision}/restore", name="restore_project_snapshot"
)
async def restore_project_snapshot(
    project_id: UUID,
    revision: int,
    body: RestoreProjectSnapshotRequest,
    user: CurrentUser,
    planning: Planning,
) -> ProjectSnapshotResponse:
    try:
        return ProjectSnapshotResponse.model_validate(
            await planning.restore(
                actor_id=user.id,
                project_id=project_id,
                revision=revision,
                expected_project_revision=body.expected_project_revision,
                expected_source_hash=body.expected_source_hash,
                expected_planning_revision=body.expected_planning_revision,
            )
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)


@router.get("/projects/{project_id}/planning/handoff", name="get_project_handoff")
async def get_project_handoff(
    project_id: UUID, user: CurrentUser, planning: Planning, revision: int = Query(ge=0)
) -> ProjectSnapshotResponse:
    try:
        return ProjectSnapshotResponse.model_validate(
            await planning.handoff(actor_id=user.id, project_id=project_id, revision=revision)
        )
    except (NotFound, AccessDenied, Conflict) as exc:
        _raise(exc)
