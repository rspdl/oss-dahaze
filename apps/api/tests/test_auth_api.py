"""개발용 비밀번호 로그인의 HTTP 계약 테스트.

여기서 지켜야 할 것은 두 가지고, 둘의 무게가 다르다.

1. **development 밖에서는 열리지 않는다.** 비밀번호 하나로 아무 계정이나 만들 수 있는
   문이므로, 이 검사가 무너지면 나머지 인증이 전부 무의미해진다.
2. 아이디가 계정을 가른다. 같은 아이디로 다시 들어오면 같은 사람이어야 로컬에서
   공유·권한 화면을 확인할 수 있다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.config import Settings, get_settings
from dahaze_api.infrastructure.db.session import get_session
from dahaze_api.interface.rest.dependencies import SESSION_COOKIE
from dahaze_api.main import create_app

PASSWORD = "dahaze"


def _client(session: AsyncSession, settings: Settings) -> httpx.AsyncClient:
    """설정을 갈아끼운 익명 클라이언트.

    `conftest` 의 `anon_client` 를 쓰지 않는 이유는 설정을 바꿔야 하기 때문이다. 여기서
    검사하는 것이 "프로덕션 설정에서는 문이 없다" 라, 설정이 고정된 클라이언트로는 그
    질문을 물어볼 수 없다. `get_current_user` 는 덮어쓰지 않는다 — 진짜 쿠키가 진짜로
    통하는지가 이 파일의 관심사다.
    """
    app = create_app()

    async def _session_override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _session_override
    app.dependency_overrides[get_settings] = lambda: settings

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _dev_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "environment": "development",
        "dev_login_password": PASSWORD,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.fixture
async def dev_client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(session, _dev_settings()) as c:
        yield c


# ------------------------------------------------------------------ 열림 여부


async def test_providers_announces_dev_login(dev_client: httpx.AsyncClient) -> None:
    """프론트는 서버가 알려준 방법만 그린다. 폼을 하드코딩하지 않게 한다."""
    body = (await dev_client.get("/api/auth/providers")).json()

    assert body["dev_login"] is True
    # OAuth 자격증명은 없으므로 제공자 목록은 비어 있다. 둘은 서로 무관하다.
    assert body["providers"] == []


async def test_dev_login_is_closed_outside_development(
    session: AsyncSession,
) -> None:
    """**이 테스트가 이 기능의 안전장치다.**

    비밀번호가 설정돼 있어도 environment 가 development 가 아니면 문 자체가 없다.
    """
    settings = _dev_settings(
        environment="production",
        session_secret="a" * 32,
        cookie_secure=True,
    )
    assert settings.dev_login_enabled is False

    async with _client(session, settings) as client:
        response = await client.post(
            "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
        )
        assert response.status_code == 404

        providers = (await client.get("/api/auth/providers")).json()
        assert providers["dev_login"] is False


async def test_dev_login_is_closed_when_password_is_blank(
    session: AsyncSession,
) -> None:
    """공유된 개발 서버에서 문을 닫는 유일한 스위치."""
    async with _client(session, _dev_settings(dev_login_password="")) as client:
        response = await client.post(
            "/api/auth/dev/login", json={"username": "tester", "password": ""}
        )
        assert response.status_code == 422  # 빈 비밀번호는 스키마가 먼저 막는다

        providers = (await client.get("/api/auth/providers")).json()
        assert providers["dev_login"] is False


# -------------------------------------------------------------------- 로그인


async def test_dev_login_creates_user_and_session(
    dev_client: httpx.AsyncClient,
) -> None:
    response = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )

    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "tester"
    assert SESSION_COOKIE in response.cookies

    # 발급한 쿠키가 실제로 통해야 로그인이다. 응답 본문만 맞고 세션이 안 서면 화면에서는
    # 로그인 직후 다시 로그아웃 상태가 된다.
    me = await dev_client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["id"] == response.json()["id"]


async def test_dev_login_has_no_fabricated_email(
    dev_client: httpx.AsyncClient,
) -> None:
    """없는 정보를 지어내지 않는다. 화면에서 진짜 이메일과 구분되지 않게 된다."""
    response = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )

    assert response.json()["email"] is None
    assert response.json()["avatar_url"] is None


async def test_same_username_returns_same_user(
    dev_client: httpx.AsyncClient,
) -> None:
    first = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )
    second = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )

    assert first.json()["id"] == second.json()["id"]


async def test_username_ignores_case_and_surrounding_space(
    dev_client: httpx.AsyncClient,
) -> None:
    """`Tester` 로 만든 프로젝트가 `tester` 에게 안 보이면 로컬에서 디버깅이 불가능해진다."""
    first = await dev_client.post(
        "/api/auth/dev/login", json={"username": "  Tester ", "password": PASSWORD}
    )
    second = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )

    assert first.json()["id"] == second.json()["id"]


async def test_different_usernames_are_different_people(
    dev_client: httpx.AsyncClient,
) -> None:
    """공유·권한 화면을 로컬에서 확인하려면 계정이 둘 이상 필요하다."""
    first = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": PASSWORD}
    )
    second = await dev_client.post(
        "/api/auth/dev/login", json={"username": "stranger", "password": PASSWORD}
    )

    assert first.json()["id"] != second.json()["id"]


# ---------------------------------------------------------------------- 거절


@pytest.mark.parametrize("wrong", ["not-the-password", "틀린값", "dahaz", "dahazee"])
async def test_wrong_password_is_rejected(
    dev_client: httpx.AsyncClient, wrong: str
) -> None:
    """한글이 섞인 값도 401 이어야 한다.

    `secrets.compare_digest` 는 비ASCII `str` 을 받으면 예외를 던진다. 바이트로 넘기지
    않으면 여기서 500 이 난다 — 실제로 이 테스트가 그 버그를 잡았다.
    """
    response = await dev_client.post(
        "/api/auth/dev/login", json={"username": "tester", "password": wrong}
    )

    assert response.status_code == 401
    assert SESSION_COOKIE not in response.cookies


async def test_blank_username_is_rejected(dev_client: httpx.AsyncClient) -> None:
    """스키마의 `min_length` 는 공백만 든 문자열을 막지 못한다."""
    response = await dev_client.post(
        "/api/auth/dev/login", json={"username": "   ", "password": PASSWORD}
    )

    assert response.status_code == 401


async def test_missing_field_is_a_422(dev_client: httpx.AsyncClient) -> None:
    response = await dev_client.post("/api/auth/dev/login", json={"username": "tester"})

    assert response.status_code == 422
