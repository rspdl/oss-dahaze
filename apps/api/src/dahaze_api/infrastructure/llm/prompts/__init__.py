"""LLM 에게 RSPDL 을 가르치는 프롬프트 자원.

**프롬프트는 컴파일러 버전과 함께 늙는다** (ADR-0005). 문법이 바뀌면 여기 문장도 바꿔야
하고, 안 바꾸면 LLM 이 옛 문법을 계속 만들어낸다. 재컴파일 리포트로는 드러나지 않는
종류의 회귀이므로, 프롬프트를 한곳에 모아 `upgrade-rspdl` 절차가 볼 곳을 하나로 만든다.

문장 자체는 `.md` 로 둔다. 프롬프트를 고치는 사람이 파이썬 문자열 이스케이프와
줄 길이 린트를 신경 쓰지 않아도 되게 하기 위해서다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from importlib import resources
from typing import Any

# 이 프롬프트가 설명하는 문법의 rspdl 버전. 컴파일러 핀을 올릴 때 이 값도 함께 올리고,
# 올리기 전에 위 `.md` 들이 새 문법을 설명하는지 확인한다.
PROMPT_RSPDL_VERSION = "0.1.0"

# 진단을 몇 개까지 프롬프트에 실을지. 문법이 깨진 초안은 진단을 수백 개 낼 수 있고,
# 그걸 전부 넣으면 정작 고쳐야 할 첫 오류가 컨텍스트 뒤로 밀린다.
MAX_DIAGNOSTICS_IN_PROMPT = 20


def _read(name: str) -> str:
    return resources.files(__package__).joinpath(name).read_text(encoding="utf-8")


SYSTEM_PROMPT = f"{_read('system_ko.md')}\n\n{_read('examples_ko.md')}"


def build_user_prompt(
    *,
    instruction: str,
    current_text: str | None,
    diagnostics: Sequence[Mapping[str, Any]],
) -> str:
    """지시·현재 본문·진단을 한 덩어리의 사용자 메시지로 엮는다.

    진단은 컴파일러가 준 모양 그대로 JSON 으로 싣는다. 사람이 읽기 좋게 문장으로
    풀어쓰지 않는 이유는 그게 곧 재해석이기 때문이다 — `rule_id` 와 `span` 이 원본대로
    가야 LLM 이 어디를 고칠지 안다.
    """
    blocks = [f"# 지시\n\n{instruction.strip()}"]

    if current_text is not None and current_text.strip():
        blocks.append(f"# 현재 소스\n\n{current_text}")

    if diagnostics:
        shown = list(diagnostics[:MAX_DIAGNOSTICS_IN_PROMPT])
        payload = json.dumps(shown, ensure_ascii=False, indent=2)
        omitted = len(diagnostics) - len(shown)
        tail = f"\n\n(진단 {omitted}건 생략)" if omitted > 0 else ""
        blocks.append(
            "# 방금 낸 초안의 컴파일 진단\n\n"
            "위 `현재 소스` 는 컴파일에 실패했다. 아래 진단을 해소한 전문을 다시 써라. "
            "진단과 무관한 부분은 그대로 둔다.\n\n"
            f"```json\n{payload}\n```{tail}"
        )

    blocks.append("# 출력\n\nRSPDL 소스 전문만 출력한다.")
    return "\n\n".join(blocks)
