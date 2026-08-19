"""운영 준비 가드.

세션 쿠키와 MCP 토큰이 모두 `session_secret` 하나로 서명된다. 배포에서 그 환경변수를
빠뜨리면 기본값으로 조용히 돌아가고, 그건 아무도 알아채지 못한 채 서명 키가 공개된
문자열이라는 뜻이 된다. 그래서 뜨지 않게 막는다.
"""

from __future__ import annotations

import pytest

from dahaze_api.config import DEFAULT_SESSION_SECRET, Settings

STRONG = "a" * 32


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "environment": "production",
        "session_secret": STRONG,
        "cookie_secure": True,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_production_ready_settings_pass() -> None:
    _settings().assert_production_ready()


def test_development_is_never_blocked() -> None:
    """로컬에서는 기본값 그대로 뜬다. 그러라고 있는 기본값이다."""
    _settings(
        environment="development",
        session_secret=DEFAULT_SESSION_SECRET,
        cookie_secure=False,
    ).assert_production_ready()


def test_default_secret_is_refused_outside_development() -> None:
    with pytest.raises(RuntimeError, match="기본값"):
        _settings(session_secret=DEFAULT_SESSION_SECRET).assert_production_ready()


def test_short_secret_is_refused() -> None:
    """RFC 7518 §3.2 의 HMAC-SHA256 권장 최소 길이."""
    with pytest.raises(RuntimeError, match="바이트 미만"):
        _settings(session_secret="a" * 31).assert_production_ready()


def test_insecure_cookie_is_refused() -> None:
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        _settings(cookie_secure=False).assert_production_ready()


def test_all_problems_are_reported_at_once() -> None:
    """하나 고치면 다음이 나오는 식이면 배포가 여러 번 실패한다."""
    with pytest.raises(RuntimeError) as caught:
        _settings(
            session_secret=DEFAULT_SESSION_SECRET, cookie_secure=False
        ).assert_production_ready()

    message = str(caught.value)
    assert "기본값" in message
    assert "바이트 미만" in message
    assert "COOKIE_SECURE" in message


# ------------------------------------------------------- 개발용 로그인의 문


def test_dev_login_cannot_be_opened_outside_development() -> None:
    """비밀번호가 설정돼 있어도 development 가 아니면 닫혀 있다.

    독립 스위치(`DEV_LOGIN_ENABLED`) 를 두지 않은 이유가 이것이다. 스위치가 있으면
    언젠가 누군가 프로덕션에서 켜고, 그 순간 비밀번호 하나로 아무 계정이나 만들 수 있게
    된다.
    """
    assert _settings(dev_login_password="dahaze").dev_login_enabled is False


def test_dev_login_is_open_by_default_in_development() -> None:
    """클론한 사람이 설정 없이 바로 로그인할 수 있어야 한다."""
    assert Settings(environment="development").dev_login_enabled is True


def test_blank_dev_password_closes_the_door() -> None:
    """공유된 개발 서버에서 문을 닫는 유일한 스위치."""
    assert (
        Settings(environment="development", dev_login_password="").dev_login_enabled
        is False
    )
