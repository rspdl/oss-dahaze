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
from dahaze_api.application.auth import SignInWithProvider
from dahaze_api.application.authoring import DraftRspdlDocument
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.config import Settings, get_settings
from dahaze_api.domain.entities import User
from dahaze_api.domain.ports import LlmPort, OAuthProviderPort, RspdlCompilerPort
from dahaze_api.infrastructure.auth.dev import DevPasswordAuthenticator
from dahaze_api.infrastructure.auth.registry import build_dev_authenticator, build_providers
from dahaze_api.infrastructure.auth.session import InvalidToken, SessionTokens
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import (
    SqlDocumentRepository,
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


@lru_cache
def get_oauth_providers() -> dict[str, OAuthProviderPort]:
    return build_providers(get_settings())


SettingsDep = Annotated[Settings, Depends(get_settings)]
DbSession = Annotated[AsyncSession, Depends(get_session)]
Compiler = Annotated[RspdlCompilerPort, Depends(get_compiler)]
Tokens = Annotated[SessionTokens, Depends(get_session_tokens)]
Providers = Annotated[dict[str, OAuthProviderPort], Depends(get_oauth_providers)]


def get_dev_authenticator(settings: SettingsDep) -> DevPasswordAuthenticator | None:
    """개발용 비밀번호 로그인. 닫혀 있으면 `None`.

    `lru_cache` 를 붙이지 않는다. 설정을 인자로 받아야 테스트가 `get_settings` 를 갈아끼워
    "프로덕션에서는 닫혀 있는가" 를 실제로 확인할 수 있다. 만드는 비용은 문자열 하나를
    들고 있는 객체라 캐시할 것도 없다.
    """
    return build_dev_authenticator(settings)


DevAuth = Annotated[DevPasswordAuthenticator | None, Depends(get_dev_authenticator)]


def get_analyzer(session: DbSession, compiler: Compiler) -> AnalyzeWorkspace:
    return AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session))


def get_sign_in(session: DbSession) -> SignInWithProvider:
    return SignInWithProvider(SqlUserRepository(session))


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
