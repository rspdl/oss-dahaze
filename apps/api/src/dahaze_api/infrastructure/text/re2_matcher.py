"""`PatternMatcherPort` 의 RE2 구현체.

Python `re` 는 역추적 엔진이라 `(a+)+$` 같은 패턴 하나가 워커 스레드를 끝없이 붙잡는다.
grep 패턴은 사용자와 AI 가 넣으므로 선형 시간 엔진인 RE2 를 쓴다.
"""

from __future__ import annotations

from collections.abc import Callable

import re2

from dahaze_api.domain.tree import InvalidPattern

MAX_PATTERN_LENGTH = 1_000


def _options() -> re2.Options:
    options = re2.Options()
    # 잘못된 패턴은 호출자에게 오류로 돌려준다. RE2 가 stderr 에 따로 로그를 남기지 않게 한다.
    options.log_errors = False
    return options


class Re2PatternMatcher:
    def compile(self, pattern: str) -> Callable[[str], bool]:
        if not pattern:
            raise InvalidPattern("패턴이 비어 있다")
        if len(pattern) > MAX_PATTERN_LENGTH:
            raise InvalidPattern(f"패턴은 {MAX_PATTERN_LENGTH}자 이하여야 한다")
        try:
            compiled = re2.compile(pattern, options=_options())
        except re2.error as exc:
            detail = exc.args[0] if exc.args else exc
            if isinstance(detail, bytes):
                detail = detail.decode("utf-8", "replace")
            raise InvalidPattern(f"정규식을 해석할 수 없다: {detail}") from exc
        return lambda line: compiled.search(line) is not None
