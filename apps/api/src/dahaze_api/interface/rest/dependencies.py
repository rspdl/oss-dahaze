"""FastAPI 의존성 배선.

구체 어댑터를 고르는 유일한 지점이다. 라우터는 port 타입과 유스케이스만 본다.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.auth import (
    RegisterWithPassword,
    SignInWithPassword,
    SignInWithProvider,
)
from dahaze_api.application.authoring import DraftRspdlDocument
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.config import Settings, get_settings
from dahaze_api.domain.entities import User
from dahaze_api.domain.ports import (
    LlmPort,
    OAuthProviderPort,
    PasswordHasherPort,
    RspdlCompilerPort,
)
from dahaze_api.infrastructure.auth.password import ScryptPasswordHasher
from dahaze_api.infrastructure.auth.registry import build_providers
from dahaze_api.infrastructure.auth.session import InvalidToken, SessionTokens
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import (
    SqlDocumentRepository,
    SqlPasswordCredentialRepository,
    SqlProjectRepository,
    SqlUserRepository,
)
from dahaze_api.infrastructure.db.session import get_session
from dahaze_api.infrastructure.llm import LlmNotConfigured, OpenAiLlm
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler

SESSION_COOKIE = "dahaze_session"


@lru_cache
def get_compiler() -> RspdlCompilerPort:
    """프로세스당 하나. 한 프로세스는 rspdl 버전을 하나만 가질 수 있다 (ADR-0002)."""
    return LocalRspdlCompiler()


@lru_cache
def get_session_tokens() -> SessionTokens:
    return SessionTokens(get_settings().session_secret)


SettingsDep = Annotated[Settings, Depends(get_settings)]
DbSession = Annotated[AsyncSession, Depends(get_session)]
Compiler = Annotated[RspdlCompilerPort, Depends(get_compiler)]
Tokens = Annotated[SessionTokens, Depends(get_session_tokens)]


def get_oauth_providers(settings: SettingsDep) -> dict[str, OAuthProviderPort]:
    """설정된 OAuth 제공자. 자격증명이 없으면 빈 registry.

    **`lru_cache` 를 붙이지 않는다.** 캐시가 붙어 있으면
    `get_settings` 를 갈아끼워도 registry 는 프로세스 전역 설정(즉 개발자 기계의 `.env`)을
    계속 읽어서, "자격증명이 없으면 제공자가 없다" 를 확인하려는 테스트가 그 기계에 무엇이
    설정돼 있느냐에 따라 통과하거나 실패한다.

    만드는 비용은 문자열 두 개를 든 객체다. httpx 클라이언트는 `exchange_code` 안에서
    요청마다 따로 만든다 — 캐시해서 아낄 것이 없다.
    """
    return build_providers(settings)


Providers = Annotated[dict[str, OAuthProviderPort], Depends(get_oauth_providers)]


@lru_cache
def get_password_hasher() -> PasswordHasherPort:
    """비밀번호 해시 어댑터. 상태가 없어 프로세스당 하나면 충분하다."""
    return ScryptPasswordHasher()


Hasher = Annotated[PasswordHasherPort, Depends(get_password_hasher)]


def get_analyzer(session: DbSession, compiler: Compiler) -> AnalyzeWorkspace:
    return AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session))


def get_sign_in(session: DbSession) -> SignInWithProvider:
    return SignInWithProvider(SqlUserRepository(session))


def get_register(session: DbSession, hasher: Hasher) -> RegisterWithPassword:
    return RegisterWithPassword(
        users=SqlUserRepository(session),
        credentials=SqlPasswordCredentialRepository(session),
        hasher=hasher,
    )


def get_password_sign_in(session: DbSession, hasher: Hasher) -> SignInWithPassword:
    return SignInWithPassword(
        users=SqlUserRepository(session),
        credentials=SqlPasswordCredentialRepository(session),
        hasher=hasher,
    )


def get_workspace(session: DbSession, compiler: Compiler) -> WorkspaceService:
    return WorkspaceService(
        projects=SqlProjectRepository(session),
        documents=SqlDocumentRepository(session),
        compiler=compiler,
    )


async def get_current_user(
    session: DbSession,
    tokens: Tokens,
    dahaze_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    """세션 쿠키에서 사용자를 복원한다. 없거나 유효하지 않으면 401."""
    if not dahaze_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요하다")
    try:
        user_id: UUID = tokens.verify(dahaze_session)
    except InvalidToken as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 유효하지 않다") from exc

    user = await SqlUserRepository(session).get(user_id)
    if user is None:
        # 토큰은 유효한데 사용자가 사라진 경우. 만료된 세션과 같게 취급한다.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 유효하지 않다")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
Analyzer = Annotated[AnalyzeWorkspace, Depends(get_analyzer)]
Workspace = Annotated[WorkspaceService, Depends(get_workspace)]
SignIn = Annotated[SignInWithProvider, Depends(get_sign_in)]
Register = Annotated[RegisterWithPassword, Depends(get_register)]
PasswordSignIn = Annotated[SignInWithPassword, Depends(get_password_sign_in)]


@lru_cache
def get_llm() -> LlmPort:
    """OpenAI 어댑터. 자격증명이 없으면 여기서 503 으로 끝난다.

    import 나 startup 이 아니라 **요청 시점**에 확인하는 이유: LLM 을 쓰지 않는 배포에서도
    나머지 API 는 정상 동작해야 한다. 키가 없다고 서버가 뜨지 못하면 저작과 무관한
    기능까지 함께 죽는다 (ADR-0005).
    """
    settings = get_settings()
    try:
        return OpenAiLlm(
            api_key=settings.openai_api_key, model=settings.openai_model
        )
    except LlmNotConfigured as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "이 서버에는 LLM 저작이 설정되어 있지 않다"
        ) from exc


Llm = Annotated[LlmPort, Depends(get_llm)]


def get_drafter(llm: Llm, analyzer: Analyzer) -> DraftRspdlDocument:
    """저작 루프는 분석 유스케이스를 그대로 재사용한다.

    컴파일 게이트가 REST 분석 경로와 같아야 LLM 출력이 사람 출력과 같은 검사를 받는다.
    """
    return DraftRspdlDocument(llm=llm, analyzer=analyzer)


Drafter = Annotated[DraftRspdlDocument, Depends(get_drafter)]
