"""GitHub OAuth 제공자.

`OAuthProviderPort` 의 첫 구현체다. 벤더를 추가할 때 이 파일을 복사해 고치는 것이 아니라,
같은 port 를 구현하는 새 모듈을 만들고 registry 에 등록한다 (`infrastructure/auth/registry.py`).
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx

from dahaze_api.domain.entities import ExternalIdentity

PROVIDER = "github"

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
EMAILS_URL = "https://api.github.com/user/emails"


class OAuthError(RuntimeError):
    """제공자와의 대화가 실패했다. 사용자에게는 일반 메시지만 보인다."""


class GitHubOAuthProvider:
    def __init__(self, *, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

    @property
    def provider(self) -> str:
        return PROVIDER

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": redirect_uri,
                "state": state,
                # 이메일은 프로필에 공개돼 있지 않을 수 있어 별도 스코프가 필요하다.
                "scope": "read:user user:email",
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ExternalIdentity:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token = await self._exchange_token(client, code=code, redirect_uri=redirect_uri)
            profile = await self._fetch(client, USER_URL, token)
            raw_email = profile.get("email")
            email = raw_email or await self._fetch_primary_email(client, token)

        avatar = profile.get("avatar_url")
        return ExternalIdentity(
            provider=PROVIDER,
            # GitHub 의 `id` 는 숫자이고 불변이다. `login` 은 사용자가 바꿀 수 있으므로
            # 식별자로 쓰지 않는다 — 바뀌는 값을 키로 삼으면 계정이 갈라진다.
            provider_user_id=str(profile["id"]),
            login=str(profile["login"]),
            email=str(email) if email else None,
            avatar_url=str(avatar) if avatar else None,
        )

    async def _exchange_token(
        self, client: httpx.AsyncClient, *, code: str, redirect_uri: str
    ) -> str:
        response = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        response.raise_for_status()
        payload = response.json()

        # GitHub 는 실패도 200 으로 돌려주고 본문에 error 를 담는다.
        if "error" in payload:
            raise OAuthError(f"github token exchange failed: {payload['error']}")
        token = payload.get("access_token")
        if not token:
            raise OAuthError("github token exchange returned no access_token")
        return str(token)

    async def _fetch(
        self, client: httpx.AsyncClient, url: str, token: str
    ) -> dict[str, object]:
        response = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        response.raise_for_status()
        result: dict[str, object] = response.json()
        return result

    async def _fetch_primary_email(
        self, client: httpx.AsyncClient, token: str
    ) -> str | None:
        """프로필에 이메일이 없을 때 인증된 primary 이메일을 찾는다."""
        response = await client.get(
            EMAILS_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        if response.status_code != 200:
            return None
        for entry in response.json():
            if entry.get("primary") and entry.get("verified"):
                email: str = entry["email"]
                return email
        return None
