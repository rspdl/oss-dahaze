"""Port 인터페이스.

`application/` 은 여기 정의된 것만 통해 바깥과 대화한다. 구현체는 `infrastructure/` 에 있다.
이 모듈은 외부 라이브러리를 import 하지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol
from uuid import UUID

from dahaze_api.domain.entities import (
    Document,
    DocumentRevision,
    ExternalIdentity,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
)
from dahaze_api.domain.rspdl import AnalysisOutcome, RspdlRuntime, RspdlSource


class RspdlCompilerPort(Protocol):
    """RSPDL 컴파일러.

    지금 구현체는 `import rspdl` 을 하는 인프로세스 어댑터 하나뿐이다. 한 프로세스는 rspdl
    버전을 하나만 가질 수 있으므로 (ADR-0002), 여러 버전을 동시에 지원하게 되는 날
    이 port 뒤에 원격 어댑터가 추가된다. 그때 application 계층은 바뀌지 않는다.
    """

    @property
    def runtime(self) -> RspdlRuntime:
        """이 컴파일러의 정체. 산출물마다 함께 기록된다."""
        ...

    async def compile(self, sources: Sequence[RspdlSource]) -> AnalysisOutcome:
        ...

    async def check(
        self,
        sources: Sequence[RspdlSource],
        data: Mapping[str, Any],
    ) -> AnalysisOutcome:
        ...

    async def find_model(
        self,
        source: RspdlSource,
        *,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> AnalysisOutcome:
        ...


class AnalysisCachePort(Protocol):
    """컴파일 결과 캐시. 저장된 것은 전부 버리고 다시 만들 수 있다 (ADR-0003)."""

    async def get(self, cache_key: str) -> AnalysisOutcome | None:
        ...

    async def put(self, cache_key: str, outcome: AnalysisOutcome) -> None:
        ...


class OAuthProviderPort(Protocol):
    """OAuth 신원 제공자.

    GitHub 이 첫 구현체지만 port 로 두어 벤더를 추가할 수 있게 한다. 구현체는
    `provider` 로 자신을 식별하고, 이 값이 `user_identities.provider` 에 저장된다.
    """

    @property
    def provider(self) -> str:
        ...

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        ...

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ExternalIdentity:
        ...


class LlmPort(Protocol):
    """자연어 → RSPDL 저작을 돕는 LLM.

    dahaze 가 직접 호출한다. 구현체는 `infrastructure/llm/` 에만 둔다.
    """

    @property
    def model(self) -> str:
        """이 초안을 만든 모델의 이름.

        `RspdlCompilerPort.runtime` 과 같은 이유로 둔다. 초안은 지시만으로 재현되지
        않으며, 어느 모델이 만들었는지는 텍스트만 보고 복원할 수 없다.
        """
        ...

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
    ) -> str:
        """지시와 현재 진단을 받아 RSPDL 소스 전문을 돌려준다.

        결과는 항상 컴파일러를 다시 통과시킨다. LLM 출력도 사람 출력과 같은 게이트를
        지나야 한다 — RSPDL AGENTS.md 의 원칙과 같다.

        `diagnostics` 는 컴파일러가 준 진단 그대로다. 구현체가 이를 요약하거나 걸러내면
        `rule_id` 와 `span` 이 사라져 무엇을 고쳐야 할지 알 수 없게 된다.
        부분 수정본이 아니라 **전문**을 돌려준다 — 병합은 또 하나의 해석이다.
        """
        ...



class UserRepositoryPort(Protocol):
    """사용자와 외부 신원."""

    async def get(self, user_id: UUID) -> User | None:
        ...

    async def find_by_identity(self, *, provider: str, provider_user_id: str) -> User | None:
        ...

    async def create_from_identity(self, identity: ExternalIdentity) -> User:
        """신원으로 사용자를 새로 만든다. 같은 사람이 다른 벤더로 로그인하면
        별도 사용자가 된다 — 계정 병합은 아직 지원하지 않는다."""
        ...


class ProjectRepositoryPort(Protocol):
    """프로젝트와 멤버십.

    한 사용자가 여러 프로젝트를 갖는다. 모든 조회는 멤버십을 통해서만 이뤄지며,
    소유자를 위한 별도 경로를 두지 않는다.
    """

    async def create(
        self,
        *,
        owner_id: UUID,
        slug: str,
        name: str,
        description: str | None,
        default_rspdl_version: str,
    ) -> Project:
        ...

    async def get(self, project_id: UUID) -> Project | None:
        ...

    async def get_by_slug(self, slug: str) -> Project | None:
        ...

    async def list_for_user(
        self, user_id: UUID, *, include_archived: bool = False
    ) -> list[Project]:
        ...

    async def membership_of(self, *, project_id: UUID, user_id: UUID) -> ProjectMembership | None:
        """접근 검사의 유일한 진입점. 없으면 그 사용자는 프로젝트를 볼 수 없다."""
        ...

    async def add_member(
        self, *, project_id: UUID, user_id: UUID, role: ProjectRole
    ) -> ProjectMembership:
        ...

    async def list_members(self, project_id: UUID) -> list[ProjectMembership]:
        ...

    async def archive(self, project_id: UUID) -> Project | None:
        ...


class DocumentRepositoryPort(Protocol):
    """RSPDL 문서와 편집 이력.

    텍스트가 진실이다 (ADR-0003). 컴파일 결과는 여기 저장하지 않는다.
    """

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
        ...

    async def get(self, document_id: UUID) -> Document | None:
        ...

    async def list_for_project(self, project_id: UUID) -> list[Document]:
        ...

    async def update_text(
        self,
        *,
        document_id: UUID,
        text: str,
        author_id: UUID | None,
        summary: str | None,
    ) -> Document | None:
        """본문을 바꾸고 리비전을 남긴다. 텍스트가 그대로면 리비전을 만들지 않는다."""
        ...

    async def soft_delete(self, document_id: UUID) -> bool:
        ...

    async def list_revisions(self, document_id: UUID) -> list[DocumentRevision]:
        ...
