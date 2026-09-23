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
    PasswordCredential,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
)
from dahaze_api.domain.llm import EbnfGrammar
from dahaze_api.domain.planning import DecisionResolutionOutcome
from dahaze_api.domain.rspdl import (
    AnalysisOutcome,
    RspdlEditOutcome,
    RspdlRuntime,
    RspdlSource,
)


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

    async def capabilities(self) -> frozenset[str]:
        """실제 compiler 결과로 증명한 선택 기능."""
        ...

    async def compile(self, sources: Sequence[RspdlSource]) -> AnalysisOutcome: ...

    async def check(
        self,
        sources: Sequence[RspdlSource],
        data: Mapping[str, Any],
    ) -> AnalysisOutcome: ...

    async def find_model(
        self,
        source: RspdlSource,
        *,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> AnalysisOutcome: ...

    async def edit(
        self,
        source: RspdlSource,
        *,
        expected_source_hash: str,
        edit: Mapping[str, Any],
    ) -> RspdlEditOutcome:
        """컴파일러 소유의 구조화 편집으로 저장되지 않은 후보 원문을 만든다."""
        ...


class AnalysisCachePort(Protocol):
    """컴파일 결과 캐시. 저장된 것은 전부 버리고 다시 만들 수 있다 (ADR-0003)."""

    async def get(self, cache_key: str) -> AnalysisOutcome | None: ...

    async def put(self, cache_key: str, outcome: AnalysisOutcome) -> None: ...


class OAuthProviderPort(Protocol):
    """OAuth 신원 제공자.

    GitHub 이 첫 구현체지만 port 로 두어 벤더를 추가할 수 있게 한다. 구현체는
    `provider` 로 자신을 식별하고, 이 값이 `user_identities.provider` 에 저장된다.
    """

    @property
    def provider(self) -> str: ...

    def authorize_url(self, *, state: str, redirect_uri: str) -> str: ...

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ExternalIdentity: ...


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
        grammar: EbnfGrammar,
        system_prompt: str | None = None,
    ) -> str:
        """지시, 현재 진단과 EBNF 문법을 받아 RSPDL 소스 전문을 돌려준다.

        결과는 항상 컴파일러를 다시 통과시킨다. LLM 출력도 사람 출력과 같은 게이트를
        지나야 한다 — RSPDL AGENTS.md 의 원칙과 같다.

        `diagnostics` 는 컴파일러가 준 진단 그대로다. 구현체가 이를 요약하거나 걸러내면
        `rule_id` 와 `span` 이 사라져 무엇을 고쳐야 할지 알 수 없게 된다.
        부분 수정본이 아니라 **전문**을 돌려준다 — 병합은 또 하나의 해석이다.

        `grammar` 는 공급자 독립 원본이다. OpenAI 어댑터는 Lark CFG로 바꾸고,
        self-hosted 어댑터는 xgrammar 등 자신의 constrained decoding 형식으로 바꾼다.
        application 계층이 그 전송 형식을 알면 벤더 교체 경계가 무너진다.
        """
        ...


class PlanningLlmPort(Protocol):
    """자연어 인터뷰와 소스 생성 계획을 구조화해 돌려주는 LLM 경계."""

    @property
    def model(self) -> str: ...

    async def interview_project(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]: ...

    async def plan_project_changes(self, *, context: Mapping[str, Any]) -> Mapping[str, Any]: ...

    async def close(self) -> None: ...


class UserRepositoryPort(Protocol):
    """사용자와 외부 신원."""

    async def get(self, user_id: UUID) -> User | None: ...

    async def find_by_identity(self, *, provider: str, provider_user_id: str) -> User | None: ...

    async def create_from_identity(self, identity: ExternalIdentity) -> User:
        """신원으로 사용자를 새로 만든다. 같은 사람이 다른 벤더로 로그인하면
        별도 사용자가 된다 — 계정 병합은 아직 지원하지 않는다."""
        ...

    async def create(self, *, display_name: str, email: str | None) -> User:
        """외부 신원 없이 사용자를 만든다. 회원가입으로 들어온 사람이 여기로 온다."""
        ...


