"""인증 엔드포인트.

문이 둘이다.

- **OAuth** — 리다이렉트 왕복. 경로의 `{provider}` 로 registry 에서 어댑터를 고르므로
  벤더를 추가해도 이 파일은 바뀌지 않는다.
- **아이디·비밀번호** — 왕복이 없는 XHR. 설정과 무관하게 항상 열려 있다.

두 문 모두 같은 쿠키를 심고 같은 `users` 로 도착한다. 환경에 따라 열리고 닫히는 문은
없다 — 개발에서 보는 로그인 화면과 프로덕션에서 보는 화면이 같아야, 화면에서 재현되지
않는 문제가 로그인 단계에서부터 생기지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse

from dahaze_api.application.errors import Conflict
from dahaze_api.config import Settings
from dahaze_api.domain.entities import User
from dahaze_api.infrastructure.auth.github import OAuthError
from dahaze_api.infrastructure.auth.session import MCP_TTL, InvalidToken, SessionTokens
from dahaze_api.interface.rest.dependencies import (
    SESSION_COOKIE,
    CurrentUser,
    PasswordSignIn,
    Providers,
    Register,
    SettingsDep,
    SignIn,
    Tokens,
)
from dahaze_api.interface.rest.schemas import (
    AuthProvidersResponse,
    CurrentUserResponse,
    McpTokenResponse,
    PasswordLoginRequest,
    RegisterRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 브라우저 세션의 수명. 발급과 삭제가 같은 값을 봐야 한다.
SESSION_TTL_SECONDS = 14 * 24 * 3600


def _set_session_cookie(
    response: Response,
    *,
    tokens: SessionTokens,
    settings: Settings,
    user_id: UUID,
) -> None:
    """로그인이 끝난 응답에 세션 쿠키를 붙인다.

    로그인 경로가 둘(OAuth 콜백, 개발용 비밀번호)이 되었으므로 쿠키 속성을 한곳에 모은다.
    `httponly` 나 `samesite` 가 한쪽에서만 빠지면 그 경로로 들어온 사람만 조용히 약한
    세션을 갖게 되고, 그건 쳐다보기 전에는 드러나지 않는다.
    """
    response.set_cookie(
        SESSION_COOKIE,
        tokens.issue(user_id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,  # type: ignore[arg-type]
        domain=settings.cookie_domain,
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )


def _user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )


@router.get("/providers", name="list_auth_providers")
async def list_auth_providers(providers: Providers) -> AuthProvidersResponse:
    """쓸 수 있는 OAuth 제공자.

    프론트가 로그인 버튼을 하드코딩하지 않도록 서버가 알려준다. 자격증명이 없는
    제공자는 애초에 등록되지 않는다. 아이디·비밀번호 로그인은 여기 없다 — 항상 열려
    있으므로 알려줄 것이 없다.
    """
    return AuthProvidersResponse(providers=sorted(providers))


@router.post("/register", name="register", status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    register_user: Register,
    tokens: Tokens,
    settings: SettingsDep,
    response: Response,
) -> CurrentUserResponse:
    """아이디·비밀번호로 계정을 만들고 바로 로그인시킨다.

    가입 직후 로그인 화면으로 돌려보내지 않는다. 방금 정한 비밀번호를 한 번 더 치게 하는
    것은 확인이 아니라 마찰이다.

    가입해도 보이는 프로젝트는 없다. 프로젝트는 멤버십으로만 열리므로, 계정이 생겼다는
    사실만으로는 남의 것에 닿지 못한다.
    """
    try:
        user = await register_user(
            login=payload.login,
            password=payload.password,
            display_name=payload.display_name,
            email=None,
        )
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    _set_session_cookie(response, tokens=tokens, settings=settings, user_id=user.id)
    return _user_response(user)


@router.post("/login", name="password_login")
async def password_login(
    payload: PasswordLoginRequest,
    sign_in: PasswordSignIn,
    tokens: Tokens,
    settings: SettingsDep,
    response: Response,
) -> CurrentUserResponse:
    """아이디·비밀번호 로그인.

    OAuth 와 달리 페이지를 떠나지 않는다. 응답에 세션 쿠키가 실려 오므로, 성공하면 프론트는
    세션 질의만 무효화하면 된다.

    실패는 전부 같은 401 이다. "없는 아이디" 와 "틀린 비밀번호" 를 나눠 말하면 로그인 화면이
    곧 계정 존재 여부를 묻는 창구가 된다.
    """
    user = await sign_in(login=payload.login, password=payload.password)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "아이디 또는 비밀번호가 맞지 않는다"
        )

    _set_session_cookie(response, tokens=tokens, settings=settings, user_id=user.id)
    return _user_response(user)


@router.get("/{provider}/login", name="begin_oauth_login")
async def begin_oauth_login(
    provider: str,
    providers: Providers,
    tokens: Tokens,
    settings: SettingsDep,
    redirect_to: str | None = Query(default=None, description="로그인 후 돌아갈 URL"),
) -> RedirectResponse:
    adapter = providers.get(provider)
    if adapter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"지원하지 않는 제공자: {provider}")

    # state 에 제공자와 복귀 URL 을 함께 서명해 담는다. 서버에 state 를 저장하지 않아도
    # 콜백에서 어느 흐름이었는지 복원할 수 있다.
    state = tokens.issue_state(
        provider=provider,
        redirect_to=redirect_to or settings.web_post_login_url,
    )
    url = adapter.authorize_url(state=state, redirect_uri=settings.oauth_redirect_uri)
    return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/{provider}/callback", name="complete_oauth_login")
async def complete_oauth_login(
    provider: str,
    code: str,
    state: str,
    providers: Providers,
    tokens: Tokens,
    settings: SettingsDep,
    sign_in: SignIn,
) -> RedirectResponse:
    adapter = providers.get(provider)
    if adapter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"지원하지 않는 제공자: {provider}")

    try:
        state_provider, redirect_to = tokens.verify_state(state)
    except InvalidToken as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "state 가 유효하지 않다") from exc

    # 경로의 제공자와 state 에 담긴 제공자가 다르면 흐름이 섞인 것이다.
    if state_provider != provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "state 가 제공자와 맞지 않는다")

    try:
        identity = await adapter.exchange_code(
            code=code, redirect_uri=settings.oauth_redirect_uri
        )
    except OAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인에 실패했다") from exc

    user = await sign_in(identity)

    response = RedirectResponse(redirect_to, status_code=status.HTTP_303_SEE_OTHER)
    _set_session_cookie(response, tokens=tokens, settings=settings, user_id=user.id)
    return response


@router.get("/me", name="get_current_user")
async def get_me(user: CurrentUser) -> CurrentUserResponse:
    return _user_response(user)


@router.post(
    "/mcp-token", name="issue_mcp_token", status_code=status.HTTP_201_CREATED
)
async def issue_mcp_token(user: CurrentUser, tokens: Tokens) -> McpTokenResponse:
    """MCP 클라이언트용 Bearer 토큰을 발급한다.

    MCP 클라이언트는 브라우저가 아니어서 세션 쿠키를 쓸 수 없다. 그래서 쿠키로 로그인한
    사람이 여기서 자기 몫의 토큰을 하나 꺼내 간다 (ADR-0005).

    같은 사용자가 여러 번 호출하면 유효한 토큰이 여러 개 생긴다. 발급 이력을 남기지
    않으므로 **이전 토큰을 무효화하지 못한다** — 폐기가 필요해지면 토큰 id 테이블과
    blocklist 가 먼저 있어야 한다.
    """
    return McpTokenResponse(
        token=tokens.issue_mcp(user.id),
        expires_at=datetime.now(UTC) + MCP_TTL,
    )


@router.post("/logout", name="logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, settings: SettingsDep) -> None:
    # 쿠키를 지울 때도 발급할 때와 같은 domain·path 여야 한다. 다르면 브라우저가
    # 다른 쿠키로 보고 원본이 남는다.
    response.delete_cookie(
        SESSION_COOKIE,
        domain=settings.cookie_domain,
        path="/",
    )
