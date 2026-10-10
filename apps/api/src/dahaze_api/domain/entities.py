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
    # 이 프로젝트가 기본으로 삼는 RSPDL 버전.
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


@dataclass(frozen=True, slots=True)
class PasswordCredential:
    """아이디·비밀번호로 들어오는 문 하나.

    `user_identities` 에 넣지 않는다. 저 테이블은 **외부 제공자가 확인해 준** 신원을 담는
    곳이고, 여기 있는 것은 우리가 직접 확인하는 비밀이다. 같은 테이블에 섞으면 "이 행은
    비밀을 들고 있는가" 가 provider 값에 따라 달라지고, 그 분기는 언젠가 빠뜨려진다.

    사용자 한 명당 최대 하나다. 비밀번호를 여러 개 두는 제품이 아니다.
    """

    user_id: UUID
    login: str
    password_hash: str
