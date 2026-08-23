"""공급자 독립 EBNF를 OpenAI가 받는 Lark CFG로 바꾼다.

원본은 한 규칙을 `name ::= expression ;`로 쓰는 작은 EBNF 부분집합이다. 반복은
`*`, `+`, `?`를 사용한다. 이 부분집합은 Lark의 표현식과 의도적으로 겹치므로 전송 시에는
대입 기호와 종결자만 바꾸고 시작 규칙을 명시하면 된다.
"""

from __future__ import annotations

import re

from dahaze_api.domain.llm import EbnfGrammar

_RULE_NAME = re.compile(r"(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9_]*)\Z")


class EbnfConversionError(ValueError):
    """지원하는 EBNF 부분집합이 아니어서 공급자 문법으로 바꿀 수 없다."""


def ebnf_to_lark(grammar: EbnfGrammar) -> str:
    """간단한 EBNF 원본을 OpenAI custom tool용 Lark CFG로 변환한다."""

    if not _RULE_NAME.fullmatch(grammar.start_rule):
        raise EbnfConversionError(f"유효하지 않은 시작 규칙: {grammar.start_rule}")

    productions: list[tuple[str, str]] = []
    seen: set[str] = set()
    for statement in _split_statements(grammar.definition):
        if "::=" not in statement:
            raise EbnfConversionError(f"'::='가 없는 EBNF 규칙: {statement}")
        name, expression = (part.strip() for part in statement.split("::=", 1))
        if not _RULE_NAME.fullmatch(name):
            raise EbnfConversionError(f"유효하지 않은 EBNF 규칙 이름: {name}")
        if not expression:
            raise EbnfConversionError(f"표현식이 비어 있는 EBNF 규칙: {name}")
        if name in seen:
            raise EbnfConversionError(f"중복된 EBNF 규칙: {name}")
        seen.add(name)
        productions.append((name, expression))

    if grammar.start_rule not in seen:
        raise EbnfConversionError(f"시작 규칙이 EBNF에 없다: {grammar.start_rule}")

    lines = [f"start: {grammar.start_rule}"]
    lines.extend(f"{name}: {expression}" for name, expression in productions)
    return "\n".join(lines) + "\n"


def _split_statements(definition: str) -> list[str]:
    """문자열·정규식 안의 `;`는 보존하면서 EBNF production을 나눈다."""

    statements: list[str] = []
    current: list[str] = []
    delimiter: str | None = None
    escaped = False

    for character in definition:
        if delimiter is not None:
            current.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == delimiter:
                delimiter = None
            continue

        if character in {'"', "'", "/"}:
            delimiter = character
            current.append(character)
        elif character == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
        else:
            current.append(character)

    if delimiter is not None:
        raise EbnfConversionError("닫히지 않은 EBNF 문자열 또는 정규식")
    if "".join(current).strip():
        raise EbnfConversionError("EBNF 규칙은 ';'로 끝나야 한다")
    if not statements:
        raise EbnfConversionError("EBNF 규칙이 없다")
    return statements
