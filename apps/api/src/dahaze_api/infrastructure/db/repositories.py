"""저장소 port 의 SQLAlchemy 구현체.

ORM row 를 도메인 엔티티로 바꾸는 유일한 지점이다. 위 계층은 `*Row` 타입을 보지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.entities import (
    Document,
    DocumentRevision,
    ExternalIdentity,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
)
from dahaze_api.infrastructure.db.models import (
    DocumentRevisionRow,
    DocumentRow,
    ProjectMemberRow,
    ProjectRow,
    UserIdentityRow,
    UserRow,
)


def _to_user(row: UserRow) -> User:
    return User(
        id=row.id,
        display_name=row.display_name,
        email=row.email,
        avatar_url=row.avatar_url,
        created_at=row.created_at,
    )


def _to_project(row: ProjectRow) -> Project:
    return Project(
        id=row.id,
        slug=row.slug,
        name=row.name,
        description=row.description,
        default_rspdl_version=row.default_rspdl_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


def _to_membership(row: ProjectMemberRow) -> ProjectMembership:
    return ProjectMembership(
        project_id=row.project_id,
        user_id=row.user_id,
        role=ProjectRole(row.role),
    )


def _to_document(row: DocumentRow) -> Document:
    return Document(
        id=row.id,
        project_id=row.project_id,
        path=row.path,
        title=row.title,
        text=row.text,
        target_rspdl_version=row.target_rspdl_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


def _to_revision(row: DocumentRevisionRow) -> DocumentRevision:
    return DocumentRevision(
        id=row.id,
        document_id=row.document_id,
        revision_no=row.revision_no,
        text=row.text,
        target_rspdl_version=row.target_rspdl_version,
        author_id=row.author_id,
        summary=row.summary,
        created_at=row.created_at,
    )


class SqlUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: UUID) -> User | None:
        row = await self._session.get(UserRow, user_id)
        return _to_user(row) if row else None

    async def find_by_identity(self, *, provider: str, provider_user_id: str) -> User | None:
        stmt = (
            select(UserRow)
            .join(UserIdentityRow)
            .where(
                UserIdentityRow.provider == provider,
                UserIdentityRow.provider_user_id == provider_user_id,
            )
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_user(row) if row else None

    async def create_from_identity(self, identity: ExternalIdentity) -> User:
        user = UserRow(
            id=uuid4(),
            display_name=identity.login,
            email=identity.email,
            avatar_url=identity.avatar_url,
        )
        user.identities.append(
            UserIdentityRow(
                id=uuid4(),
                provider=identity.provider,
                provider_user_id=identity.provider_user_id,
                login=identity.login,
            )
        )
        self._session.add(user)
        await self._session.flush()
        return _to_user(user)


class SqlProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        *,
        owner_id: UUID,
        slug: str,
        name: str,
        description: str | None,
        default_rspdl_version: str,
    ) -> Project:
        project = ProjectRow(
            id=uuid4(),
            slug=slug,
            name=name,
            description=description,
            default_rspdl_version=default_rspdl_version,
        )
        # 소유자도 멤버로 넣는다. 접근 검사 경로를 하나로 유지하기 위해서다.
        project.members.append(
            ProjectMemberRow(id=uuid4(), user_id=owner_id, role=ProjectRole.OWNER.value)
        )
        self._session.add(project)
        await self._session.flush()
        return _to_project(project)

    async def get(self, project_id: UUID) -> Project | None:
        row = await self._session.get(ProjectRow, project_id)
        return _to_project(row) if row else None

    async def get_by_slug(self, slug: str) -> Project | None:
        stmt = select(ProjectRow).where(ProjectRow.slug == slug)
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_project(row) if row else None

    async def list_for_user(
        self, user_id: UUID, *, include_archived: bool = False
    ) -> list[Project]:
        stmt = (
            select(ProjectRow)
            .join(ProjectMemberRow)
            .where(ProjectMemberRow.user_id == user_id)
            .order_by(ProjectRow.updated_at.desc())
        )
        if not include_archived:
            stmt = stmt.where(ProjectRow.archived_at.is_(None))
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_to_project(r) for r in rows]

    async def membership_of(
        self, *, project_id: UUID, user_id: UUID
    ) -> ProjectMembership | None:
        stmt = select(ProjectMemberRow).where(
            ProjectMemberRow.project_id == project_id,
            ProjectMemberRow.user_id == user_id,
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_membership(row) if row else None

    async def add_member(
        self, *, project_id: UUID, user_id: UUID, role: ProjectRole
    ) -> ProjectMembership:
        row = ProjectMemberRow(
            id=uuid4(), project_id=project_id, user_id=user_id, role=role.value
        )
        self._session.add(row)
        await self._session.flush()
        return _to_membership(row)

    async def list_members(self, project_id: UUID) -> list[ProjectMembership]:
        stmt = select(ProjectMemberRow).where(ProjectMemberRow.project_id == project_id)
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_to_membership(r) for r in rows]

    async def archive(self, project_id: UUID) -> Project | None:
        row = await self._session.get(ProjectRow, project_id)
        if row is None:
            return None
        row.archived_at = datetime.now(UTC)
        await self._session.flush()
        # `updated_at` 은 서버가 onupdate 로 계산하므로 flush 직후에는 만료 상태다. refresh
        # 없이 읽으면 SQLAlchemy 가 동기 lazy 조회를 걸고, async 컨텍스트에서 그것은
        # MissingGreenlet 으로 터진다 — `update_text` 가 refresh 하는 이유와 같다.
        await self._session.refresh(row)
        return _to_project(row)


class SqlDocumentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        *,
        project_id: UUID,
        path: str,
        title: str,
        text: str,
        target_rspdl_version: str,
        author_id: UUID | None,
    ) -> Document:
        document = DocumentRow(
            id=uuid4(),
            project_id=project_id,
            path=path,
            title=title,
            text=text,
            target_rspdl_version=target_rspdl_version,
        )
        # 최초 본문도 리비전 1로 남긴다. 이력의 시작점이 비어 있으면
        # "언제부터 이 텍스트였는지" 를 답할 수 없다.
        document.revisions.append(
            DocumentRevisionRow(
                id=uuid4(),
                revision_no=1,
                text=text,
                target_rspdl_version=target_rspdl_version,
                author_id=author_id,
                summary="문서 생성",
            )
        )
        self._session.add(document)
        await self._session.flush()
        return _to_document(document)

    async def get(self, document_id: UUID) -> Document | None:
        row = await self._session.get(DocumentRow, document_id)
        if row is None or row.deleted_at is not None:
            return None
        return _to_document(row)

    async def list_for_project(self, project_id: UUID) -> list[Document]:
        stmt = (
            select(DocumentRow)
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.deleted_at.is_(None),
            )
            .order_by(DocumentRow.path)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_to_document(r) for r in rows]

    async def update_text(
        self,
        *,
        document_id: UUID,
        text: str,
        author_id: UUID | None,
        summary: str | None,
    ) -> Document | None:
        row = await self._session.get(DocumentRow, document_id)
        if row is None or row.deleted_at is not None:
            return None

        # 내용이 같으면 리비전을 만들지 않는다. 에디터가 자동 저장을 자주 보내므로,
        # 이걸 거르지 않으면 이력이 의미 없는 항목으로 가득 찬다.
        if row.text == text:
            return _to_document(row)

        next_no = await self._next_revision_no(document_id)
        row.text = text
        self._session.add(
            DocumentRevisionRow(
                id=uuid4(),
                document_id=document_id,
                revision_no=next_no,
                text=text,
                target_rspdl_version=row.target_rspdl_version,
                author_id=author_id,
                summary=summary,
            )
        )
        await self._session.flush()
        await self._session.refresh(row)
        return _to_document(row)

    async def soft_delete(self, document_id: UUID) -> bool:
        # 벌크 UPDATE 를 쓰지 않는다. 같은 세션에 이미 로드된 객체가 있으면 in-memory
        # 상태가 어긋나고, 뒤이은 속성 접근이 동기 lazy IO 를 일으켜 async 컨텍스트에서
        # MissingGreenlet 으로 터진다. ORM 객체를 직접 고치면 identity map 이 일관된다.
        row = await self._session.get(DocumentRow, document_id)
        if row is None or row.deleted_at is not None:
            return False
        row.deleted_at = datetime.now(UTC)
        await self._session.flush()
        return True

    async def list_revisions(self, document_id: UUID) -> list[DocumentRevision]:
        stmt = (
            select(DocumentRevisionRow)
            .where(DocumentRevisionRow.document_id == document_id)
            .order_by(DocumentRevisionRow.revision_no.desc())
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_to_revision(r) for r in rows]

    async def _next_revision_no(self, document_id: UUID) -> int:
        stmt = select(func.max(DocumentRevisionRow.revision_no)).where(
            DocumentRevisionRow.document_id == document_id
        )
        current = (await self._session.execute(stmt)).scalar_one_or_none()
        return (current or 0) + 1
