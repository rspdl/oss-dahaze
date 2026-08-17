"""LLM 저작 유스케이스: 초안 → 컴파일 → 진단을 되먹여 수리 → 최종 초안 + 진단.

**여기서 문서를 저장하지 않는다** (ADR-0005). 저장은 리비전을 만들고 리비전은 되돌릴 수
없는 이력이므로, LLM 이 조용히 덮어쓰면 사용자는 자기 문서에 무슨 일이 일어났는지 추적할
방법을 잃는다. 저장은 사람이 `PUT /api/documents/{id}` 로 명시적으로 한다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.domain.ports import LlmPort
from dahaze_api.domain.rspdl import AnalysisOutcome, RspdlSource

# 초안 한 번 뒤에 허용하는 수리 횟수. 즉 LLM 호출은 최대 `1 + MAX_REPAIR_ATTEMPTS` 번이다.
#
# 유한해야 하는 이유는 비용이 아니라 성질이다. 컴파일되지 않는 초안은 대개 문법을
# 잘못 이해한 결과이고, 같은 진단을 몇 번 더 보여준다고 이해가 생기지 않는다.
# 무한히 고치려 드는 대신 진단과 함께 사람에게 넘긴다.
MAX_REPAIR_ATTEMPTS = 3

# 첫 초안은 수리가 아니다. 응답의 `attempts` 는 1 부터 이 값까지 붙는다.
_MAX_ATTEMPTS = 1 + MAX_REPAIR_ATTEMPTS


@dataclass(frozen=True, slots=True)
class AuthoringAttempt:
    """시도 한 번의 결과 요약.

    왜 이 초안이 최종인지 설명할 수 있어야 한다 (ADR-0005). 진단 수가 줄다 멈췄는지,
    처음부터 0이었는지, 끝내 그대로였는지가 응답만 보고 드러나야 한다.
    """

    attempt: int
    diagnostic_count: int


@dataclass(frozen=True, slots=True)
class AuthoringDraft:
    """저작 결과. 컴파일 결과와 **함께가 아니면** 호출자에게 돌아가지 않는다."""

    path: str
    text: str
    model: str
    outcome: AnalysisOutcome
    attempts: tuple[AuthoringAttempt, ...]


def collect_diagnostics(outcome: AnalysisOutcome) -> list[Mapping[str, Any]]:
    """컴파일 결과에서 진단만 꺼낸다. 진단 자체는 손대지 않는다.

    severity 로 거르지 않는다. 무엇이 고칠 만한 문제인지 정하는 것은 컴파일러의 몫이고,
    dahaze 가 여기서 warning 을 눈감아 주면 그게 곧 재해석이다 (AGENTS.md).
    """
    files = outcome.result.get("files")
    if not isinstance(files, list):
        return []
    return [
        diagnostic
        for entry in files
        if isinstance(entry, Mapping)
        for diagnostic in entry.get("diagnostics", [])
    ]


class DraftRspdlDocument:
    """지시를 RSPDL 초안으로 옮기고, 컴파일러 게이트를 통과시킨다."""

    def __init__(self, *, llm: LlmPort, analyzer: AnalyzeWorkspace) -> None:
        self._llm = llm
        self._analyzer = analyzer

    async def draft(
        self,
        *,
        instruction: str,
        path: str,
        current_text: str | None = None,
    ) -> AuthoringDraft:
        """초안을 만들고, 진단이 남으면 그 진단을 되먹여 다시 만든다.

        진단이 끝내 남아도 실패로 만들지 않는다. 반쯤 맞는 초안과 그 진단은 사람이
        판단할 재료이고, 예외로 바꾸면 그 재료를 통째로 뺏는 것이다 (ADR-0005).
        """
        text = current_text
        diagnostics: Sequence[Mapping[str, Any]] = ()
        attempts: list[AuthoringAttempt] = []
        outcome: AnalysisOutcome | None = None

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            text = await self._llm.draft_document(
                instruction=instruction,
                current_text=text,
                diagnostics=diagnostics,
            )
            outcome = await self._analyzer.compile([RspdlSource(path=path, text=text)])
            diagnostics = collect_diagnostics(outcome)
            attempts.append(
                AuthoringAttempt(attempt=attempt, diagnostic_count=len(diagnostics))
            )
            if not diagnostics:
                break

        # 루프는 최소 한 번 돌므로 둘 다 채워져 있다. mypy 를 위해서만 좁힌다.
        assert outcome is not None and text is not None

        return AuthoringDraft(
            path=path,
            text=text,
            model=self._llm.model,
            outcome=outcome,
            attempts=tuple(attempts),
        )
