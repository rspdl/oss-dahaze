"""에이전트 프롬프트에 싣는 RSPDL EBNF 스냅샷."""

from __future__ import annotations

from functools import lru_cache
from importlib import resources

GRAMMAR_RSPDL_VERSION = "0.1.4"


@lru_cache
def load_rspdl_ebnf() -> str:
    """사람이 유지하는 EBNF 스냅샷.

    RSPDL 규범 문법은 rspdl-core 가 소유한다. 이 자원은 모델에게 문법을 알려주는 참고 자료이고,
    판정은 언제나 설치된 컴파일러가 한다 (ADR-0005).
    """
    return resources.files(__package__).joinpath("rspdl.ebnf").read_text(encoding="utf-8")


__all__ = ["GRAMMAR_RSPDL_VERSION", "load_rspdl_ebnf"]
