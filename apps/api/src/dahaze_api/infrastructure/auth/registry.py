"""로그인 어댑터 registry.

설정을 보고 어댑터를 고르는 곳은 여기 하나다. 새 OAuth 제공자는 `OAuthProviderPort` 를
구현하고 `build_providers` 에 자격증명이 있을 때만 등록되도록 넣는다. 라우터와 유스케이스는
제공자 이름만 다루고 구현체를 모른다.

개발용 비밀번호 로그인도 여기서 만든다. OAuth 제공자 목록에는 넣지 않는다 — 리다이렉트
왕복이 없는 다른 종류의 문이라, 같은 목록에 섞으면 `/{provider}/login` 이 열지 못하는
이름이 목록에 앉아 있게 된다.
"""

from __future__ import annotations

from dahaze_api.config import Settings
from dahaze_api.domain.ports import OAuthProviderPort
from dahaze_api.infrastructure.auth.dev import DevPasswordAuthenticator
from dahaze_api.infrastructure.auth.github import GitHubOAuthProvider


def build_providers(settings: Settings) -> dict[str, OAuthProviderPort]:
    """설정된 제공자만 담은 registry.

    자격증명이 없는 제공자는 등록하지 않는다. 등록되지 않은 제공자로 로그인을 시도하면
    라우터가 404 를 준다 — 반쯤 설정된 채로 런타임에 실패하는 것보다 낫다.
    """
    providers: dict[str, OAuthProviderPort] = {}

    if settings.github_client_id and settings.github_client_secret:
        providers["github"] = GitHubOAuthProvider(
            client_id=settings.github_client_id,
            client_secret=settings.github_client_secret,
        )

    # 새 벤더는 여기에 추가한다. 예:
    # if settings.google_client_id and settings.google_client_secret:
    #     providers["google"] = GoogleOAuthProvider(...)

    return providers


def build_dev_authenticator(settings: Settings) -> DevPasswordAuthenticator | None:
    """개발용 비밀번호 로그인. 닫혀 있으면 `None`.

    `None` 을 돌려주는 것이 곧 "이 문은 없다" 는 뜻이고, 라우터는 그 경우 404 를 준다.
    끄는 판단은 전부 `Settings.dev_login_enabled` 안에 있다 — 조건이 두 군데로 갈라지면
    한쪽만 고쳐지는 날이 온다.
    """
    if not settings.dev_login_enabled:
        return None
    return DevPasswordAuthenticator(password=settings.dev_login_password)
