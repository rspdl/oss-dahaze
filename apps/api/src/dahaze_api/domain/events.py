"""프로젝트 이벤트 (ADR-0008).

작업 트리 변경, 잠금, commit, AI 턴 진행을 한 줄로 기록한다. 웹은 SSE 로 받고, 연결이
끊겼다가 다시 붙으면 마지막으로 받은 `seq` 이후를 다시 받는다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


class EventType:
    TREE_CHANGED = "tree.changed"
    LOCKS_RELEASED = "locks.released"
    COMMIT_CREATED = "commit.created"
    AGENT_ITEM = "agent.item"
    AGENT_TEXT_DELTA = "agent.text_delta"
    AGENT_TURN = "agent.turn"


@dataclass(frozen=True, slots=True)
class ProjectEvent:
    seq: int
    project_id: UUID
    type: str
    payload: Mapping[str, Any]
    created_at: datetime
