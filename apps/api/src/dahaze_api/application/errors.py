"""유스케이스가 내는 오류.

HTTP 를 모른다. 상태 코드로 옮기는 것은 `interface/rest/` 의 일이다.
"""

from __future__ import annotations


class ApplicationError(Exception):
    """유스케이스 실패의 최상위 타입."""


class NotFound(ApplicationError):
    """대상이 없거나, 요청자에게 보여줄 수 없다.

    권한 없음과 없음을 구분하지 않는다. 구분하면 남의 프로젝트가 존재한다는 사실이
    새어 나간다.
    """


class AccessDenied(ApplicationError):
    """대상은 보이지만 이 동작을 할 권한이 없다."""


class Conflict(ApplicationError):
    """이미 존재하거나 현재 상태와 모순된다."""
