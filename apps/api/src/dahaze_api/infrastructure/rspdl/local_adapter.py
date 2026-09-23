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
    InvalidRspdlEditRequest,
    RspdlEditOutcome,
    RspdlRuntime,
    RspdlSource,
    source_fingerprint,
)

# 컴파일러가 실제로 결과를 만들 때까지 기다릴 기본 한도.
# RSPDL 은 timeout 을 성공으로 근사하지 않고 `unknown` 으로 남기므로, 이 값을 넘기면
# 실패가 아니라 "모른다"는 결과가 돌아온다.
DEFAULT_TIMEOUT_MS = 5_000
DEFAULT_SCOPE_PER_MODEL = 3
PLANNING_CONTRACTS_CAPABILITY = "rspdl.planning-contracts.v1"

_PLANNING_PROBE = """---
모듈: 예약(booking)
화면:
  예약 등록 화면:
    레이아웃:
      - 폼:
          id: registration_form
          입력:
            - 입력: { id: registration_contact, 필드: 연락처 }
      - 버튼: { id: next, 이름: "조회로 이동" }
  예약 화면:
    역할: [고객]
    권한:
      - 역할: 고객
        행동: 조회
        모델: 예약
        필드: 연락처
    레이아웃:
      - 버튼: { id: lookup, 이름: "조회", 행동: 조회 }
  예약 완료 화면:
    레이아웃:
      - 제목: { id: completed_title, 글: "완료" }
조회 결과:
  reservation_lookup:
    행동: 조회
    입력: 대상 예약
    모델: 예약
    필드: [연락처]
행동 결과:
  조회:
    - id: found
      유형: 성공
      제공 데이터:
        - 모델: 예약
          필드: 연락처
          조회 결과: reservation_lookup
    - id: not_found
      유형: 실패
      복구: { 종류: retry, 화면: 예약 화면, 요소: lookup, 행동: 조회 }
흐름:
  - id: booking.start_path
    출발: 예약 등록 화면.next
    도착: 예약 화면
  - id: booking.found_path
    출발: 예약 화면.lookup
    결과: found
    도착: 예약 완료 화면
  - 출발: 예약 화면.lookup
    결과: not_found
    처리:
      종류: 메시지
      id: missing
      내용: "예약을 찾지 못했습니다."
업무:
  예약 완료(complete):
    시작: 예약 화면
    완료:
      - 화면: 예약 완료 화면
        필수 데이터:
          - 모델: 예약
            필드: 연락처
---

예약(reservation)은 다음 필드들로 구성되어 있다.
    연락처(contact): 필수 문자열

고객(customer)은 역할이다.
조회(lookup)는 행동이다.
`조회`는 기존 `예약`을 대상 예약(target_reservation)으로 입력받는다.
`고객`은 `예약`의 `연락처`를 `조회`할 수 있다.
예약 등록 화면(create_screen)에서는 `예약`을 생성할 수 있다.
예약 등록 화면(create_screen)에서는 `예약`의 `연락처`를 입력할 수 있다.
예약 화면(lookup_screen)에서는 `예약`의 `연락처`를 조회할 수 있다.
예약 완료 화면(done_screen)에서는 `예약`의 `연락처`를 조회할 수 있다.
"""


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
        self._capabilities: frozenset[str] | None = None

    @property
    def runtime(self) -> RspdlRuntime:
        return self._runtime

    async def capabilities(self) -> frozenset[str]:
        if self._capabilities is not None:
            return self._capabilities
        outcome = await self.compile(
            [RspdlSource(path="planning-capability-probe.rspdl", text=_PLANNING_PROBE)]
        )
        files = outcome.result.get("files")
        supported = False
        if isinstance(files, list) and len(files) == 1 and isinstance(files[0], Mapping):
            file = files[0]
            diagnostics = file.get("diagnostics")
            module = file.get("module")
            no_diagnostics = diagnostics == []
            supported = (
                no_diagnostics
                and isinstance(module, Mapping)
                and all(
                    isinstance(module.get(key), list) and len(module[key]) > 0
                    for key in ("action_outcomes", "lookup_results", "workflows")
                )
            )
        self._capabilities = (
            frozenset({PLANNING_CONTRACTS_CAPABILITY}) if supported else frozenset()
        )
        return self._capabilities

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

    async def edit(
        self,
        source: RspdlSource,
        *,
        expected_source_hash: str,
        edit: Mapping[str, Any],
    ) -> RspdlEditOutcome:
        """컴파일러가 지원할 때만 구조화 편집을 호출한다.

        rspdl 0.1.2 같은 이전 핀에서는 기능이 없음을 명시적으로 돌려준다. dahaze 쪽에서
        YAML 을 파싱하거나 문자열 치환으로 후보를 추측하지 않는다.
        """
        sdk_edit = getattr(rspdl, "edit", None)
        if not callable(sdk_edit):
            return RspdlEditOutcome(
                runtime=self._runtime,
                supported=False,
                response=None,
                unsupported_reason=(
                    f"rspdl {self._runtime.rspdl_version} does not provide structured editing"
                ),
            )
        edit_schema_version = getattr(rspdl, "EDIT_SCHEMA_VERSION", None)
        if not isinstance(edit_schema_version, int):
            raise RuntimeError("rspdl structured editing is missing EDIT_SCHEMA_VERSION")
        try:
            response = await asyncio.to_thread(
                sdk_edit,
                {
                    "schema_version": edit_schema_version,
                    "locale": self._runtime.locale,
                    "source": {"path": source.path, "text": source.text},
                    "expected_source_hash": expected_source_hash,
                    "edit": dict(edit),
                },
            )
        except ValueError as exc:
            # 최신 binding은 request decode 오류를 내부 RuntimeError와 구분한다.
            raise InvalidRspdlEditRequest(str(exc)) from exc
        except RuntimeError as exc:
            # Native boundary가 schema decode 오류를 RuntimeError 로 노출한다. 이는 서버 장애가
            # 아니라 호출자가 고칠 수 있는 구조 오류이므로 인터페이스가 422/tool error로 옮긴다.
            # 응답 직렬화 같은 내부 실패도 같은 Python 타입을 쓰므로 안정적인 SDK 오류 코드만
            # 좁게 분류하고 나머지는 그대로 서버 실패로 올린다.
            if str(exc).startswith("RSPDL-SDK-001:"):
                raise InvalidRspdlEditRequest(str(exc)) from exc
            raise
        if not isinstance(response, Mapping):
            raise RuntimeError("rspdl edit response is not an object")
        if response.get("schema_version") != edit_schema_version:
            raise RuntimeError(
                "unexpected rspdl edit schema "
                f"{response.get('schema_version')!r} (expected: {edit_schema_version})"
            )
        if response.get("wire_schema_version") != self._runtime.wire_schema_version:
            raise RuntimeError("rspdl edit response wire schema does not match the active runtime")
        if (
            response.get("rspdl_version") != self._runtime.rspdl_version
            or response.get("locale") != self._runtime.locale
        ):
            raise RuntimeError("rspdl edit response runtime identity does not match")
        if response.get("source_hash") != source_fingerprint(source.text):
            raise RuntimeError("rspdl edit response source hash does not match the input")
        outcome = response.get("outcome")
        if not isinstance(outcome, Mapping) or outcome.get("status") not in {
            "applied",
            "rejected",
        }:
            raise RuntimeError("rspdl edit response has an invalid outcome")
        return RspdlEditOutcome(
            runtime=self._runtime,
            supported=True,
            response=response,
        )

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
