"""저장소 port 의 SQLAlchemy 구현체.

ORM row 를 도메인 엔티티로 바꾸는 유일한 지점이다. 위 계층은 `*Row` 타입을 보지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.entities import (
    ExternalIdentity,
    PasswordCredential,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
)
from dahaze_api.infrastructure.db.models import (
    PasswordCredentialRow,
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


def _to_password_credential(row: PasswordCredentialRow) -> PasswordCredential:
    return PasswordCredential(user_id=row.user_id, login=row.login, password_hash=row.password_hash)


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

    async def create(self, *, display_name: str, email: str | None) -> User:
        user = UserRow(id=uuid4(), display_name=display_name, email=email, avatar_url=None)
        self._session.add(user)
        await self._session.flush()
        return _to_user(user)


class SqlPasswordCredentialRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def find_by_login(self, login: str) -> PasswordCredential | None:
        stmt = select(PasswordCredentialRow).where(PasswordCredentialRow.login == login)
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_password_credential(row) if row else None

    async def create(
        self, *, user_id: UUID, login: str, password_hash: str
    ) -> PasswordCredential | None:
        """아이디가 이미 있으면 `None`.

        `ON CONFLICT DO NOTHING` 으로 미리 확인과 삽입 사이의 경쟁을 DB 에게 맡긴다.
        먼저 `SELECT` 로 확인하고 `INSERT` 하는 방식은 동시에 같은 아이디로 가입하는 두
        요청 중 하나가 유니크 제약 위반으로 500 이 된다.
        """
        stmt = (
            insert(PasswordCredentialRow)
            .values(id=uuid4(), user_id=user_id, login=login, password_hash=password_hash)
            .on_conflict_do_nothing()
            .returning(PasswordCredentialRow)
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_password_credential(row) if row else None


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

    async def membership_of(self, *, project_id: UUID, user_id: UUID) -> ProjectMembership | None:
        stmt = select(ProjectMemberRow).where(
            ProjectMemberRow.project_id == project_id,
            ProjectMemberRow.user_id == user_id,
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _to_membership(row) if row else None

    async def add_member(
        self, *, project_id: UUID, user_id: UUID, role: ProjectRole
    ) -> ProjectMembership:
        row = ProjectMemberRow(id=uuid4(), project_id=project_id, user_id=user_id, role=role.value)
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
