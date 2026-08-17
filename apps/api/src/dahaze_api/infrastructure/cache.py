"""분석 캐시 어댑터.

캐시에 든 것은 전부 컴파일러로 재생성할 수 있다 (ADR-0003). 그래서 비워도 데이터 손실이
아니고, 프로세스 메모리에서 시작해도 정합성 문제가 생기지 않는다.
"""

from __future__ import annotations

from collections import OrderedDict

from dahaze_api.domain.rspdl import AnalysisOutcome


class InMemoryAnalysisCache:
    """프로세스 안의 LRU 캐시.

    편집 중에는 같은 텍스트가 연달아 컴파일 요청되는 일이 잦다. 그 반복만 걸러도
    체감 지연이 크게 준다.
    """

    def __init__(self, *, max_entries: int = 512) -> None:
        self._entries: OrderedDict[str, AnalysisOutcome] = OrderedDict()
        self._max_entries = max_entries

    async def get(self, cache_key: str) -> AnalysisOutcome | None:
        outcome = self._entries.get(cache_key)
        if outcome is not None:
            self._entries.move_to_end(cache_key)
        return outcome

    async def put(self, cache_key: str, outcome: AnalysisOutcome) -> None:
        self._entries[cache_key] = outcome
        self._entries.move_to_end(cache_key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
