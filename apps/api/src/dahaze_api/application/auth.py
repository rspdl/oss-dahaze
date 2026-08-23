"""로그인 유스케이스.

문이 둘이다. OAuth 는 외부 제공자가 신원을 확인해 주고, 아이디·비밀번호는 우리가 직접
확인한다. **둘 다 같은 `users` 로 도착한다** — 어느 문으로 들어왔는지에 따라 세션이나 권한이
달라지지 않는다. 달라지면 한쪽 문으로만 재현되는 버그가 생긴다.
"""

from __future__ import annotations

from dahaze_api.application.errors import Conflict
from dahaze_api.domain.entities import ExternalIdentity, User
from dahaze_api.domain.ports import (
    PasswordCredentialRepositoryPort,
    PasswordHasherPort,
    UserRepositoryPort,
)


def normalize_login(login: str) -> str:
    """아이디를 저장·조회에 쓸 형태로.

    대소문자를 무시한다. `Tester` 로 가입한 사람이 `tester` 로 못 들어오면, 그 사람은
    자기가 무엇을 잘못 쳤는지 알 방법이 없다. 정규화를 DB 대신 여기서 하는 이유는
    저장된 값이 곧 조회하는 값이어야 읽는 사람이 헷갈리지 않기 때문이다.
    """
    return login.strip().lower()


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


class RegisterWithPassword:
    """아이디·비밀번호로 계정을 만든다."""

    def __init__(
        self,
        *,
        users: UserRepositoryPort,
        credentials: PasswordCredentialRepositoryPort,
        hasher: PasswordHasherPort,
    ) -> None:
        self._users = users
        self._credentials = credentials
        self._hasher = hasher

    async def __call__(
        self, *, login: str, password: str, display_name: str, email: str | None
    ) -> User:
        normalized = normalize_login(login)

        # 미리 한 번 본다. 여기서 걸리는 것이 흔한 경우고, 사용자에게 "이미 쓰이는
        # 아이디" 라고 말할 수 있는 유일한 지점이다.
        if await self._credentials.find_by_login(normalized) is not None:
            raise Conflict("이미 쓰이고 있는 아이디다")

        password_hash = await self._hasher.hash(password)
        user = await self._users.create(display_name=display_name.strip(), email=email)

        # 위의 확인과 여기 사이에 같은 아이디가 들어올 수 있다. 저장소가 그 경우 `None` 을
        # 돌려주므로 경쟁도 같은 409 로 끝난다 — 방금 만든 사용자는 트랜잭션이 함께
        # 되돌린다.
        created = await self._credentials.create(
            user_id=user.id, login=normalized, password_hash=password_hash
        )
        if created is None:
            raise Conflict("이미 쓰이고 있는 아이디다")

        return user


class SignInWithPassword:
    """아이디·비밀번호를 확인한다. 맞으면 사용자, 틀리면 `None`.

    아이디가 없는 것과 비밀번호가 틀린 것을 **구분해 돌려주지 않는다.** 구분하면 로그인
    화면이 곧 "이 아이디가 존재하는가" 를 묻는 창구가 된다.
    """

    def __init__(
        self,
        *,
        users: UserRepositoryPort,
        credentials: PasswordCredentialRepositoryPort,
        hasher: PasswordHasherPort,
    ) -> None:
        self._users = users
        self._credentials = credentials
        self._hasher = hasher

    async def __call__(self, *, login: str, password: str) -> User | None:
        credential = await self._credentials.find_by_login(normalize_login(login))

        if credential is None:
            # 없는 아이디도 해시 한 번의 시간을 쓰고 나간다. 바로 돌려보내면 응답이
            # 눈에 띄게 빨라서, 응답 시간만으로 어떤 아이디가 실재하는지 알아낼 수 있다.
            await self._hasher.hash(password)
            return None

        if not await self._hasher.verify(
            password=password, hashed=credential.password_hash
        ):
            return None

        return await self._users.get(credential.user_id)
