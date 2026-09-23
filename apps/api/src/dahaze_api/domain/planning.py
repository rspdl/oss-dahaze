"""기획 상태 저장 port가 돌려주는 기술 독립 결과."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class DecisionResolutionStatus(StrEnum):
    UPDATED = "updated"
    STALE = "stale"
    NOT_FOUND = "not_found"


@dataclass(frozen=True, slots=True)
class DecisionResolutionOutcome:
    status: DecisionResolutionStatus
    value: Mapping[str, Any] | None = None
