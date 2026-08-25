"""아이디·비밀번호 로그인과 회원가입의 HTTP 계약 테스트.

여기서 지켜야 할 것:

1. **환경에 따라 문이 달라지지 않는다.** development 에서 되는 로그인은 production 에서도
   똑같이 된다. 예전에는 개발 전용 로그인이 따로 있었고, 그래서 로컬에서 보는 로그인
   화면과 배포된 화면이 달랐다.
2. 실패 이유를 나눠 말하지 않는다. "없는 아이디" 와 "틀린 비밀번호" 가 구분되면 로그인
   화면이 곧 계정 존재 여부를 묻는 창구가 된다.
3. 아이디의 대소문자와 앞뒤 공백은 무시한다. `Jiwon` 으로 가입한 사람이 `jiwon` 으로 못
   들어오면 무엇을 잘못 쳤는지 알 방법이 없다.
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

PASSWORD = "correct horse battery"


def _client(session: AsyncSession, settings: Settings) -> httpx.AsyncClient:
    """설정을 갈아끼운 익명 클라이언트.

    `conftest` 의 `anon_client` 를 쓰지 않는 이유는 설정을 바꿔야 하기 때문이다. 여기서
    검사하는 것 중 하나가 "프로덕션 설정에서도 같은 문이 열린다" 라, 설정이 고정된
    클라이언트로는 그 질문을 물어볼 수 없다. `get_current_user` 는 덮어쓰지 않는다 —
    진짜 쿠키가 진짜로 통하는지가 이 파일의 관심사다.
    """
    app = create_app()

    async def _session_override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _session_override
    app.dependency_overrides[get_settings] = lambda: settings

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _settings(**overrides: object) -> Settings:
    """이 파일이 쓰는 설정. **개발자 기계의 `.env` 를 물려받지 않는다.**

    `Settings` 는 넘기지 않은 항목을 `.env` 에서 채운다. OAuth 자격증명을 여기서 명시적으로
    비우지 않으면, GitHub OAuth App 을 로컬에 설정해 둔 사람의 기계에서만 제공자 목록이
    비어 있지 않게 되어 같은 커밋이 기계마다 다른 결과를 낸다.
    """
    base: dict[str, object] = {
        "environment": "development",
        "github_client_id": None,
        "github_client_secret": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _production_settings() -> Settings:
    return _settings(
        environment="production",
        session_secret="a" * 32,
        cookie_secure=True,
    )


@pytest.fixture
async def client(session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(session, _settings()) as c:
        yield c


async def _register(
    client: httpx.AsyncClient,
    *,
    login: str = "jiwon",
    password: str = PASSWORD,
    display_name: str = "김지원",
) -> httpx.Response:
    return await client.post(
        "/api/auth/register",
        json={"login": login, "password": password, "display_name": display_name},
    )


# -------------------------------------------------------------- 제공자 목록


async def test_providers_lists_only_oauth(client: httpx.AsyncClient) -> None:
    """아이디·비밀번호는 목록에 없다. 항상 열려 있어 알려줄 것이 없다."""
    body = (await client.get("/api/auth/providers")).json()

    assert body == {"providers": []}


async def test_providers_follow_configured_credentials(session: AsyncSession) -> None:
    """제공자 목록은 **주입된 설정** 에서 나온다. 프로세스 전역 설정이 아니다.

    registry 에 `lru_cache` 가 붙어 있으면 이 테스트가 실패한다 — 캐시된 registry 는
    `get_settings` 오버라이드를 무시하고 개발자 기계의 `.env` 를 계속 읽는다.
    """
    settings = _settings(
        github_client_id="test-client-id",
        github_client_secret="test-client-secret",
    )
    async with _client(session, settings) as c:
        body = (await c.get("/api/auth/providers")).json()

    assert body["providers"] == ["github"]


# ------------------------------------------------------------------ 회원가입


async def test_register_creates_user_and_session(client: httpx.AsyncClient) -> None:
    response = await _register(client)

    assert response.status_code == 201, response.text
    assert response.json()["display_name"] == "김지원"
    assert SESSION_COOKIE in response.cookies

    # 발급한 쿠키가 실제로 통해야 로그인이다. 응답 본문만 맞고 세션이 안 서면 화면에서는
    # 가입 직후 다시 로그아웃 상태가 된다.
    me = await client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["id"] == response.json()["id"]


async def test_register_does_not_fabricate_contact_details(
    client: httpx.AsyncClient,
) -> None:
    """받지 않은 정보를 지어내지 않는다. 화면에서 진짜 값과 구분되지 않게 된다."""
    body = (await _register(client)).json()

    assert body["email"] is None
    assert body["avatar_url"] is None


async def test_taken_login_is_a_conflict(client: httpx.AsyncClient) -> None:
    assert (await _register(client, login="jiwon")).status_code == 201

    second = await _register(client, login="jiwon")
    assert second.status_code == 409
    assert SESSION_COOKIE not in second.cookies


async def test_taken_login_ignores_case(client: httpx.AsyncClient) -> None:
    """`Jiwon` 을 내주면 `jiwon` 으로 들어오는 사람과 계정이 갈린다."""
    assert (await _register(client, login="jiwon")).status_code == 201

    assert (await _register(client, login="JIWON")).status_code == 409


@pytest.mark.parametrize(
    "login", ["ab", "공백 있음", "hi there", "a" * 65, "quote'drop", "한글아이디"]
)
async def test_unusable_login_is_a_422(client: httpx.AsyncClient, login: str) -> None:
    assert (await _register(client, login=login)).status_code == 422


async def test_short_password_is_a_422(client: httpx.AsyncClient) -> None:
    """길이는 여기서 걸 수 있는 유일하고 확실한 조건이다."""
    assert (await _register(client, password="1234567")).status_code == 422


async def test_missing_field_is_a_422(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/auth/register", json={"login": "jiwon"})

    assert response.status_code == 422


# -------------------------------------------------------------------- 로그인


async def test_login_returns_the_same_user(client: httpx.AsyncClient) -> None:
    registered = await _register(client)

    response = await client.post(
        "/api/auth/login", json={"login": "jiwon", "password": PASSWORD}
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == registered.json()["id"]
    assert SESSION_COOKIE in response.cookies

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == registered.json()["id"]


async def test_login_ignores_case_and_surrounding_space(
    client: httpx.AsyncClient,
) -> None:
    registered = await _register(client, login="jiwon")

    response = await client.post(
        "/api/auth/login", json={"login": "  JiWon ", "password": PASSWORD}
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == registered.json()["id"]


async def test_password_is_case_and_byte_sensitive(client: httpx.AsyncClient) -> None:
    """아이디와 달리 비밀번호는 정규화하지 않는다."""
    await _register(client)

    response = await client.post(
        "/api/auth/login", json={"login": "jiwon", "password": PASSWORD.upper()}
    )

    assert response.status_code == 401


async def test_non_ascii_password_round_trips(client: httpx.AsyncClient) -> None:
    """한글 비밀번호로 가입한 사람이 그 비밀번호로 들어올 수 있어야 한다.

    해시 입력을 바이트로 인코딩하지 않으면 여기서 500 이 난다.
    """
    await _register(client, password="정말긴비밀번호입니다")

    response = await client.post(
        "/api/auth/login", json={"login": "jiwon", "password": "정말긴비밀번호입니다"}
    )

    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------- 거절


@pytest.mark.parametrize("wrong", ["not-the-password", "틀린 비밀번호입니다", "correct hors"])
async def test_wrong_password_is_rejected(
    client: httpx.AsyncClient, wrong: str
) -> None:
    await _register(client)

    response = await client.post(
        "/api/auth/login", json={"login": "jiwon", "password": wrong}
    )

    assert response.status_code == 401
    assert SESSION_COOKIE not in response.cookies


async def test_unknown_login_is_rejected_the_same_way(
    client: httpx.AsyncClient,
) -> None:
    """없는 아이디와 틀린 비밀번호가 같은 응답이어야 계정 존재가 새지 않는다."""
    await _register(client, login="jiwon")

    unknown = await client.post(
        "/api/auth/login", json={"login": "nobody", "password": PASSWORD}
    )
    wrong = await client.post(
        "/api/auth/login", json={"login": "jiwon", "password": "wrong password"}
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


# ------------------------------------------------- 환경에 따라 달라지지 않는다


async def test_password_login_works_in_production(session: AsyncSession) -> None:
    """**이 테스트가 이 변경의 요점이다.**

    로그인 방법이 환경에 따라 달라지면 로컬에서 보는 화면과 배포된 화면이 달라진다.
    가입도 로그인도 production 설정에서 똑같이 열려 있어야 한다.
    """
    async with _client(session, _production_settings()) as c:
        registered = await c.post(
            "/api/auth/register",
            json={"login": "jiwon", "password": PASSWORD, "display_name": "김지원"},
        )
        assert registered.status_code == 201, registered.text

        signed_in = await c.post(
            "/api/auth/login", json={"login": "jiwon", "password": PASSWORD}
        )
        assert signed_in.status_code == 200, signed_in.text

        # `cookie_secure=True` 라 httpx 는 http:// 로 이 쿠키를 되돌려 보내지 않는다.
        # 그래서 후속 요청이 아니라 발급된 헤더를 본다 — 확인하려는 것은 "문이 열렸는가"
        # 이지, 브라우저의 쿠키 규칙이 아니다.
        assert "secure" in signed_in.headers["set-cookie"].lower()


async def test_provider_list_is_the_same_in_production(session: AsyncSession) -> None:
    """로그인 화면이 그리는 것은 이 응답이다. 환경에 따라 모양이 달라지지 않는다."""
    async with _client(session, _settings()) as dev:
        development = (await dev.get("/api/auth/providers")).json()
    async with _client(session, _production_settings()) as prod:
        production = (await prod.get("/api/auth/providers")).json()

    assert development == production
