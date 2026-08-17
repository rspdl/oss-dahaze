"""OAuth 제공자 registry.

벤더를 추가하는 곳은 여기 하나다. 새 제공자는 `OAuthProviderPort` 를 구현하고 아래
`build_providers` 에 자격증명이 있을 때만 등록되도록 넣는다. 라우터와 유스케이스는
제공자 이름만 다루고 구현체를 모른다.
"""

from __future__ import annotations

from dahaze_api.config import Settings
from dahaze_api.domain.ports import OAuthProviderPort
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
