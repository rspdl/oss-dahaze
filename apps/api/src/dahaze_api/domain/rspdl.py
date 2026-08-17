"""RSPDL 상호작용의 값 객체.

이 모듈은 `rspdl` 을 import 하지 않는다. 컴파일러가 무엇을 돌려주는지의 **모양**은
컴파일러가 소유하며 `wire_schema_version` 으로 버전이 매겨진다 (ADR-0003).
여기서는 그 결과를 불투명한 JSON 으로 다루고, 재생성에 필요한 정체성만 붙인다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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
            {"path": s.path, "text": s.text}
            for s in sorted(sources, key=lambda s: s.path)
        ],
        "extra": dict(sorted((extra or {}).items())),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
