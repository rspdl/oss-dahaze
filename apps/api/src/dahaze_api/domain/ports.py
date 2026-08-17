"""Port 인터페이스.

`application/` 은 여기 정의된 것만 통해 바깥과 대화한다. 구현체는 `infrastructure/` 에 있다.
이 모듈은 외부 라이브러리를 import 하지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

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
        """
        ...


class ExternalIdentity(Protocol):
    """OAuth 제공자가 확인해 준 신원."""

    @property
    def provider(self) -> str: ...
    @property
    def provider_user_id(self) -> str: ...
    @property
    def login(self) -> str: ...
    @property
    def email(self) -> str | None: ...
    @property
    def avatar_url(self) -> str | None: ...
