"""인증 엔드포인트.

제공자에 무관하다. 경로의 `{provider}` 로 registry 에서 어댑터를 고르므로, 벤더를
추가해도 이 파일은 바뀌지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse

from dahaze_api.config import Settings
from dahaze_api.infrastructure.auth.github import OAuthError
from dahaze_api.infrastructure.auth.session import MCP_TTL, InvalidToken, SessionTokens
from dahaze_api.interface.rest.dependencies import (
    SESSION_COOKIE,
    CurrentUser,
    DevAuth,
    Providers,
    SettingsDep,
    SignIn,
    Tokens,
)
from dahaze_api.interface.rest.schemas import (
    AuthProvidersResponse,
    CurrentUserResponse,
    DevLoginRequest,
    McpTokenResponse,
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


@router.get("/providers", name="list_auth_providers")
async def list_auth_providers(
    providers: Providers, dev_auth: DevAuth
) -> AuthProvidersResponse:
    """쓸 수 있는 로그인 방법.

    프론트가 로그인 버튼을 하드코딩하지 않도록 서버가 알려준다. 자격증명이 없는
    제공자는 애초에 등록되지 않고, 개발용 비밀번호 로그인은 development 에서만 켜진다.
    """
    return AuthProvidersResponse(
        providers=sorted(providers), dev_login=dev_auth is not None
    )


@router.post("/dev/login", name="dev_login")
async def dev_login(
    payload: DevLoginRequest,
    dev_auth: DevAuth,
    tokens: Tokens,
    settings: SettingsDep,
    sign_in: SignIn,
    response: Response,
) -> CurrentUserResponse:
    """개발 환경 전용 아이디·비밀번호 로그인.

    OAuth 왕복이 없으므로 리다이렉트가 아니라 XHR 로 부르고, 응답에 세션 쿠키가 실린다.
    로그인 뒤에 하는 일은 OAuth 콜백과 완전히 같다 — 같은 유스케이스로 사용자를 찾거나
    만들고, 같은 쿠키를 심는다. 개발용이라고 다른 세션 구조를 쓰면 로컬에서만 되는 버그가
    생긴다.

    닫혀 있으면 404 다. "설정이 없다" 와 "비밀번호가 틀렸다" 를 같은 401 로 묶으면
    기여자가 무엇을 고쳐야 하는지 알 수 없다.
    """
    if dev_auth is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "개발용 로그인이 열려 있지 않다 (development 환경에서만 열린다)",
        )

    identity = dev_auth.authenticate(
        username=payload.username, password=payload.password
    )
    if identity is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "아이디 또는 비밀번호가 맞지 않는다"
        )

    user = await sign_in(identity)
    _set_session_cookie(response, tokens=tokens, settings=settings, user_id=user.id)

    return CurrentUserResponse(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )


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
    return CurrentUserResponse(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )


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
