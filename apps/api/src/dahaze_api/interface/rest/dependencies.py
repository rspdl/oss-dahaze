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
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.config import Settings, get_settings
from dahaze_api.domain.entities import User
from dahaze_api.domain.ports import OAuthProviderPort, RspdlCompilerPort
from dahaze_api.infrastructure.auth.registry import build_providers
from dahaze_api.infrastructure.auth.session import InvalidToken, SessionTokens
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import (
    SqlDocumentRepository,
    SqlProjectRepository,
    SqlUserRepository,
)
from dahaze_api.infrastructure.db.session import get_session
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
