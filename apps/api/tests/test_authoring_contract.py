"""Compiler capability별 LLM 저작 prompt/grammar 계약 테스트."""

from __future__ import annotations

import hashlib
import re
from importlib import resources

import pytest

from dahaze_api.domain.rspdl import RspdlSource
from dahaze_api.infrastructure.llm.grammar import (
    BASELINE_AUTHORING_PROFILE,
    PLANNING_AUTHORING_PROFILE,
    PLANNING_CONTRACTS_CAPABILITY,
    AuthoringContract,
    UnsupportedAuthoringProfile,
    ebnf_to_lark,
    select_authoring_contract,
)
from dahaze_api.infrastructure.llm.grammars import load_planning_rspdl_grammar
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler


def _planning_prompt_examples() -> list[str]:
    markdown = (
        resources.files("dahaze_api.infrastructure.llm.prompts")
        .joinpath("planning_examples_ko.md")
        .read_text(encoding="utf-8")
    )
    sections = re.split(r"^## 확장 예시 \d+.*$", markdown, flags=re.MULTILINE)[1:]
    examples: list[str] = []
    for section in sections:
        source_lines: list[str] = []
        started = False
        for line in section.splitlines():
            if line.startswith("    "):
                started = True
                source_lines.append(line[4:])
            elif started and not line:
                source_lines.append("")
            elif started:
                break
        examples.append("\n".join(source_lines).rstrip() + "\n")
    return examples


def _contract_hash(contract: AuthoringContract) -> str:
    payload = "\0".join(
        (
            contract.profile,
            contract.system_prompt,
            contract.grammar.name,
            contract.grammar.start_rule,
            contract.grammar.definition,
        )
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def test_default_contract_stays_on_pinned_baseline_even_for_official_013() -> None:
    contract = select_authoring_contract(
        rspdl_version="0.1.3",
        wire_schema_version=1,
        capabilities=(),
    )

    assert contract.profile == BASELINE_AUTHORING_PROFILE
    assert contract.grammar.start_rule == "document"
    assert PLANNING_CONTRACTS_CAPABILITY not in contract.system_prompt
    assert hashlib.sha256(contract.system_prompt.encode()).hexdigest() == (
        "6674a9f38f324f2b539fe81043c895ce5f94cc3e748c83550ba0234489c84fcf"
    )


def test_version_string_alone_cannot_enable_unpublished_planning_grammar() -> None:
    with pytest.raises(UnsupportedAuthoringProfile, match=PLANNING_CONTRACTS_CAPABILITY):
        select_authoring_contract(
            rspdl_version="0.1.3",
            wire_schema_version=1,
            capabilities=(),
            requested_profile=PLANNING_AUTHORING_PROFILE,
        )


def test_probed_capability_selects_prompt_and_grammar_atomically() -> None:
    contract = select_authoring_contract(
        rspdl_version="0.1.3",
        wire_schema_version=1,
        capabilities={PLANNING_CONTRACTS_CAPABILITY},
        requested_profile=PLANNING_AUTHORING_PROFILE,
    )

    assert contract.profile == PLANNING_AUTHORING_PROFILE
    assert contract.required_capabilities == frozenset({PLANNING_CONTRACTS_CAPABILITY})
    assert contract.grammar.start_rule == "planning_document"
    assert "행동 결과" in contract.system_prompt
    assert "복구" in contract.system_prompt
    assert contract.system_prompt.startswith(
        "당신은 `planning-contracts-v1` RSPDL 저작 도구다."
    )
    assert "@모듈" not in contract.system_prompt
    assert "확실하지 않으면 선언을" not in contract.system_prompt
    assert "첫 줄은 정확히 `---`" in contract.system_prompt
    assert "기존 stable ID와 모델, 정보구조 IA" in contract.system_prompt
    assert "각 요청된 분기와 해당 흐름을 생략하지 않는다" in contract.system_prompt
    assert "`정보구조`는 화면 레이아웃과 별개의 탐색 트리" in contract.system_prompt
    assert "사용자가 화면에 직접 입력하는 데이터는 제출 버튼에" in contract.system_prompt
    assert "사용자 입력을 대신하는 용도로 쓰지 않는다" in contract.system_prompt


def test_authoring_contract_hash_changes_atomically_with_prompt_and_grammar() -> None:
    baseline = select_authoring_contract(
        rspdl_version="0.1.3",
        wire_schema_version=1,
        capabilities=(),
    )
    planning = select_authoring_contract(
        rspdl_version="0.1.3",
        wire_schema_version=1,
        capabilities={PLANNING_CONTRACTS_CAPABILITY},
        requested_profile=PLANNING_AUTHORING_PROFILE,
    )
    selected_again = select_authoring_contract(
        rspdl_version="dev-planning",
        wire_schema_version=1,
        capabilities={PLANNING_CONTRACTS_CAPABILITY},
        requested_profile=PLANNING_AUTHORING_PROFILE,
    )

    assert _contract_hash(planning) == _contract_hash(selected_again)
    assert _contract_hash(planning) != _contract_hash(baseline)


def test_planning_ebnf_converts_with_a_separate_start_rule() -> None:
    lark = ebnf_to_lark(load_planning_rspdl_grammar())

    assert lark.startswith("start: planning_document\n")
    assert (
        'planning_frontmatter: "---" NEWLINE "모듈: " FRONTMATTER_NAMED_ID NEWLINE'
        in lark
    )
    assert "frontmatter_mapping_line:" in lark
    assert "frontmatter_sequence_line:" in lark
    assert "FRONTMATTER_CONTENT" not in lark
    assert "action_input_declaration:" in lark


async def test_planning_examples_compile_when_runtime_proves_capability() -> None:
    """현재 pin에서는 skip하고 capability runtime을 넣은 승격 검증에서는 실제로 검사한다."""

    examples = _planning_prompt_examples()
    assert len(examples) == 3
    assert "정보구조:" in examples[-1]
    assert "획득:" in examples[-1]
    assert "초기 데이터:" not in examples[-1]
    compiler = LocalRspdlCompiler()
    if PLANNING_CONTRACTS_CAPABILITY not in await compiler.capabilities():
        pytest.skip("installed rspdl compiler does not prove planning-contracts-v1")

    for index, source in enumerate(examples, start=1):
        outcome = await compiler.compile(
            [RspdlSource(path=f"planning-example-{index}.rspdl", text=source)]
        )
        assert outcome.result["files"][0]["diagnostics"] == []
