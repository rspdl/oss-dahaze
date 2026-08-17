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
# MCP 토큰은 세션과 다른 audience 로 서명한다. 하나가 새어도 다른 쪽에 쓸 수 없다 (ADR-0005).
MCP_AUDIENCE = "dahaze:mcp"

SESSION_TTL = timedelta(days=14)
# state 는 로그인 왕복에만 쓰인다. 짧게 잡아 재사용 창을 줄인다.
STATE_TTL = timedelta(minutes=10)
# MCP 클라이언트는 브라우저처럼 조용히 재로그인할 수 없다. 사람이 설정 파일에 붙여 넣는
# 자격증명이므로 세션보다 길게 잡는다. 다만 폐기 수단이 없어 TTL 이 유일한 제한이므로
# (ADR-0005) 무기한으로 두지는 않는다.
MCP_TTL = timedelta(days=90)


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

    # --- MCP ---

    def issue_mcp(self, user_id: UUID) -> str:
        """MCP 클라이언트가 `Authorization: Bearer` 로 제시할 토큰.

        세션 토큰과 같은 비밀로 서명하되 audience 가 다르다. 검증할 때 audience 를
        지정하므로, 세션 쿠키를 MCP 에 들이밀거나 그 반대로 하는 것이 둘 다 실패한다.
        """
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "sub": str(user_id),
                "aud": MCP_AUDIENCE,
                "iat": now,
                "exp": now + MCP_TTL,
            },
            self._secret,
            algorithm=ALGORITHM,
        )

    def verify_mcp(self, token: str) -> UUID:
        try:
            payload = jwt.decode(
                token, self._secret, algorithms=[ALGORITHM], audience=MCP_AUDIENCE
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
