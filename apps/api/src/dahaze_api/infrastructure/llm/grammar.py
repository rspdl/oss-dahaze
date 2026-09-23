"""공급자 독립 EBNF를 OpenAI가 받는 Lark CFG로 바꾼다.

원본은 한 규칙을 `name ::= expression ;`로 쓰는 작은 EBNF 부분집합이다. 반복은
`*`, `+`, `?`를 사용한다. 이 부분집합은 Lark의 표현식과 의도적으로 겹치므로 전송 시에는
대입 기호와 종결자만 바꾸고 시작 규칙을 명시하면 된다.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import dataclass

from dahaze_api.domain.llm import EbnfGrammar

_RULE_NAME = re.compile(r"(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9_]*)\Z")


class EbnfConversionError(ValueError):
    """지원하는 EBNF 부분집합이 아니어서 공급자 문법으로 바꿀 수 없다."""


BASELINE_AUTHORING_PROFILE = "rspdl-0.1.2"
PLANNING_AUTHORING_PROFILE = "planning-contracts-v1"
PLANNING_CONTRACTS_CAPABILITY = "rspdl.planning-contracts.v1"


@dataclass(frozen=True)
class AuthoringContract:
    """한 compiler capability에 맞춰 함께 움직이는 prompt와 출력 문법."""

    profile: str
    grammar: EbnfGrammar
    system_prompt: str
    required_capabilities: frozenset[str]


class UnsupportedAuthoringProfile(ValueError):
    """실행 중인 compiler가 요청한 저작 계약을 증명하지 못했다."""


def select_authoring_contract(
    *,
    rspdl_version: str,
    wire_schema_version: int,
    capabilities: Collection[str],
    requested_profile: str | None = None,
) -> AuthoringContract:
    """compiler가 증명한 capability에 맞는 prompt/grammar 한 쌍을 고른다.

    planning compiler는 아직 공개된 package version과 같은 ``0.1.3``을 쓸 수 있다. 따라서
    version 문자열로 확장 문법을 추측하지 않는다. infrastructure/rspdl의 실제 compile probe가
    capability를 보고한 경우에만 명시적 planning profile을 선택할 수 있다.
    """

    from dahaze_api.infrastructure.llm.grammars import (
        load_planning_rspdl_grammar,
        load_rspdl_grammar,
    )
    from dahaze_api.infrastructure.llm.prompts import (
        PLANNING_SYSTEM_PROMPT,
        SYSTEM_PROMPT,
    )

    if wire_schema_version != 1:
        raise UnsupportedAuthoringProfile(
            f"지원하지 않는 rspdl wire schema: {wire_schema_version}"
        )

    profile = requested_profile or BASELINE_AUTHORING_PROFILE
    if profile == BASELINE_AUTHORING_PROFILE:
        return AuthoringContract(
            profile=profile,
            grammar=load_rspdl_grammar(),
            system_prompt=SYSTEM_PROMPT,
            required_capabilities=frozenset(),
        )
    if profile != PLANNING_AUTHORING_PROFILE:
        raise UnsupportedAuthoringProfile(f"알 수 없는 저작 profile: {profile}")

    required = frozenset({PLANNING_CONTRACTS_CAPABILITY})
    missing = required.difference(capabilities)
    if missing:
        missing_text = ", ".join(sorted(missing))
        raise UnsupportedAuthoringProfile(
            f"rspdl {rspdl_version} compiler가 planning 저작 capability를 증명하지 못했다: "
            f"{missing_text}"
        )
    return AuthoringContract(
        profile=profile,
        grammar=load_planning_rspdl_grammar(),
        system_prompt=PLANNING_SYSTEM_PROMPT,
        required_capabilities=required,
    )


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
