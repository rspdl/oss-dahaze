"""프로젝트와 문서 엔드포인트.

라우터는 저장소를 직접 부르지 않는다. 접근 검사가 `WorkspaceService` 한 곳에 모여 있고,
여기서는 유스케이스 오류를 HTTP 상태로 옮기기만 한다.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.domain.entities import (
    Document,
    DocumentRevision,
    Project,
    ProjectMembership,
    ProjectRole,
)
from dahaze_api.interface.rest.dependencies import CurrentUser, Workspace
from dahaze_api.interface.rest.schemas import (
    AddMemberRequest,
    CreateDocumentRequest,
    CreateProjectRequest,
    DocumentResponse,
    DocumentRevisionResponse,
    DocumentSummaryResponse,
    ProjectMemberResponse,
    ProjectResponse,
    UpdateDocumentRequest,
)

router = APIRouter(prefix="/api", tags=["workspace"])


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


def _document(document: Document) -> DocumentResponse:
    return DocumentResponse(
        id=document.id,
        project_id=document.project_id,
        path=document.path,
        title=document.title,
        text=document.text,
        target_rspdl_version=document.target_rspdl_version,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def _summary(document: Document) -> DocumentSummaryResponse:
    return DocumentSummaryResponse(
        id=document.id,
        project_id=document.project_id,
        path=document.path,
        title=document.title,
        target_rspdl_version=document.target_rspdl_version,
        updated_at=document.updated_at,
    )


def _revision(revision: DocumentRevision) -> DocumentRevisionResponse:
    return DocumentRevisionResponse(
        id=revision.id,
        document_id=revision.document_id,
        revision_no=revision.revision_no,
        target_rspdl_version=revision.target_rspdl_version,
        author_id=revision.author_id,
        summary=revision.summary,
        created_at=revision.created_at,
    )


# ------------------------------------------------------------------ 프로젝트


@router.get("/projects", name="list_projects")
async def list_projects(
    user: CurrentUser,
    workspace: Workspace,
    include_archived: bool = Query(default=False),
) -> list[ProjectResponse]:
    """내가 멤버인 프로젝트 목록. 한 사용자가 여러 프로젝트를 가질 수 있다."""
    projects = await workspace.list_projects(
        actor_id=user.id, include_archived=include_archived
    )
    return [_project(p) for p in projects]


@router.post("/projects", name="create_project", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: CreateProjectRequest, user: CurrentUser, workspace: Workspace
) -> ProjectResponse:
    try:
        project = await workspace.create_project(
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
async def get_project(
    project_id: UUID, user: CurrentUser, workspace: Workspace
) -> ProjectResponse:
    try:
        project = await workspace.get_project(actor_id=user.id, project_id=project_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return _project(project)


@router.post("/projects/{project_id}/archive", name="archive_project")
async def archive_project(
    project_id: UUID, user: CurrentUser, workspace: Workspace
) -> ProjectResponse:
    try:
        project = await workspace.archive_project(
            actor_id=user.id, project_id=project_id
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return _project(project)


@router.get("/projects/{project_id}/members", name="list_project_members")
async def list_project_members(
    project_id: UUID, user: CurrentUser, workspace: Workspace
) -> list[ProjectMemberResponse]:
    try:
        members = await workspace.list_members(actor_id=user.id, project_id=project_id)
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
    workspace: Workspace,
) -> ProjectMemberResponse:
    try:
        role = ProjectRole(body.role)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"알 수 없는 역할: {body.role}"
        ) from exc

    try:
        membership = await workspace.add_member(
            actor_id=user.id, project_id=project_id, user_id=body.user_id, role=role
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return _member(membership)


# ---------------------------------------------------------------------- 문서


@router.get("/projects/{project_id}/documents", name="list_documents")
async def list_documents(
    project_id: UUID, user: CurrentUser, workspace: Workspace
) -> list[DocumentSummaryResponse]:
    try:
        documents = await workspace.list_documents(
            actor_id=user.id, project_id=project_id
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return [_summary(d) for d in documents]


@router.post(
    "/projects/{project_id}/documents",
    name="create_document",
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    project_id: UUID,
    body: CreateDocumentRequest,
    user: CurrentUser,
    workspace: Workspace,
) -> DocumentResponse:
    try:
        document = await workspace.create_document(
            actor_id=user.id,
            project_id=project_id,
            path=body.path,
            title=body.title,
            text=body.text,
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return _document(document)


@router.get("/documents/{document_id}", name="get_document")
async def get_document(
    document_id: UUID, user: CurrentUser, workspace: Workspace
) -> DocumentResponse:
    try:
        document = await workspace.get_document(
            actor_id=user.id, document_id=document_id
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return _document(document)


@router.put("/documents/{document_id}", name="update_document")
async def update_document(
    document_id: UUID,
    body: UpdateDocumentRequest,
    user: CurrentUser,
    workspace: Workspace,
) -> DocumentResponse:
    """본문을 바꾼다. 내용이 실제로 달라졌을 때만 리비전이 남는다."""
    try:
        document = await workspace.update_document(
            actor_id=user.id,
            document_id=document_id,
            text=body.text,
            summary=body.summary,
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return _document(document)


@router.delete(
    "/documents/{document_id}",
    name="delete_document",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document(
    document_id: UUID, user: CurrentUser, workspace: Workspace
) -> None:
    try:
        await workspace.delete_document(actor_id=user.id, document_id=document_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc


@router.get("/documents/{document_id}/revisions", name="list_document_revisions")
async def list_document_revisions(
    document_id: UUID, user: CurrentUser, workspace: Workspace
) -> list[DocumentRevisionResponse]:
    """편집 이력. 본문은 싣지 않는다 — 개별 리비전 본문은 별도 조회 대상이다."""
    try:
        revisions = await workspace.list_revisions(
            actor_id=user.id, document_id=document_id
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return [_revision(r) for r in revisions]
