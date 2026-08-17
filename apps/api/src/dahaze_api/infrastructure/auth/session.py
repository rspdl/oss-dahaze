"""세션 토큰 발급·검증과 OAuth state 서명.

세션은 서버 상태 없이 서명된 쿠키 하나로 표현한다. `app.dahaze.xyz` 와 `api.dahaze.xyz` 가
상위 도메인 쿠키를 공유하므로 (ADR-0004) 별도의 세션 저장소가 필요 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

ALGORITHM = "HS256"
SESSION_AUDIENCE = "dahaze:session"
STATE_AUDIENCE = "dahaze:oauth-state"

SESSION_TTL = timedelta(days=14)
# state 는 로그인 왕복에만 쓰인다. 짧게 잡아 재사용 창을 줄인다.
STATE_TTL = timedelta(minutes=10)


class InvalidToken(Exception):
    """서명·만료·audience 중 하나가 맞지 않는다."""


class SessionTokens:
    def __init__(self, secret: str) -> None:
        self._secret = secret

    # --- 세션 ---

    def issue(self, user_id: UUID) -> str:
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "sub": str(user_id),
                "aud": SESSION_AUDIENCE,
                "iat": now,
                "exp": now + SESSION_TTL,
            },
            self._secret,
            algorithm=ALGORITHM,
        )

    def verify(self, token: str) -> UUID:
        try:
            payload = jwt.decode(
                token, self._secret, algorithms=[ALGORITHM], audience=SESSION_AUDIENCE
            )
            return UUID(payload["sub"])
        except (jwt.PyJWTError, KeyError, ValueError) as exc:
            raise InvalidToken(str(exc)) from exc

    # --- OAuth state ---

    def issue_state(self, *, provider: str, redirect_to: str) -> str:
        """CSRF 방어용 state.

        서명된 토큰을 쓰면 서버에 state 를 저장하지 않아도 되고, 콜백에서 어느 제공자로
        시작한 요청인지와 로그인 후 돌아갈 곳까지 함께 실어 보낼 수 있다.
        """
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "provider": provider,
                "redirect_to": redirect_to,
                "aud": STATE_AUDIENCE,
                "iat": now,
                "exp": now + STATE_TTL,
            },
            self._secret,
            algorithm=ALGORITHM,
        )

    def verify_state(self, token: str) -> tuple[str, str]:
        """`(provider, redirect_to)` 를 돌려준다."""
        try:
            payload = jwt.decode(
                token, self._secret, algorithms=[ALGORITHM], audience=STATE_AUDIENCE
            )
            return str(payload["provider"]), str(payload["redirect_to"])
        except (jwt.PyJWTError, KeyError) as exc:
            raise InvalidToken(str(exc)) from exc
