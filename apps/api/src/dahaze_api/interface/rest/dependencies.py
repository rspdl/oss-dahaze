"""FastAPI 의존성 배선.

구체 어댑터를 고르는 유일한 지점이다. 라우터는 port 타입만 본다.
"""

from __future__ import annotations

from functools import lru_cache

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.domain.ports import AnalysisCachePort, RspdlCompilerPort
from dahaze_api.infrastructure.cache import InMemoryAnalysisCache
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


@lru_cache
def get_compiler() -> RspdlCompilerPort:
    """프로세스당 하나. 한 프로세스는 rspdl 버전을 하나만 가질 수 있다 (ADR-0002)."""
    return LocalRspdlCompiler()


@lru_cache
def get_analysis_cache() -> AnalysisCachePort:
    # TODO(persistence): Postgres 백엔드 캐시로 교체. 캐시는 언제든 비워도 되는
    # 파생물이므로 (ADR-0003) 프로세스 메모리로 시작해도 정합성 문제가 없다.
    return InMemoryAnalysisCache()


def get_analyzer() -> AnalyzeWorkspace:
    return AnalyzeWorkspace(compiler=get_compiler(), cache=get_analysis_cache())
