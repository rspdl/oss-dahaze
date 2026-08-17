"""저장소에서 `rspdl` 을 import 하는 유일한 파일. `RspdlCompilerPort` 의 인프로세스 구현체.

RSPDL 버전 변경의 폭발 반경을 이 파일 하나로 묶는다 (ADR-0001, ADR-0002).
다른 어떤 모듈도 `rspdl` 을 import 해서는 안 되며, CI 가 이를 검사한다.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any

import rspdl

from dahaze_api.domain.rspdl import (
    AnalysisKind,
    AnalysisOutcome,
    RspdlRuntime,
    RspdlSource,
)

# 컴파일러가 실제로 결과를 만들 때까지 기다릴 기본 한도.
# RSPDL 은 timeout 을 성공으로 근사하지 않고 `unknown` 으로 남기므로, 이 값을 넘기면
# 실패가 아니라 "모른다"는 결과가 돌아온다.
DEFAULT_TIMEOUT_MS = 5_000
DEFAULT_SCOPE_PER_MODEL = 3


def _to_sdk_sources(sources: Sequence[RspdlSource]) -> list[rspdl.Source]:
    return [{"path": s.path, "text": s.text} for s in sources]


class LocalRspdlCompiler:
    """설치된 `rspdl` 패키지를 이 프로세스 안에서 호출한다.

    SDK 함수들은 동기다. 네이티브 구간에서 GIL 을 놓지만, 코루틴에서 직접 부르면 이벤트
    루프가 그 시간만큼 멈춘다. 그래서 전부 스레드로 넘긴다 — GIL 이 풀리므로 스레드가
    실제 병렬성을 준다.
    """

    def __init__(self, *, locale: str = rspdl.SUPPORTED_LOCALE) -> None:
        if locale != rspdl.SUPPORTED_LOCALE:
            raise ValueError(
                f"rspdl {rspdl.__version__} 은 locale {rspdl.SUPPORTED_LOCALE!r} 만 지원한다 "
                f"(요청: {locale!r})"
            )
        self._runtime = RspdlRuntime(
            rspdl_version=rspdl.__version__,
            wire_schema_version=rspdl.WIRE_SCHEMA_VERSION,
            locale=locale,
        )

    @property
    def runtime(self) -> RspdlRuntime:
        return self._runtime

    async def compile(self, sources: Sequence[RspdlSource]) -> AnalysisOutcome:
        response = await asyncio.to_thread(
            rspdl.compile,
            _to_sdk_sources(sources),
            locale=self._runtime.locale,
        )
        return self._wrap(AnalysisKind.COMPILE, response)

    async def check(
        self,
        sources: Sequence[RspdlSource],
        data: Mapping[str, Any],
    ) -> AnalysisOutcome:
        response = await asyncio.to_thread(
            rspdl.check,
            _to_sdk_sources(sources),
            data,
            locale=self._runtime.locale,
            timeout_ms=DEFAULT_TIMEOUT_MS,
        )
        return self._wrap(AnalysisKind.CHECK, response)

    async def find_model(
        self,
        source: RspdlSource,
        *,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> AnalysisOutcome:
        response = await asyncio.to_thread(
            rspdl.find_model,
            {"path": source.path, "text": source.text},
            locale=self._runtime.locale,
            scope_per_model=scope_per_model or DEFAULT_SCOPE_PER_MODEL,
            timeout_ms=timeout_ms or DEFAULT_TIMEOUT_MS,
        )
        return self._wrap(AnalysisKind.FIND_MODEL, response)

    def _wrap(self, kind: AnalysisKind, response: rspdl.SdkResponse) -> AnalysisOutcome:
        """SDK 응답을 도메인 결과로 감싼다. `result` 는 손대지 않는다.

        `schema_version` 은 확인만 한다. 우리가 모르는 스키마가 오면 조용히 통과시키는 대신
        여기서 멈춘다 — 잘못 해석한 결과를 저장하는 것이 실패보다 나쁘다.
        """
        actual = response["schema_version"]
        if actual != self._runtime.wire_schema_version:
            raise RuntimeError(
                f"예상하지 않은 rspdl wire schema {actual} "
                f"(기대: {self._runtime.wire_schema_version})"
            )
        return AnalysisOutcome(
            kind=kind,
            runtime=self._runtime,
            result=response["result"],
        )