class PasswordCredentialRepositoryPort(Protocol):
    """아이디·비밀번호 자격증명.

    `UserRepositoryPort` 와 나눠 둔 이유는 저장소가 아니라 **읽는 사람** 때문이다. 사용자
    저장소에 `find_by_login` 이 섞여 있으면 그 login 이 GitHub 의 것인지 우리 것인지
    이름만으로는 알 수 없다.
    """

    async def find_by_login(self, login: str) -> PasswordCredential | None:
        """정규화된 아이디로 찾는다. 정규화는 유스케이스가 이미 끝냈다."""
        ...

    async def create(
        self, *, user_id: UUID, login: str, password_hash: str
    ) -> PasswordCredential | None:
        """만들어진 자격증명. 그 아이디가 이미 있으면 `None`.

        예외가 아니라 `None` 인 이유는 경쟁을 정상 흐름으로 다루기 위해서다. 유니크 제약
        위반을 예외로 받으면 그 예외가 저장소 기술마다 다르고, 그걸 잡으려면 위 계층이
        SQLAlchemy 를 알아야 한다.
        """
        ...


class PasswordHasherPort(Protocol):
    """비밀번호 → 저장 가능한 해시.

    두 메서드가 async 인 것은 I/O 때문이 아니라 **CPU 때문**이다. 쓸 만한 비밀번호 해시는
    일부러 느리게 만든 함수라, 구현체가 스레드로 넘기지 않으면 로그인 한 번이 이벤트 루프
    전체를 그 시간만큼 멈춘다. port 를 async 로 두면 구현체가 그 사실을 잊기 어렵다.
    """

    async def hash(self, password: str) -> str: ...

    async def verify(self, *, password: str, hashed: str) -> bool:
        """맞으면 `True`. 저장된 해시를 읽을 수 없어도 예외가 아니라 `False`."""
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
    ) -> Project: ...

    async def get(self, project_id: UUID) -> Project | None: ...

    async def get_by_slug(self, slug: str) -> Project | None: ...

    async def list_for_user(
        self, user_id: UUID, *, include_archived: bool = False
    ) -> list[Project]: ...

    async def membership_of(self, *, project_id: UUID, user_id: UUID) -> ProjectMembership | None:
        """접근 검사의 유일한 진입점. 없으면 그 사용자는 프로젝트를 볼 수 없다."""
        ...

    async def add_member(
        self, *, project_id: UUID, user_id: UUID, role: ProjectRole
    ) -> ProjectMembership: ...

    async def list_members(self, project_id: UUID) -> list[ProjectMembership]: ...

    async def archive(self, project_id: UUID) -> Project | None: ...


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
    ) -> Document: ...

    async def get(self, document_id: UUID) -> Document | None: ...

    async def list_for_project(self, project_id: UUID) -> list[Document]: ...

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

    async def soft_delete(self, document_id: UUID) -> bool: ...

    async def list_revisions(self, document_id: UUID) -> list[DocumentRevision]: ...


