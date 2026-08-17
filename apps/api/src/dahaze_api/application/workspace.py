"""프로젝트와 문서 유스케이스.

**접근 검사는 전부 여기를 지난다.** 라우터가 직접 저장소를 부르지 않으므로, 권한 확인을
빠뜨린 경로가 생기지 않는다. 모든 검사는 `_require_membership` 하나로 모인다.
"""

from __future__ import annotations

import re
from uuid import UUID

from dahaze_api.application.errors import AccessDenied, Conflict, NotFound
from dahaze_api.domain.entities import (
    Document,
    DocumentRevision,
    Project,
    ProjectMembership,
    ProjectRole,
)
from dahaze_api.domain.ports import (
    DocumentRepositoryPort,
    ProjectRepositoryPort,
    RspdlCompilerPort,
)

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# RSPDL 소스 파일만 다룬다. 확장자를 강제해 두면 나중에 다른 종류의 파일을 넣을 때
# 의도적으로 결정하게 된다.
#
# 경로 조각을 명시적으로 나열한다. `[\w./-]+` 처럼 문자 클래스로 뭉뚱그리면 `..` 과
# 선행 `/` 가 통과해 상위 경로를 가리키는 문자열이 저장된다. 지금은 경로를 파일시스템에
# 쓰지 않지만, 나중에 export 나 git 연동이 생기면 그대로 traversal 이 된다.
DOCUMENT_PATH_PATTERN = re.compile(r"^[\w-]+(?:/[\w-]+)*\.rspdl$")


class WorkspaceService:
    def __init__(
        self,
        *,
        projects: ProjectRepositoryPort,
        documents: DocumentRepositoryPort,
        compiler: RspdlCompilerPort,
    ) -> None:
        self._projects = projects
        self._documents = documents
        self._compiler = compiler

    # ------------------------------------------------------------------ 프로젝트

    async def create_project(
        self,
        *,
        actor_id: UUID,
        slug: str,
        name: str,
        description: str | None = None,
        default_rspdl_version: str | None = None,
    ) -> Project:
        if not SLUG_PATTERN.match(slug):
            raise Conflict(f"slug 형식이 올바르지 않다: {slug!r} (소문자·숫자·하이픈)")
        if await self._projects.get_by_slug(slug) is not None:
            raise Conflict(f"이미 사용 중인 slug: {slug!r}")

        return await self._projects.create(
            owner_id=actor_id,
            slug=slug,
            name=name,
            description=description,
            # 지정하지 않으면 이 서버가 돌리는 컴파일러 버전을 기본으로 삼는다.
            default_rspdl_version=(
                default_rspdl_version or self._compiler.runtime.rspdl_version
            ),
        )

    async def list_projects(
        self, *, actor_id: UUID, include_archived: bool = False
    ) -> list[Project]:
        """이 사용자가 멤버인 프로젝트만. 한 사용자가 여러 프로젝트를 가질 수 있다."""
        return await self._projects.list_for_user(
            actor_id, include_archived=include_archived
        )

    async def get_project(self, *, actor_id: UUID, project_id: UUID) -> Project:
        await self._require_membership(actor_id=actor_id, project_id=project_id)
        project = await self._projects.get(project_id)
        if project is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        return project

    async def archive_project(self, *, actor_id: UUID, project_id: UUID) -> Project:
        membership = await self._require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_manage_members:
            raise AccessDenied("프로젝트 보관은 소유자만 할 수 있다")
        project = await self._projects.archive(project_id)
        if project is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        return project

    async def list_members(
        self, *, actor_id: UUID, project_id: UUID
    ) -> list[ProjectMembership]:
        await self._require_membership(actor_id=actor_id, project_id=project_id)
        return await self._projects.list_members(project_id)

    async def add_member(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        user_id: UUID,
        role: ProjectRole,
    ) -> ProjectMembership:
        membership = await self._require_membership(
            actor_id=actor_id, project_id=project_id
        )
        if not membership.role.can_manage_members:
            raise AccessDenied("멤버 관리는 소유자만 할 수 있다")
        if await self._projects.membership_of(project_id=project_id, user_id=user_id):
            raise Conflict("이미 이 프로젝트의 멤버다")
        return await self._projects.add_member(
            project_id=project_id, user_id=user_id, role=role
        )

    # -------------------------------------------------------------------- 문서

    async def create_document(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        path: str,
        title: str,
        text: str,
    ) -> Document:
        membership = await self._require_membership(
            actor_id=actor_id, project_id=project_id
        )
        self._require_write(membership)

        if not DOCUMENT_PATH_PATTERN.match(path):
            raise Conflict(f"문서 경로가 올바르지 않다: {path!r} (.rspdl 로 끝나야 한다)")

        project = await self._projects.get(project_id)
        if project is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        if project.is_archived:
            raise Conflict("보관된 프로젝트에는 문서를 추가할 수 없다")

        for existing in await self._documents.list_for_project(project_id):
            if existing.path == path:
                raise Conflict(f"이미 존재하는 경로: {path!r}")

        return await self._documents.create(
            project_id=project_id,
            path=path,
            title=title,
            text=text,
            # 프로젝트의 기본 버전을 문서에 못박는다. 프로젝트 기본값이 나중에 바뀌어도
            # 이 문서가 어느 문법으로 쓰였는지는 그대로 남는다 (ADR-0002).
            target_rspdl_version=project.default_rspdl_version,
            author_id=actor_id,
        )

    async def list_documents(self, *, actor_id: UUID, project_id: UUID) -> list[Document]:
        await self._require_membership(actor_id=actor_id, project_id=project_id)
        return await self._documents.list_for_project(project_id)

    async def get_document(self, *, actor_id: UUID, document_id: UUID) -> Document:
        document = await self._documents.get(document_id)
        if document is None:
            raise NotFound("문서를 찾을 수 없다")
        await self._require_membership(
            actor_id=actor_id, project_id=document.project_id
        )
        return document

    async def update_document(
        self,
        *,
        actor_id: UUID,
        document_id: UUID,
        text: str,
        summary: str | None = None,
    ) -> Document:
        document = await self.get_document(actor_id=actor_id, document_id=document_id)
        membership = await self._require_membership(
            actor_id=actor_id, project_id=document.project_id
        )
        self._require_write(membership)

        updated = await self._documents.update_text(
            document_id=document_id, text=text, author_id=actor_id, summary=summary
        )
        if updated is None:
            raise NotFound("문서를 찾을 수 없다")
        return updated

    async def delete_document(self, *, actor_id: UUID, document_id: UUID) -> None:
        document = await self.get_document(actor_id=actor_id, document_id=document_id)
        membership = await self._require_membership(
            actor_id=actor_id, project_id=document.project_id
        )
        self._require_write(membership)
        await self._documents.soft_delete(document_id)

    async def list_revisions(
        self, *, actor_id: UUID, document_id: UUID
    ) -> list[DocumentRevision]:
        await self.get_document(actor_id=actor_id, document_id=document_id)
        return await self._documents.list_revisions(document_id)

    # ------------------------------------------------------------------- 내부

    async def _require_membership(
        self, *, actor_id: UUID, project_id: UUID
    ) -> ProjectMembership:
        """접근 검사의 유일한 진입점.

        멤버가 아니면 `AccessDenied` 가 아니라 `NotFound` 를 낸다. 남의 프로젝트가
        존재한다는 사실 자체를 노출하지 않기 위해서다.
        """
        membership = await self._projects.membership_of(
            project_id=project_id, user_id=actor_id
        )
        if membership is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        return membership

    @staticmethod
    def _require_write(membership: ProjectMembership) -> None:
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
