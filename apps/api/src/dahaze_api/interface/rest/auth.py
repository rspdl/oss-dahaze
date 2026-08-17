"""인증 엔드포인트.

제공자에 무관하다. 경로의 `{provider}` 로 registry 에서 어댑터를 고르므로, 벤더를
추가해도 이 파일은 바뀌지 않는다.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse

from dahaze_api.infrastructure.auth.github import OAuthError
from dahaze_api.infrastructure.auth.session import InvalidToken
from dahaze_api.interface.rest.dependencies import (
    SESSION_COOKIE,
    CurrentUser,
    Providers,
    SettingsDep,
    SignIn,
    Tokens,
)
from dahaze_api.interface.rest.schemas import (
    AuthProvidersResponse,
    CurrentUserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/providers", name="list_auth_providers")
async def list_auth_providers(providers: Providers) -> AuthProvidersResponse:
    """설정된 로그인 제공자 목록.

    프론트가 로그인 버튼을 하드코딩하지 않도록 서버가 알려준다. 자격증명이 없는
    제공자는 애초에 등록되지 않는다.
    """
    return AuthProvidersResponse(providers=sorted(providers))


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
    response.set_cookie(
        SESSION_COOKIE,
        tokens.issue(user.id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,  # type: ignore[arg-type]
        domain=settings.cookie_domain,
        max_age=14 * 24 * 3600,
        path="/",
    )
    return response


@router.get("/me", name="get_current_user")
async def get_me(user: CurrentUser) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
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
