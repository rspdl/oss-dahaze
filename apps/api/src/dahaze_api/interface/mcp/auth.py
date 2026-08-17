"""MCP Bearer 인증.

MCP 클라이언트는 브라우저가 아니어서 세션 쿠키를 쓸 수 없다. 완전한 MCP OAuth 2.1 흐름은
별도 과제이므로, 1차는 dahaze 가 발급한 Bearer 토큰 하나로 한다 (ADR-0005).

토큰은 세션과 **다른 audience** 로 서명되어 있다. 그래서 세션 쿠키를 그대로 MCP 에
들이밀 수 없고, 반대로 MCP 토큰으로 REST 세션을 흉내 낼 수도 없다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from uuid import UUID

from starlette.types import ASGIApp, Receive, Scope, Send

from dahaze_api.infrastructure.auth.session import InvalidToken, SessionTokens

_SCHEME = "bearer "
# 401 에 이 헤더가 없으면 클라이언트는 "서버가 고장났다" 와 "자격증명을 붙여라" 를 구분할 수
# 없다. 아직 OAuth 메타데이터가 없으므로 스킴만 알린다.
WWW_AUTHENTICATE = 'Bearer realm="dahaze-mcp"'


class McpAuthError(Exception):
    """토큰이 없거나, 서명·만료·audience 중 하나가 맞지 않는다."""


def bearer_token(headers: Mapping[str, str] | None) -> str:
    """`Authorization: Bearer <token>` 에서 토큰만 꺼낸다.

    헤더 이름은 대소문자를 가리지 않는다 — 전송 계층마다 정규화 방식이 다르므로
    여기서 한 번 흡수한다.
    """
    if not headers:
        raise McpAuthError("Authorization 헤더가 없다")
    raw = next(
        (v for k, v in headers.items() if k.lower() == "authorization"),
        None,
    )
    if not raw or not raw.lower().startswith(_SCHEME):
        raise McpAuthError("Authorization: Bearer <token> 형식이어야 한다")
    token = raw[len(_SCHEME) :].strip()
    if not token:
        raise McpAuthError("Bearer 토큰이 비어 있다")
    return token


def authenticated_user_id(
    headers: Mapping[str, str] | None, *, tokens: SessionTokens
) -> UUID:
    """토큰이 지목하는 사용자 id.

    행위자를 토큰에서만 얻는다. 도구 인자로 받으면 호출자가 남의 id 를 적어 넣을 수 있다.
    """
    try:
        return tokens.verify_mcp(bearer_token(headers))
    except InvalidToken as exc:
        # 왜 실패했는지(만료인지 서명 불일치인지)를 밖으로 흘리지 않는다.
        raise McpAuthError("MCP 토큰이 유효하지 않다") from exc


class BearerAuthMiddleware:
    """MCP 전송 앞단의 인증 게이트.

    도구도 각자 토큰으로 행위자를 확인하지만 (그쪽이 접근 검사의 진짜 경로다), 자격증명이
    아예 없는 요청은 MCP 핸드셰이크까지 가기 전에 401 로 끊는다. 그래야 클라이언트가
    "도구가 실패했다" 가 아니라 "인증하라" 로 읽는다.
    """

    def __init__(self, app: ASGIApp, *, tokens: SessionTokens) -> None:
        self._app = app
        self._tokens = tokens

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1"): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        try:
            authenticated_user_id(headers, tokens=self._tokens)
        except McpAuthError as exc:
            await _unauthorized(str(exc), send)
            return

        await self._app(scope, receive, send)


async def _unauthorized(detail: str, send: Send) -> None:
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", WWW_AUTHENTICATE.encode("latin-1")),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
