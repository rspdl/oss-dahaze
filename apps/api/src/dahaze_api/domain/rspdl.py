"""RSPDL 상호작용의 값 객체.

이 모듈은 `rspdl` 을 import 하지 않는다. 컴파일러가 무엇을 돌려주는지의 **모양**은
컴파일러가 소유하며 `wire_schema_version` 으로 버전이 매겨진다 (ADR-0003).
여기서는 그 결과를 불투명한 JSON 으로 다루고, 재생성에 필요한 정체성만 붙인다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


@dataclass(frozen=True, slots=True)
class RspdlSource:
    """식별된 RSPDL 소스 문서 하나."""

    path: str
    text: str


@dataclass(frozen=True, slots=True)
class RspdlRuntime:
    """어떤 컴파일러가 결과를 만들었는지.

    모든 산출물에 이것을 함께 저장한다. 텍스트만 보고는 어느 문법으로 쓰였는지 복원할 수
    없으므로, 기록하지 않으면 나중에 채워 넣을 방법이 없다 (ADR-0002).
    """

    rspdl_version: str
    wire_schema_version: int
    locale: str


class AnalysisKind(StrEnum):
    """캐시 키를 이루는 분석 종류."""

    COMPILE = "compile"
    CHECK = "check"
    FIND_MODEL = "find_model"


@dataclass(frozen=True, slots=True)
class AnalysisOutcome:
    """컴파일러 응답 하나. `result` 는 SDK 가 준 그대로다.

    래퍼가 필드를 재작성하거나 재정렬하지 않는다. 결정론이 RSPDL 의 계약이고,
    중간에서 손대면 그 계약이 깨진다.
    """

    kind: AnalysisKind
    runtime: RspdlRuntime
    result: Mapping[str, Any]


def workspace_hash(
    sources: Sequence[RspdlSource],
    *,
    locale: str,
    extra: Mapping[str, Any] | None = None,
) -> str:
    """소스 집합의 안정적인 내용 해시. 컴파일 캐시의 키가 된다.

    경로순으로 정렬하므로 요청에 실린 순서가 달라도 같은 해시가 나온다. RSPDL 자체가
    입력 순서에 의존하지 않는 결정적 결과를 보장하므로, 캐시도 같은 성질을 가져야 한다.

    `extra` 는 결과를 바꾸는 부가 파라미터용이다 (예: find_model 의 scope_per_model).
    같은 소스라도 scope 에 따라 SAT / UNSAT_WITHIN_BOUND 가 갈리므로 키에 들어가야 한다.
    """
    payload = {
        "locale": locale,
        "sources": [
            {"path": s.path, "text": s.text} for s in sorted(sources, key=lambda s: s.path)
        ],
        "extra": dict(sorted((extra or {}).items())),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class TextPosition:
    """원문 위치. 줄과 열은 1부터 세고, 열은 유니코드 코드 포인트 단위다."""

    line: int
    column: int


def byte_offset_to_position(text: str, offset: int) -> TextPosition:
    """UTF-8 byte 오프셋 → 줄·열.

    RSPDL 의 span 은 UTF-8 byte 오프셋이다 (ADR-0006). 한국어 원문에서 문자 인덱스로 쓰면
    위치가 어긋난다. 문자 중간이나 범위 밖을 가리키면 던지지 않고 가장 가까운 앞쪽 경계로
    자른다 — 위치 하나 때문에 진단 목록 전체를 못 보여주는 것보다 낫다.
    """
    encoded = text.encode("utf-8")
    offset = max(0, min(offset, len(encoded)))
    # 문자 중간이면 앞쪽 문자 경계로 옮긴다. UTF-8 연속 바이트는 0b10xxxxxx 이다.
    while offset > 0 and offset < len(encoded) and encoded[offset] & 0xC0 == 0x80:
        offset -= 1
    before = encoded[:offset].decode("utf-8")
    line = before.count("\n") + 1
    column = len(before) - (before.rfind("\n") + 1) + 1
    return TextPosition(line=line, column=column)


@dataclass(frozen=True, slots=True)
class RspdlSymbol:
    """IR 에서 `id` 와 `span` 을 가진 노드 하나.

    `kind` 는 IR 의 컬렉션 경로다 (`models`, `models.fields`, `screens` …). dahaze 가 종류
    목록을 따로 정의하지 않으므로, 컴파일러가 종류를 추가해도 그대로 검색된다.
    """

    id: str
    kind: str
    name: str | None
    path: str
    span_start: int
    span_end: int


@dataclass(frozen=True, slots=True)
class UnparsedFile:
    """모듈을 만들지 못해 심볼을 읽을 수 없는 파일."""

    path: str
    error_count: int


@dataclass(frozen=True, slots=True)
class FileDiagnostic:
    """파일 하나에 붙은 진단. `diagnostic` 은 컴파일러가 준 그대로다."""

    path: str
    diagnostic: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class SymbolLocator:
    """참조의 한쪽 끝. `owner_id` 는 local ID 의 소속이다(전역 ID 면 없음)."""

    kind: str
    id: str
    owner_id: str | None = None


@dataclass(frozen=True, slots=True)
class RspdlReference:
    """컴파일러가 해석한 참조 하나 (rspdl-core#41).

    `source` 의 `field` 가 `target` 을 가리킨다. span 은 참조하는 레코드의 UTF-8 byte 범위다.
    """

    path: str
    source: SymbolLocator
    target: SymbolLocator
    field: str
    span_start: int
    span_end: int


@dataclass(frozen=True, slots=True)
class ScreenElement:
    """화면 레이아웃에 선언된 요소 하나. `owner_id` 는 담긴 영역(머리말·구역·폼)의 요소 id 다."""

    id: str
    kind: str
    owner_id: str | None


@dataclass(frozen=True, slots=True)
class RspdlIndex:
    """컴파일 결과에서 읽어 낸 심볼·진단·참조."""

    symbols: tuple[RspdlSymbol, ...]
    unparsed: tuple[UnparsedFile, ...]
    diagnostics: tuple[FileDiagnostic, ...]
    references: tuple[RspdlReference, ...] = ()
    # 컴파일러가 참조 목록을 주는가. 주지 않는 버전에서는 "참조 없음" 과 구분해야 한다.
    references_supported: bool = False
    # (파일 경로, 화면 id) → 그 화면에 선언된 요소. id 가 없는 요소는 싣지 않는다.
    screen_elements: Mapping[tuple[str, str], tuple[ScreenElement, ...]] = field(
        default_factory=dict
    )