class PlanningRepositoryPort(Protocol):
    """프로젝트 기획 상태와 원자적 변경 묶음 저장소."""

    async def get_state(self, project_id: UUID) -> Mapping[str, Any]: ...
    async def update_state(
        self,
        project_id: UUID,
        *,
        actor_id: UUID,
        expected_revision: int,
        messages: Sequence[Mapping[str, Any]],
        decisions: Sequence[Mapping[str, Any]],
        proposals: Sequence[Mapping[str, Any]],
        metadata: Mapping[str, Any],
    ) -> Mapping[str, Any] | None: ...
    async def append_message(
        self,
        project_id: UUID,
        *,
        expected_revision: int,
        role: str,
        content: str,
    ) -> Mapping[str, Any] | None: ...
    async def append_decision(
        self,
        project_id: UUID,
        *,
        expected_revision: int,
        title: str,
        rationale: str | None,
        status: str,
    ) -> Mapping[str, Any] | None: ...
    async def resolve_decision(
        self,
        project_id: UUID,
        *,
        decision_id: UUID,
        expected_revision: int,
        status: str,
        rationale: str | None,
    ) -> DecisionResolutionOutcome: ...
    async def resolve_proposal(
        self,
        project_id: UUID,
        *,
        proposal_id: UUID,
        expected_revision: int,
        status: str,
        rationale: str | None,
    ) -> Mapping[str, Any] | None: ...
    async def patch_metadata(
        self,
        project_id: UUID,
        *,
        actor_id: UUID,
        expected_revision: int,
        patch: Mapping[str, Any],
        summary: str | None,
    ) -> Mapping[str, Any] | None: ...
    async def list_metadata_revisions(
        self,
        project_id: UUID,
        *,
        limit: int,
        before_revision: int | None,
    ) -> list[Mapping[str, Any]]: ...
    async def undo_metadata(
        self,
        project_id: UUID,
        *,
        actor_id: UUID,
        expected_revision: int,
        target_revision: int,
    ) -> Mapping[str, Any] | None: ...
    async def create_draft(
        self,
        *,
        project_id: UUID,
        base_project_revision: int,
        base_source_hash: str,
        changes: Sequence[Mapping[str, Any]],
        candidate_documents: Sequence[Mapping[str, Any]],
        candidate_source_hash: str,
        summary: str | None,
        rspdl_version: str,
        wire_schema_version: int,
        locale: str,
        result: Mapping[str, Any] | None,
        base_result: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]: ...
    async def get_draft(self, draft_id: UUID) -> Mapping[str, Any] | None: ...
    async def list_drafts(self, project_id: UUID) -> list[Mapping[str, Any]]: ...
    async def apply_draft(
        self,
        *,
        draft_id: UUID,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
    ) -> Mapping[str, Any] | None: ...
    async def list_snapshots(self, project_id: UUID) -> list[Mapping[str, Any]]: ...
    async def capture_snapshot(
        self,
        *,
        project_id: UUID,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
        summary: str | None,
        compiled_source_hash: str,
        rspdl_version: str,
        wire_schema_version: int,
        locale: str,
        result: Mapping[str, Any] | None,
    ) -> Mapping[str, Any] | None: ...
    async def get_snapshot(self, project_id: UUID, revision: int) -> Mapping[str, Any] | None: ...
    async def restore_snapshot(
        self,
        *,
        project_id: UUID,
        revision: int,
        actor_id: UUID,
        expected_project_revision: int,
        expected_source_hash: str,
        expected_planning_revision: int,
    ) -> Mapping[str, Any] | None: ...


class PlanningAiJobRepositoryPort(Protocol):
    """영속 AI 작업 큐. lease token이 모든 worker 쓰기의 fencing token이다."""

    async def enqueue(
        self,
        *,
        project_id: UUID,
        actor_id: UUID,
        request_id: UUID,
        kind: str,
        instruction: str,
        expected_planning_revision: int,
        frozen_project_revision: int,
        frozen_source_hash: str,
        context: Mapping[str, Any],
        source_draft_id: UUID | None,
        retry_of_job_id: UUID | None,
        attempt: int,
        max_attempts: int,
        append_user_message: bool = True,
    ) -> Mapping[str, Any] | None: ...

    async def get(self, job_id: UUID) -> Mapping[str, Any] | None: ...
    async def get_by_request(
        self, *, project_id: UUID, actor_id: UUID, request_id: UUID
    ) -> Mapping[str, Any] | None: ...
    async def get_retry(self, job_id: UUID) -> Mapping[str, Any] | None: ...
    async def list(self, project_id: UUID, *, limit: int) -> list[Mapping[str, Any]]: ...
    async def request_cancel(self, job_id: UUID) -> Mapping[str, Any] | None: ...
    async def claim(self, *, lease_seconds: int) -> Mapping[str, Any] | None: ...
    async def heartbeat(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        lease_seconds: int,
        progress: Mapping[str, Any],
    ) -> bool: ...
    async def renew_lease(self, job_id: UUID, *, lease_token: UUID, lease_seconds: int) -> bool: ...
    async def checkpoint(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        checkpoints: Mapping[str, Any],
        progress: Mapping[str, Any],
    ) -> bool: ...
    async def cancelled(self, job_id: UUID, *, lease_token: UUID) -> bool: ...
    async def finish_cancelled(self, job_id: UUID, *, lease_token: UUID) -> bool: ...
    async def finish_failed(
        self, job_id: UUID, *, lease_token: UUID, error: Mapping[str, Any]
    ) -> bool: ...
    async def finish_interview(
        self, job_id: UUID, *, lease_token: UUID, result: Mapping[str, Any]
    ) -> bool: ...
    async def finish_generation(
        self, job_id: UUID, *, lease_token: UUID, result: Mapping[str, Any]
    ) -> bool: ...
    async def finish_generation_draft(
        self,
        job_id: UUID,
        *,
        lease_token: UUID,
        draft: Mapping[str, Any],
        result: Mapping[str, Any],
    ) -> bool: ...
