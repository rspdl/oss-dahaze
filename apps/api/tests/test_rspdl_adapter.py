"""LocalRspdlCompiler 계약 테스트.

정상, 실패, 경계, 그리고 "오류처럼 보이지만 허용되어야 하는" 사례를 함께 둔다
(RSPDL CONTRIBUTING.md 의 테스트 기준과 같은 형태).
"""

from __future__ import annotations

from typing import Any

import pytest
import rspdl

from dahaze_api.domain.rspdl import (
    AnalysisKind,
    AnalysisOutcome,
    RspdlSource,
    workspace_hash,
)
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler

VALID = RspdlSource(
    path="inventory.rspdl",
    text=(
        "@모듈 재고(inventory)\n"
        "\n"
        "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
        "    이름(name): 필수 문자열\n"
        "    수량(quantity): 필수 정수\n"
        "\n"
        "재고 항목의 수량은 0 이상이어야 한다.\n"
    ),
)

# 문법은 맞지만 의미 규칙이 거부하는 입력. 컴파일러가 예외가 아니라 진단으로 남겨야 한다.
UNPRODUCED = RspdlSource(
    path="broken.rspdl",
    text=(
        "@모듈 깨짐(broken)\n"
        "\n"
        "재고 항목(item)은 다음 필드들로 구성되어 있다\n"
    ),
)


@pytest.fixture
def compiler() -> LocalRspdlCompiler:
    return LocalRspdlCompiler()


def test_runtime_reports_installed_version(compiler: LocalRspdlCompiler) -> None:
    """산출물에 붙일 정체가 실제 설치본과 일치해야 한다."""
    assert compiler.runtime.rspdl_version == rspdl.__version__
    assert compiler.runtime.wire_schema_version == rspdl.WIRE_SCHEMA_VERSION
    assert compiler.runtime.locale == rspdl.SUPPORTED_LOCALE


async def test_compile_valid_source_has_no_diagnostics(compiler: LocalRspdlCompiler) -> None:
    outcome = await compiler.compile([VALID])

    assert outcome.kind is AnalysisKind.COMPILE
    files = outcome.result["files"]
    assert len(files) == 1
    assert files[0]["path"] == VALID.path
    assert files[0]["diagnostics"] == []
    assert files[0]["module"] is not None


async def test_compile_keeps_diagnostics_in_result_not_exceptions(
    compiler: LocalRspdlCompiler,
) -> None:
    """문법 오류는 예외가 아니라 결과 안의 진단으로 보존된다.

    이게 깨지면 사용자는 에디터에서 오류 위치를 볼 수 없고 500 만 받게 된다.
    """
    outcome = await compiler.compile([UNPRODUCED])

    diagnostics = outcome.result["files"][0]["diagnostics"]
    assert diagnostics, "잘못된 소스인데 진단이 비어 있다"
    assert all("rule_id" in d and "severity" in d for d in diagnostics)


async def test_compile_is_order_independent(compiler: LocalRspdlCompiler) -> None:
    """입력 순서가 결과를 바꾸지 않는다. 캐시 키가 정렬에 의존하는 근거."""
    forward = await compiler.compile([VALID, UNPRODUCED])
    reverse = await compiler.compile([UNPRODUCED, VALID])

    def by_path(outcome: AnalysisOutcome) -> dict[str, Any]:
        return {f["path"]: f["diagnostics"] for f in outcome.result["files"]}

    assert by_path(forward) == by_path(reverse)


async def test_find_model_scope_is_part_of_the_answer(compiler: LocalRspdlCompiler) -> None:
    """scope 가 결과를 바꿀 수 있으므로 캐시 키에 들어가야 한다."""
    outcome = await compiler.find_model(VALID, scope_per_model=2)

    assert outcome.kind is AnalysisKind.FIND_MODEL
    assert "compilation" in outcome.result


def test_unsupported_locale_is_rejected_early() -> None:
    """지원하지 않는 locale 을 조용히 통과시키지 않는다."""
    with pytest.raises(ValueError, match="locale"):
        LocalRspdlCompiler(locale="en-US")


def test_workspace_hash_ignores_input_order() -> None:
    a = workspace_hash([VALID, UNPRODUCED], locale="ko-KR")
    b = workspace_hash([UNPRODUCED, VALID], locale="ko-KR")
    assert a == b


def test_workspace_hash_separates_scope() -> None:
    """같은 소스라도 scope 가 다르면 다른 캐시 항목이어야 한다."""
    a = workspace_hash([VALID], locale="ko-KR", extra={"scope_per_model": 1})
    b = workspace_hash([VALID], locale="ko-KR", extra={"scope_per_model": 2})
    assert a != b
