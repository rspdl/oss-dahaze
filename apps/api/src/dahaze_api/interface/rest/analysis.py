"""RSPDL 분석 엔드포인트."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.domain.rspdl import AnalysisOutcome, RspdlSource
from dahaze_api.interface.rest.dependencies import get_analyzer, get_compiler
from dahaze_api.interface.rest.schemas import (
    AnalysisResponse,
    CheckRequest,
    CompileRequest,
    FindModelRequest,
    RspdlRuntimeResponse,
    SourceIn,
)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

Analyzer = Annotated[AnalyzeWorkspace, Depends(get_analyzer)]
Compiler = Annotated[RspdlCompilerPort, Depends(get_compiler)]


def _to_domain(sources: list[SourceIn]) -> list[RspdlSource]:
    return [RspdlSource(path=s.path, text=s.text) for s in sources]


def _to_response(outcome: AnalysisOutcome) -> AnalysisResponse:
    return AnalysisResponse(
        kind=str(outcome.kind),
        rspdl_version=outcome.runtime.rspdl_version,
        wire_schema_version=outcome.runtime.wire_schema_version,
        locale=outcome.runtime.locale,
        result=dict(outcome.result),
    )


@router.get("/runtime", name="get_rspdl_runtime")
async def get_rspdl_runtime(compiler: Compiler) -> RspdlRuntimeResponse:
    """이 서버가 사용하는 RSPDL 컴파일러의 정체.

    프론트가 문서의 target 버전과 비교해 불일치를 사용자에게 알리는 데 쓴다.
    """
    runtime = compiler.runtime
    return RspdlRuntimeResponse(
        rspdl_version=runtime.rspdl_version,
        wire_schema_version=runtime.wire_schema_version,
        locale=runtime.locale,
    )


@router.post("/compile", name="compile_workspace")
async def compile_workspace(body: CompileRequest, analyzer: Analyzer) -> AnalysisResponse:
    """소스를 Canonical IR 과 진단으로 컴파일한다.

    문법·의미 오류는 HTTP 오류가 아니라 200 응답의 `result` 안 진단으로 돌아온다.
    에디터가 오류 위치를 표시할 수 있어야 하기 때문이다.
    """
    outcome = await analyzer.compile(_to_domain(body.sources))
    return _to_response(outcome)


@router.post("/check", name="check_workspace")
async def check_workspace(body: CheckRequest, analyzer: Analyzer) -> AnalysisResponse:
    """runtime record 에 대해 제약과 정책을 검사한다."""
    outcome = await analyzer.check(_to_domain(body.sources), body.data)
    return _to_response(outcome)


@router.post("/model", name="find_model")
async def find_model(body: FindModelRequest, analyzer: Analyzer) -> AnalysisResponse:
    """선언을 만족하는 가상 모델을 유한 scope 안에서 찾는다.

    실제 데이터를 받지 않는다. scope 안에 witness 가 없으면 `unsat_within_bound` 이며,
    이는 전역 모순이 아니라 "이 범위에서는 못 찾았다"는 뜻이다.
    """
    source = RspdlSource(path=body.source.path, text=body.source.text)
    outcome = await analyzer.find_model(
        source,
        scope_per_model=body.scope_per_model,
        timeout_ms=body.timeout_ms,
    )
    return _to_response(outcome)
