"""에이전트에게 RSPDL 을 알려주는 프롬프트 자원.

**프롬프트는 특정 컴파일러 버전의 문법에 맞춰 써 있다** (ADR-0005). 문법이 바뀌면 여기 문장도
바꿔야 하고, 안 바꾸면 LLM 이 옛 문법을 계속 만들어낸다. 재컴파일 리포트로는 드러나지 않는
종류의 회귀이므로, 프롬프트를 한곳에 모아 `upgrade-rspdl` 절차가 볼 곳을 하나로 만든다.

문장 자체는 `.md` 로 둔다. 프롬프트를 고치는 사람이 파이썬 문자열 이스케이프와
줄 길이 린트를 신경 쓰지 않아도 되게 하기 위해서다.
"""

from __future__ import annotations

from importlib import resources

# 이 프롬프트가 설명하는 문법의 rspdl 버전. 컴파일러 핀을 올릴 때 이 값도 함께 올리고,
# 올리기 전에 위 `.md` 들이 새 문법을 설명하는지 확인한다.
PROMPT_RSPDL_VERSION = "0.1.4"
# planning contracts 는 RSPDL 문법 확장 profile 이다. 컴파일러가 지원할 때만 싣는다.
_PLANNING_SECTION = "<!-- planning-contracts-v1 -->"


def _read(name: str) -> str:
    return resources.files(__package__).joinpath(name).read_text(encoding="utf-8")


def _profile_text(name: str, *, planning: bool) -> str:
    baseline, marker, extension = _read(name).partition(_PLANNING_SECTION)
    if not marker:
        raise RuntimeError(f"prompt resource에 planning 구분자가 없다: {name}")
    if planning:
        return f"{baseline.rstrip()}\n\n{extension.strip()}"
    return baseline.rstrip()


_GRAMMAR_HEADING = "# 문법 요약"


def _grammar_reference(*, planning: bool) -> str:
    """`system_ko.md` 에서 출력 규칙을 뺀 문법 설명.

    출력 규칙("RSPDL 전문 하나만 낸다")은 한 번에 문서 하나를 만드는 저작 호출용이다. 도구를
    부르며 대화하는 에이전트에게는 맞지 않으므로 문법 요약부터 쓴다.
    """
    text = _profile_text("system_ko.md", planning=planning)
    _, heading, rest = text.partition(_GRAMMAR_HEADING)
    return f"{heading}{rest}".strip()


def build_agent_instructions(*, project_name: str, planning: bool, grammar: str) -> str:
    """앱 AI 의 시스템 프롬프트. 역할·도구 규칙, 문법 요약, 예시, EBNF 스냅샷 순서다."""
    return "\n\n".join(
        [
            _read("agent_system_ko.md").strip(),
            f"# 현재 프로젝트\n\n{project_name}",
            _grammar_reference(planning=planning),
            _profile_text("examples_ko.md", planning=planning),
            "# RSPDL EBNF 참고\n\n아래 EBNF 는 문법 참고용이다. 판정은 컴파일러가 한다.\n\n"
            f"```ebnf\n{grammar.strip()}\n```",
        ]
    )
