"""로그인 유스케이스."""

from __future__ import annotations

from dahaze_api.domain.entities import ExternalIdentity, User
from dahaze_api.domain.ports import UserRepositoryPort


class SignInWithProvider:
    """확인된 외부 신원으로 사용자를 찾거나 만든다.

    신원 확인 자체는 어댑터가 이미 끝냈다. 여기서는 그 신원을 dahaze 사용자에 잇는
    일만 한다 — 어느 벤더였는지는 관심 밖이다.
    """

    def __init__(self, users: UserRepositoryPort) -> None:
        self._users = users

    async def __call__(self, identity: ExternalIdentity) -> User:
        existing = await self._users.find_by_identity(
            provider=identity.provider,
            provider_user_id=identity.provider_user_id,
        )
        if existing is not None:
            return existing
        return await self._users.create_from_identity(identity)
