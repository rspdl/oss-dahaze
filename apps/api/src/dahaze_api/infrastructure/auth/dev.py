"""개발 환경 전용 비밀번호 로그인.

기여자가 GitHub OAuth App 을 먼저 만들지 않고도 클론한 지 몇 분 만에 로그인해 화면을 볼 수
있게 하는 문이다. 오픈소스에서 첫 실행이 막히는 가장 흔한 이유가 로그인 설정이다.

**이 문은 development 에서만 열린다.** 열림 여부가 `Settings.dev_login_enabled` 에서 오고,
그 값은 `is_development` 에서 파생되므로 환경변수만으로 프로덕션에서 켜는 방법이 없다.

비밀번호는 하나이고 아이디는 아무거나 받는다. 여기서 하는 일이 신원 확인이 아니라
**여러 사람을 흉내 내는 것** 이기 때문이다 — 프로젝트 공유나 권한 검사를 로컬에서 확인하려면
계정이 둘 이상 필요하다. 아이디가 곧 계정 식별자라 같은 아이디로 다시 들어오면 같은
사용자가 되고, 다른 아이디를 대면 다른 사용자가 된다.

OAuth 어댑터와 같은 port 를 구현하지 않는다. `authorize_url` · `exchange_code` 는 리다이렉트
왕복이 있는 흐름의 이름인데 여기에는 왕복이 없다. 모양만 맞추려고 빈 메서드를 두면 그 port 를
읽는 사람이 없는 흐름을 상상하게 된다.
"""

from __future__ import annotations

import secrets

from dahaze_api.domain.entities import ExternalIdentity

PROVIDER = "dev"


class DevPasswordAuthenticator:
    def __init__(self, *, password: str) -> None:
        self._password = password

    @property
    def provider(self) -> str:
        return PROVIDER

    def authenticate(self, *, username: str, password: str) -> ExternalIdentity | None:
        """맞으면 신원, 틀리면 `None`.

        아이디와 비밀번호 중 무엇이 틀렸는지 구분해 돌려주지 않는다. 로컬 전용이라도
        인증 코드의 기본 예의는 지킨다 — 복사돼 다른 곳에 쓰이는 것이 이런 코드다.
        """
        login = username.strip().lower()
        if not login:
            return None

        # 비교에 걸린 시간으로 비밀번호를 한 글자씩 알아내지 못하게 한다.
        # 바이트로 인코딩해서 넘긴다 — `compare_digest` 는 비ASCII 문자가 든 `str` 을 받으면
        # `TypeError` 를 던지고, 그러면 한글 비밀번호를 틀리게 친 사람이 401 이 아니라 500 을
        # 보게 된다.
        if not secrets.compare_digest(
            password.encode("utf-8"), self._password.encode("utf-8")
        ):
            return None

        return ExternalIdentity(
            provider=PROVIDER,
            provider_user_id=login,
            login=login,
            # 이메일과 아바타를 지어내지 않는다. 없는 정보를 그럴듯하게 채우면 화면에서
            # 진짜 값과 구분되지 않고, 언젠가 그 가짜 주소로 메일을 보내게 된다.
            email=None,
            avatar_url=None,
        )
