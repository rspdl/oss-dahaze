"""프로젝트와 멤버 엔드포인트.

라우터는 저장소를 직접 부르지 않는다. 접근 검사가 `ProjectService` 한 곳에 모여 있고,
여기서는 유스케이스 오류를 HTTP 상태로 옮기기만 한다.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.domain.entities import Project, ProjectMembership, ProjectRole
from dahaze_api.interface.rest.dependencies import CurrentUser, Projects
from dahaze_api.interface.rest.schemas import (
    AddMemberRequest,
    CreateProjectRequest,
    ProjectMemberResponse,
    ProjectResponse,
)

router = APIRouter(prefix="/api", tags=["projects"])


def _project(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        slug=project.slug,
        name=project.name,
        description=project.description,
        default_rspdl_version=project.default_rspdl_version,
        created_at=project.created_at,
        updated_at=project.updated_at,
        archived_at=project.archived_at,
    )


def _member(membership: ProjectMembership) -> ProjectMemberResponse:
    return ProjectMemberResponse(
        project_id=membership.project_id,
        user_id=membership.user_id,
        role=str(membership.role),
    )


# ------------------------------------------------------------------ 프로젝트


@router.get("/projects", name="list_projects")
async def list_projects(
    user: CurrentUser,
    service: Projects,
    include_archived: bool = Query(default=False),
) -> list[ProjectResponse]:
    """내가 멤버인 프로젝트 목록. 한 사용자가 여러 프로젝트를 가질 수 있다."""
    projects = await service.list_projects(actor_id=user.id, include_archived=include_archived)
    return [_project(p) for p in projects]


@router.post("/projects", name="create_project", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: CreateProjectRequest, user: CurrentUser, service: Projects
) -> ProjectResponse:
    try:
        project = await service.create_project(
            actor_id=user.id,
            slug=body.slug,
            name=body.name,
            description=body.description,
            default_rspdl_version=body.default_rspdl_version,
        )
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return _project(project)


@router.get("/projects/{project_id}", name="get_project")
async def get_project(project_id: UUID, user: CurrentUser, service: Projects) -> ProjectResponse:
    try:
        project = await service.get_project(actor_id=user.id, project_id=project_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return _project(project)


@router.post("/projects/{project_id}/archive", name="archive_project")
async def archive_project(
    project_id: UUID, user: CurrentUser, service: Projects
) -> ProjectResponse:
    try:
        project = await service.archive_project(actor_id=user.id, project_id=project_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return _project(project)


@router.get("/projects/{project_id}/members", name="list_project_members")
async def list_project_members(
    project_id: UUID, user: CurrentUser, service: Projects
) -> list[ProjectMemberResponse]:
    try:
        members = await service.list_members(actor_id=user.id, project_id=project_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return [_member(m) for m in members]


@router.post(
    "/projects/{project_id}/members",
    name="add_project_member",
    status_code=status.HTTP_201_CREATED,
)
async def add_project_member(
    project_id: UUID,
    body: AddMemberRequest,
    user: CurrentUser,
    service: Projects,
) -> ProjectMemberResponse:
    try:
        role = ProjectRole(body.role)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"알 수 없는 역할: {body.role}"
        ) from exc

    try:
        membership = await service.add_member(
            actor_id=user.id, project_id=project_id, user_id=body.user_id, role=role
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return _member(membership)
