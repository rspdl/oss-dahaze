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


class Locked(Conflict):
    """다른 보유자가 잠근 파일을 바꾸려 했다 (ADR-0008).

    AI는 이 오류를 받으면 사용자에게 알리고 턴을 끝낸다. 누가 잡고 있는지 알려야
    사용자가 기다릴지 판단할 수 있다.
    """

    def __init__(self, message: str, *, paths: list[str], holders: list[str]) -> None:
        super().__init__(message)
        self.paths = paths
        self.holders = holders


class FolderNotEmpty(Conflict):
    """비어 있지 않은 폴더를 재귀 삭제 없이 지우려 했다.

    에이전트 계층은 이 오류를 사용자 승인 요청으로 바꾼다. 유스케이스는 승인을 모른다.
    """

    def __init__(self, message: str, *, path: str, entries: int) -> None:
        super().__init__(message)
        self.path = path
        self.entries = entries
