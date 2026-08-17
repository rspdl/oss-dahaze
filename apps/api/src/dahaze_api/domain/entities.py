"""도메인 엔티티.

재생성할 수 없는 것만 여기 있다 (ADR-0003). 사용자가 친 텍스트, 누가 언제 썼는지,
무엇이 무엇에 속하는지. 컴파일러가 산출한 것은 엔티티가 아니라 캐시다.

이 모듈은 ORM 도 프레임워크도 모른다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class ProjectRole(StrEnum):
    """프로젝트 안에서의 권한.

    소유자도 멤버로 표현한다. 접근 검사를 한 경로로 모으기 위해서다 —
    "소유자거나 멤버" 라는 분기가 모든 질의에 퍼지면 그중 하나는 반드시 빠뜨린다.
    """

    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"

    @property
    def can_write(self) -> bool:
        return self in (ProjectRole.OWNER, ProjectRole.EDITOR)

    @property
    def can_manage_members(self) -> bool:
        return self is ProjectRole.OWNER


@dataclass(frozen=True, slots=True)
class User:
    id: UUID
    display_name: str
    email: str | None
    avatar_url: str | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class UserIdentity:
    """외부 제공자가 확인해 준 신원 하나.

    `users` 와 분리한 이유: 한 사람이 GitHub 과 Google 로 각각 로그인해도 같은 계정이어야
    한다. 벤더를 추가할 때 `users` 를 건드리지 않는다.
    """

    id: UUID
    user_id: UUID
    provider: str
    provider_user_id: str
    login: str


@dataclass(frozen=True, slots=True)
class Project:
    id: UUID
    slug: str
    name: str
    description: str | None
    # 이 프로젝트의 새 문서가 기본으로 삼는 RSPDL 버전.
    default_rspdl_version: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None


@dataclass(frozen=True, slots=True)
class ProjectMembership:
    project_id: UUID
    user_id: UUID
    role: ProjectRole


@dataclass(frozen=True, slots=True)
class Document:
    """RSPDL 소스 문서 하나.

    `text` 가 진실이다. 컴파일 결과는 여기 없다 — 필요할 때 컴파일러에게 물어서 얻는다.
    """

    id: UUID
    project_id: UUID
    path: str
    title: str
    text: str
    # 이 텍스트가 어느 문법으로 쓰였는지. 텍스트만 보고는 복원할 수 없으므로
    # 기록하지 않으면 나중에 채워 넣을 방법이 없다 (ADR-0002).
    target_rspdl_version: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class DocumentRevision:
    """편집 이력 한 점. 전문을 보관한다.

    diff 가 아니라 전문을 두는 이유: 문법이 바뀌면 diff 를 되감아 복원한 텍스트가 어느
    버전의 문법인지 알 수 없게 된다. 저장 비용보다 해석 가능성이 중요하다.
    """

    id: UUID
    document_id: UUID
    revision_no: int
    text: str
    target_rspdl_version: str
    author_id: UUID | None
    summary: str | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ExternalIdentity:
    """OAuth 제공자가 확인해 준 신원.

    벤더마다 필드 이름이 다르므로 (GitHub `login`, Google `sub` 등) 어댑터가 여기로
    맞춰 넣는다. 위 계층은 어느 벤더에서 왔는지만 알면 된다.
    """

    provider: str
    provider_user_id: str
    login: str
    email: str | None = None
    avatar_url: str | None = None
