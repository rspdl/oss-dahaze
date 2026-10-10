"""FastAPI 의존성 배선.

구체 어댑터를 고르는 유일한 지점이다. 라우터는 port 타입과 유스케이스만 본다.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.agent import AgentService
from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.auth import (
    RegisterWithPassword,
    SignInWithPassword,
    SignInWithProvider,
)
from dahaze_api.application.projects import ProjectService
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.config import Settings, get_settings
from dahaze_api.domain.entities import User
from dahaze_api.domain.ports import (
    OAuthProviderPort,
    PasswordHasherPort,
    ProjectEventsPort,
    RspdlCompilerPort,
)
from dahaze_api.infrastructure.agent_scope import (
    build_agent_scope,
    build_inspector,
    build_tree,
)
from dahaze_api.infrastructure.auth.password import ScryptPasswordHasher
from dahaze_api.infrastructure.auth.registry import build_providers
from dahaze_api.infrastructure.auth.session import InvalidToken, SessionTokens
from dahaze_api.infrastructure.db.agent_repository import SqlProjectEvents
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import (
    SqlPasswordCredentialRepository,
    SqlProjectRepository,
    SqlUserRepository,
)
from dahaze_api.infrastructure.db.session import get_session, get_session_factory
from dahaze_api.infrastructure.event_feed import PgEventListener, ProjectEventFeed
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
# `scope="function"`: 응답을 보내기 **전에** commit 한다. 기본값(request)은 응답을 보낸 뒤에
# commit 해서, 201 을 받은 클라이언트가 곧바로 그 자원을 조회하면 아직 없는 것으로 보인다
# (세션을 만들고 바로 메시지를 보내면 가끔 404 가 났다).
DbSession = Annotated[AsyncSession, Depends(get_session, scope="function")]
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


def get_projects(session: DbSession, compiler: Compiler) -> ProjectService:
    return ProjectService(projects=SqlProjectRepository(session), compiler=compiler)


Analyzer = Annotated[AnalyzeWorkspace, Depends(get_analyzer)]
Projects = Annotated[ProjectService, Depends(get_projects)]


def get_tree(session: DbSession) -> TreeService:
    # 사람의 저장·MCP·AI 가 같은 방법으로 조립한다. 변경은 프로젝트 이벤트로 기록된다.
    return build_tree(session)


Tree = Annotated[TreeService, Depends(get_tree)]


def get_tree_inspector(session: DbSession, tree: Tree, compiler: Compiler) -> TreeInspector:
    return build_inspector(session, tree, compiler)


Inspector = Annotated[TreeInspector, Depends(get_tree_inspector)]


def get_agent_service(session: DbSession, compiler: Compiler) -> AgentService:
    return AgentService(build_agent_scope(session, compiler))


Agents = Annotated[AgentService, Depends(get_agent_service)]


def get_project_events(session: DbSession) -> ProjectEventsPort:
    return SqlProjectEvents(session)


ProjectEvents = Annotated[ProjectEventsPort, Depends(get_project_events)]


@lru_cache
def get_event_listener() -> PgEventListener:
    """프로세스당 LISTEN 연결 하나."""
    return PgEventListener(get_settings().database_url)


def get_event_feed() -> ProjectEventFeed:
    """SSE 가 쓰는 피드. 요청 세션을 쓰지 않고 조회마다 짧은 세션을 연다."""
    return ProjectEventFeed(sessions=get_session_factory(), listener=get_event_listener())


EventFeed = Annotated[ProjectEventFeed, Depends(get_event_feed)]


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
SignIn = Annotated[SignInWithProvider, Depends(get_sign_in)]
Register = Annotated[RegisterWithPassword, Depends(get_register)]
PasswordSignIn = Annotated[SignInWithPassword, Depends(get_password_sign_in)]
