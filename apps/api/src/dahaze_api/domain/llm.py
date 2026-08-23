"""LLM 저작에 쓰는 공급자 독립 값.

OpenAI 의 Lark CFG나 self-hosted 엔진의 xgrammar 요청 모양은 인프라의 관심사다.
애플리케이션은 사람이 유지하는 EBNF 원본만 전달한다.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class EbnfGrammar:
    """제약 디코딩에 사용할 EBNF 문법.

    `name` 은 관측과 오류 메시지에서 문법을 식별하고, `start_rule` 은 공급자 형식으로
    변환할 때 진입 규칙을 정한다. definition 은 공급자별 표현으로 미리 바꾸지 않는다.
    """

    name: str
    start_rule: str
    definition: str

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("EBNF 문법 이름은 비어 있을 수 없다")
        if not self.start_rule.strip():
            raise ValueError("EBNF 시작 규칙은 비어 있을 수 없다")
        if not self.definition.strip():
            raise ValueError("EBNF 정의는 비어 있을 수 없다")
