"""AI 작업자 지침: 파일 구성 규칙이 앱 AI 와 MCP 에 같이 닿는지, 규칙이 컴파일러와 맞는지.

파일 구성 규칙("파일 하나가 모듈 하나, 백틱 참조는 파일 밖으로 나가지 않는다")은 rspdl 0.1.4 를
실제로 컴파일해 확인한 내용이다. 컴파일러가 바뀌어 규칙이 틀려지면 아래 컴파일러 테스트가 먼저
실패한다. 그때 `agent_system_ko.md` 의 tree-layout 구간을 함께 고친다.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from dahaze_api.application.agent_tools import TOOL_NAMES, TOOL_SPECS
from dahaze_api.domain.rspdl import RspdlSource
from dahaze_api.infrastructure.llm.prompts import build_agent_instructions, tree_layout_guide
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler
from dahaze_api.interface.mcp.server import INSTRUCTIONS, create_mcp_server

MEMBER_MODEL = """@모듈 회원(member)

회원(member)은 다음 필드들로 구성되어 있다.
    이름(name): 필수 문자열
    등급(grade): 필수 정수
"""

MEMBER_SCREENS = """@모듈 회원 화면(member_screens)

회원 가입 화면(signup)에서는 `회원`을 생성할 수 있다.
회원 가입 화면(signup)에서는 `회원`의 `이름`, `등급`을 입력할 수 있다.
"""

# 권장 순서(열거 → 모델 → 관계·제약 → 계산 → 역할·행동 → 정책 → 화면)를 따른 한 파일.
ORDERED_MODULE = """@모듈 회원 가입(member_signup)

회원 상태(member_status)는 다음 값 중 하나다.
    활성(active)
    휴면(dormant)

회원(member)은 다음 필드들로 구성되어 있다.
    이름(name): 필수 문자열
    나이(age): 필수 정수
    상태(status): 필수 회원 상태

`회원`의 `나이`는 0 이상이어야 한다.

운영자(operator)는 역할이다.
변경(change)은 행동이다.

`운영자`는 `회원`의 `상태`를 `변경`할 수 있다.

회원 가입 화면(signup)에서는 `회원`을 생성할 수 있다.
회원 가입 화면(signup)에서는 `회원`의 `이름`, `나이`, `상태`를 입력할 수 있다.
회원 상세 화면(member_detail)에서는 `회원`의 `이름`, `나이`, `상태`를 조회할 수 있다.
"""


def _instructions() -> str:
    return build_agent_instructions(project_name="테스트", planning=False, grammar="document ::= x")


def _files(result: Any) -> dict[str, dict[str, Any]]:
    return {f["path"]: f for f in result["files"]}


def _rule_ids(file: dict[str, Any]) -> set[str]:
    return {d["rule_id"] for d in file["diagnostics"]}


# ---------------------------------------------------------------- 프롬프트 조립


def test_agent_prompt_carries_the_tree_layout_rules_without_markers() -> None:
    text = _instructions()
    assert "# 파일 구성" in text
    assert "## 쓰기 전 판단" in text
    assert "<!--" not in text.split("# 현재 프로젝트")[0]


def test_mcp_instructions_reuse_the_same_layout_text() -> None:
    guide = tree_layout_guide()
    assert guide.startswith("# 파일 구성")
    assert guide in _instructions()
    assert guide in INSTRUCTIONS


def test_layout_guide_names_only_existing_tools() -> None:
    guide = tree_layout_guide()
    for name in ("ls", "search", "fetch", "read", "edit", "add", "mkdir", "mv", "delete"):
        assert f"`{name}`" in guide
        assert name in TOOL_NAMES


# ---------------------------------------------------------------- 도구 노출


async def test_app_and_mcp_expose_the_same_tree_tools() -> None:
    advertised = {tool.name: tool for tool in await create_mcp_server(MagicMock()).list_tools()}
    # MCP 에만 unlock 이 있다. 앱 AI 의 잠금은 턴이 끝날 때 runner 가 푼다.
    assert set(advertised) >= TOOL_NAMES
    assert {"search", "fetch", "grep"} <= TOOL_NAMES
    assert "모듈 하나" in (advertised["add"].description or "")
    assert "도메인 영역" in (advertised["mkdir"].description or "")
    assert "module" in (advertised["search"].description or "")


def test_app_write_tools_describe_the_module_rule() -> None:
    specs = {spec.name: spec for spec in TOOL_SPECS}
    assert "모듈 하나" in specs["add"].description
    assert "도메인 영역" in specs["mkdir"].description
    assert "module" in specs["search"].description


# ------------------------------------------------- 프롬프트가 주장하는 컴파일러 동작


async def test_reference_to_a_model_in_another_file_is_not_resolved() -> None:
    outcome = await LocalRspdlCompiler().compile(
        [
            RspdlSource(path="/회원/모델.rspdl", text=MEMBER_MODEL),
            RspdlSource(path="/회원/화면.rspdl", text=MEMBER_SCREENS),
        ]
    )
    files = _files(outcome.result)
    assert files["/회원/모델.rspdl"]["diagnostics"] == []
    assert "RSPDL-KO-REF-001" in _rule_ids(files["/회원/화면.rspdl"])


async def test_same_module_id_in_two_files_does_not_share_references() -> None:
    screens = MEMBER_SCREENS.replace("@모듈 회원 화면(member_screens)", "@모듈 회원(member)")
    outcome = await LocalRspdlCompiler().compile(
        [
            RspdlSource(path="/회원/모델.rspdl", text=MEMBER_MODEL),
            RspdlSource(path="/회원/화면.rspdl", text=screens),
        ]
    )
    assert "RSPDL-KO-REF-001" in _rule_ids(_files(outcome.result)["/회원/화면.rspdl"])


async def test_module_id_must_be_unique_across_files() -> None:
    outcome = await LocalRspdlCompiler().compile(
        [
            RspdlSource(path="/a.rspdl", text=MEMBER_MODEL),
            RspdlSource(path="/b.rspdl", text=MEMBER_MODEL),
        ]
    )
    for file in _files(outcome.result).values():
        assert "RSPDL-LINK-001" in _rule_ids(file)


async def test_same_names_in_different_modules_compile() -> None:
    other = MEMBER_MODEL.replace("@모듈 회원(member)", "@모듈 휴면 회원(dormant_member)")
    outcome = await LocalRspdlCompiler().compile(
        [RspdlSource(path="/a.rspdl", text=MEMBER_MODEL), RspdlSource(path="/b.rspdl", text=other)]
    )
    assert all(f["diagnostics"] == [] for f in outcome.result["files"])


async def test_recommended_declaration_order_compiles_without_errors() -> None:
    outcome = await LocalRspdlCompiler().compile(
        [RspdlSource(path="/회원/회원가입.rspdl", text=ORDERED_MODULE)]
    )
    (file,) = outcome.result["files"]
    assert file["module"] is not None
    assert [d for d in file["diagnostics"] if d["severity"] == "error"] == []
