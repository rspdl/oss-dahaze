"""LLM constrained decoding에 쓰는 RSPDL 문법 자원."""

from __future__ import annotations

from functools import lru_cache
from importlib import resources

from dahaze_api.domain.llm import EbnfGrammar

GRAMMAR_RSPDL_VERSION = "0.1.0"


@lru_cache
def load_rspdl_grammar() -> EbnfGrammar:
    """사람이 유지하는 저작용 EBNF 제약 스냅샷을 읽는다.

    RSPDL 규범 문법은 rspdl-core가 소유한다. 이 자원은 모델의 출력 공간을 줄이는 입력이며,
    최종 판정은 언제나 설치된 컴파일러가 한다.
    """

    definition = resources.files(__package__).joinpath("rspdl.ebnf").read_text(encoding="utf-8")
    return EbnfGrammar(
        name=f"rspdl-{GRAMMAR_RSPDL_VERSION}",
        start_rule="document",
        definition=definition,
    )


__all__ = ["GRAMMAR_RSPDL_VERSION", "load_rspdl_grammar"]
