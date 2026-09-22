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


@dataclass(frozen=True, slots=True)
class RspdlEditOutcome:
    """구조화 편집 SDK 호출 결과.

    지원되는 런타임에서는 ``response`` 가 SDK 응답 전문이다. dahaze 는 그 값을 다시
    구성하지 않고, 후보 원문을 초안으로 넘기는 데 필요한 최소 필드만 읽는다. 현재 런타임이
    편집 SDK 를 제공하지 않으면 ``supported`` 가 거짓이고 응답은 없다.
    """

    runtime: RspdlRuntime
    supported: bool
    response: Mapping[str, Any] | None
    unsupported_reason: str | None = None


class InvalidRspdlEditRequest(ValueError):
    """구조화 편집 요청 envelope가 SDK 계약에 맞지 않는다."""


def source_fingerprint(text: str) -> str:
    """원문 UTF-8 바이트의 소문자 SHA-256.

    컴파일러 편집 계약의 ``source_hash`` 와 같은 알고리즘이다. 줄바꿈이나 유니코드를
    정규화하지 않는다. 저장된 원문과 사용자가 검토한 원문이 정확히 같은지 확인하는 값이다.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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


def project_source_hash(sources: Sequence[RspdlSource]) -> str:
    """프로젝트 원문 집합의 canonical hash.

    컴파일 캐시와 같은 직렬화 규칙을 재사용하되 locale 은 원문 정체의 일부가 아니므로
    빈 값으로 고정한다. 적용 경쟁 검사가 별도의 해시 구현과 어긋나지 않게 한다.
    """
    return workspace_hash(sources, locale="")
