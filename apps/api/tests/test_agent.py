"""AI 턴 실행 (ADR-0005, ADR-0008). 모델은 정해진 응답을 돌려주는 가짜로 바꾼다."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.agent import (
    TOOL_LIMIT_MESSAGE,
    AgentScope,
    AgentService,
    AgentTurnRunner,
)
from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.errors import Conflict
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import TreeInspector
from dahaze_api.domain.agent import (
    MAX_TOOL_CALLS_PER_TURN,
    AgentContext,
    AgentItem,
    AgentSettings,
    AgentStep,
    AgentTurn,
    ItemKind,
    StopReason,
    ToolCall,
    ToolSpec,
    TurnStatus,
    session_lock_holder,
)
from dahaze_api.domain.entities import Project, User
from dahaze_api.domain.events import EventType
from dahaze_api.infrastructure.db.agent_repository import (
    SqlAgentRepository,
    SqlAgentSettings,
    SqlProjectEvents,
)
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler
from dahaze_api.infrastructure.rspdl.indexer import LocalRspdlIndexer
from dahaze_api.infrastructure.text import Re2PatternMatcher

INVENTORY = (
    "@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
)

Script = Callable[[Sequence[AgentItem], bool], AgentStep]


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 26, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


class FakeLlm:
    """정해진 순서로 응답한다. 순서가 다 떨어지면 마지막 응답을 반복한다."""

    def __init__(self, steps: Sequence[Script | AgentStep]) -> None:
        self._steps = list(steps)
        self.calls: list[bool] = []
        self.inputs: list[list[AgentItem]] = []

    @property
    def model(self) -> str:
        return "fake"

    async def step(
        self,
        *,
        context: AgentContext,
        items: Sequence[AgentItem],
        tools: Sequence[ToolSpec],
        allow_tools: bool,
        on_text: Callable[[str], Awaitable[None]],
    ) -> AgentStep:
        self.calls.append(allow_tools)
        self.inputs.append(list(items))
        entry = self._steps[min(len(self.calls) - 1, len(self._steps) - 1)]
        step = entry(items, allow_tools) if callable(entry) else entry
        for part in (step.text[:3], step.text[3:]):
            if part:
                await on_text(part)
        return step


def call(tool: str, /, **arguments: Any) -> ToolCall:
    return ToolCall(call_id=f"call-{uuid4().hex[:8]}", name=tool, arguments=arguments)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def scope(session: AsyncSession, clock: FakeClock) -> AgentScope:
    compiler = LocalRspdlCompiler()
    events = SqlProjectEvents(session)
    tree = TreeService(
        projects=SqlProjectRepository(session),
        tree=SqlTreeRepository(session),
        events=events,
        clock=clock,
    )
    return AgentScope(
        agents=SqlAgentRepository(session),
        events=events,
        settings=SqlAgentSettings(session),
        projects=SqlProjectRepository(session),
        tree=tree,
        inspector=TreeInspector(
            tree=tree,
            analyzer=AnalyzeWorkspace(compiler=compiler, cache=SqlAnalysisCache(session)),
            indexer=LocalRspdlIndexer(),
            matcher=Re2PatternMatcher(),
            runtime=compiler.runtime,
        ),
    )


def runner(scope: AgentScope, llm: FakeLlm, clock: FakeClock) -> AgentTurnRunner:
    @asynccontextmanager
    async def scopes() -> AsyncIterator[AgentScope]:
        yield scope

    return AgentTurnRunner(scopes=scopes, llm=llm, planning_profile=False, clock=clock)


@pytest.fixture
def service(scope: AgentScope, clock: FakeClock) -> AgentService:
    return AgentService(scope, clock=clock)


@pytest.fixture
async def project(session: AsyncSession, user: User) -> Project:
    return await SqlProjectRepository(session).create(
        owner_id=user.id,
        slug=f"agent-{uuid4().hex[:8]}",
        name="에이전트",
        description=None,
        default_rspdl_version="0.1.4",
    )


async def start(service: AgentService, user: User, project: Project, text: str) -> AgentTurn:
    session = await service.create_session(actor_id=user.id, project_id=project.id)
    return await service.send_message(
        actor_id=user.id, session_id=session.id, text=text, request_id=uuid4()
    )


async def run(scope: AgentScope, llm: FakeLlm, clock: FakeClock) -> AgentTurn | None:
    """대기 중인 턴을 끝까지 실행하고, 실행한 턴의 최신 상태를 돌려준다."""
    r = runner(scope, llm, clock)
    turn = await scope.agents.claim_turn(now=clock(), lease_seconds=120)
    if turn is None:
        return None
    await r.run(turn)
    return await scope.agents.get_turn(turn.id)


def kinds(items: Sequence[AgentItem]) -> list[str]:
    return [item.kind.value for item in items]


# ---------------------------------------------------------------------- 기본


async def test_plain_reply_finishes_turn(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "안녕")
    finished = await run(scope, FakeLlm([AgentStep(text="안녕하세요")]), clock)

    assert finished is not None
    assert (finished.status, finished.stop_reason) == (TurnStatus.COMPLETED, StopReason.DONE)
    items = await scope.agents.list_items(turn.session_id)
    assert kinds(items) == ["user_message", "assistant_message"]
    assert items[-1].payload["text"] == "안녕하세요"
    events = await scope.events.list_after(project_id=project.id, after_seq=0, limit=100)
    deltas = [e.payload["delta"] for e in events if e.type == EventType.AGENT_TEXT_DELTA]
    assert "".join(deltas) == "안녕하세요"


async def test_tool_loop_writes_file_and_releases_locks(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "재고 모델을 만들어 줘")
    llm = FakeLlm(
        [
            AgentStep(
                text="", tool_calls=(call("add", parent="/", name="재고.rspdl", content=INVENTORY),)
            ),
            AgentStep(text="", tool_calls=(call("compile"),)),
            AgentStep(text="만들었어요"),
        ]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    assert finished.tool_calls == 2
    file = await scope.tree.read(actor_id=user.id, project_id=project.id, path="/재고.rspdl")
    assert file.text == INVENTORY
    items = await scope.agents.list_items(turn.session_id)
    results = [i for i in items if i.kind is ItemKind.TOOL_RESULT]
    assert results[0].payload["changes"] == [
        {
            "path_before": None,
            "path_after": "/재고.rspdl",
            "text_before": None,
            "text_after": INVENTORY,
        }
    ]
    assert results[1].payload["output"]["compiled"] is True
    # 턴이 끝나면 잠금이 풀려 사람이 저장할 수 있다.
    await scope.tree.edit(actor_id=user.id, project_id=project.id, path="/재고.rspdl", content="x")
    # 모델은 앞선 도구 결과를 입력으로 받았다.
    assert kinds(llm.inputs[1])[-2:] == ["tool_call", "tool_result"]


async def test_tool_error_is_returned_to_model(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "읽어 줘")
    llm = FakeLlm(
        [
            AgentStep(text="", tool_calls=(call("read", path="/없음.rspdl"),)),
            AgentStep(text="없어요"),
        ]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    items = await scope.agents.list_items(turn.session_id)
    result = next(i for i in items if i.kind is ItemKind.TOOL_RESULT)
    assert result.payload["ok"] is False
    assert "파일이 없다" in result.payload["output"]["error"]


async def test_stops_at_tool_limit(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "계속 봐")
    llm = FakeLlm([lambda items, _: AgentStep(text="", tool_calls=(call("ls"),))])
    finished = await run(scope, llm, clock)

    assert finished is not None
    assert (finished.status, finished.stop_reason) == (TurnStatus.COMPLETED, StopReason.TOOL_LIMIT)
    assert finished.tool_calls == MAX_TOOL_CALLS_PER_TURN
    items = await scope.agents.list_items(turn.session_id)
    assert items[-1].payload["text"] == TOOL_LIMIT_MESSAGE


# ---------------------------------------------------------------------- 잠금


async def test_lock_conflict_ends_turn_with_answer_only(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await scope.tree.add(
        actor_id=user.id,
        project_id=project.id,
        parent="/",
        name="a.rspdl",
        content="",
        holder="session:other",
    )
    turn = await start(service, user, project, "고쳐 줘")
    llm = FakeLlm(
        [
            AgentStep(text="", tool_calls=(call("edit", path="/a.rspdl", content="x"), call("ls"))),
            AgentStep(text="다른 작업이 쓰고 있어요"),
        ]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.LOCK_CONFLICT
    # 충돌 뒤에는 도구 없이 답변만 받는다.
    assert llm.calls == [True, False]
    items = await scope.agents.list_items(turn.session_id)
    results = [i.payload for i in items if i.kind is ItemKind.TOOL_RESULT]
    assert results[0]["output"]["holders"] == ["session:other"]
    assert "잠금 충돌" in results[1]["output"]["error"]
    file = await scope.tree.read(actor_id=user.id, project_id=project.id, path="/a.rspdl")
    assert file.text == ""


async def test_lock_expiry_stops_turn(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await start(service, user, project, "만들어 줘")

    def slow(items: Sequence[AgentItem], _: bool) -> AgentStep:
        clock.now += timedelta(minutes=11)
        return AgentStep(text="", tool_calls=(call("ls"),))

    llm = FakeLlm(
        [
            AgentStep(text="", tool_calls=(call("add", parent="/", name="a.rspdl", content=""),)),
            slow,
        ]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.LOCK_EXPIRED


# ---------------------------------------------------------------------- 승인


async def _folder_with_file(scope: AgentScope, user: User, project: Project) -> None:
    await scope.tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a")
    await scope.tree.add(
        actor_id=user.id, project_id=project.id, parent="/a", name="f.rspdl", content="old"
    )


async def test_recursive_delete_waits_for_approval_then_runs(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await _folder_with_file(scope, user, project)
    turn = await start(service, user, project, "a 폴더 지워 줘")
    llm = FakeLlm(
        [
            AgentStep(
                text="",
                tool_calls=(
                    call("edit", path="/a/f.rspdl", content="new"),
                    call("delete", path="/a"),
                    call("ls"),
                ),
            ),
            AgentStep(text="지웠어요"),
        ]
    )
    paused = await run(scope, llm, clock)

    assert paused is not None and paused.status is TurnStatus.AWAITING_APPROVAL
    assert paused.pending_approval is not None and paused.pending_approval.name == "delete"
    # 기다리는 동안 잠금은 유지된다.
    entries = await scope.tree.ls(actor_id=user.id, project_id=project.id)
    assert [e.locked_by for e in entries if e.kind == "file"] == [
        session_lock_holder(turn.session_id)
    ]
    # 승인 대기 시간은 잠금 만료에 넣지 않는다.
    clock.now += timedelta(minutes=30)

    await service.resolve_approval(actor_id=user.id, turn_id=turn.id, approved=True)
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    assert await scope.tree.ls(actor_id=user.id, project_id=project.id) == []
    items = await scope.agents.list_items(turn.session_id)
    results = [i.payload for i in items if i.kind is ItemKind.TOOL_RESULT]
    # edit, (ls 는 건너뜀), delete 순서로 결과가 남는다.
    assert [r["name"] for r in results] == ["edit", "ls", "delete"]
    assert results[2]["changes"] == [
        {"path_before": "/a/f.rspdl", "path_after": None, "text_before": "new", "text_after": None}
    ]


async def test_denied_delete_is_reported_to_model(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await _folder_with_file(scope, user, project)
    turn = await start(service, user, project, "a 폴더 지워 줘")
    llm = FakeLlm(
        [
            AgentStep(text="", tool_calls=(call("delete", path="/a"),)),
            AgentStep(text="그대로 뒀어요"),
        ]
    )
    await run(scope, llm, clock)
    await service.resolve_approval(actor_id=user.id, turn_id=turn.id, approved=False)
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    assert [e.path for e in await scope.tree.ls(actor_id=user.id, project_id=project.id)] == [
        "/a",
        "/a/f.rspdl",
    ]
    items = await scope.agents.list_items(turn.session_id)
    result = [i.payload for i in items if i.kind is ItemKind.TOOL_RESULT][-1]
    assert "거절" in result["output"]["error"]


async def test_auto_approve_setting_skips_approval(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await service.put_settings(
        actor_id=user.id, settings=AgentSettings(auto_approve_recursive_delete=True)
    )
    await _folder_with_file(scope, user, project)
    await start(service, user, project, "a 폴더 지워 줘")
    llm = FakeLlm(
        [AgentStep(text="", tool_calls=(call("delete", path="/a"),)), AgentStep(text="지웠어요")]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    assert await scope.tree.ls(actor_id=user.id, project_id=project.id) == []


async def test_cancel_while_awaiting_approval_releases_locks(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    await _folder_with_file(scope, user, project)
    turn = await start(service, user, project, "a 폴더 지워 줘")
    llm = FakeLlm(
        [
            AgentStep(
                text="",
                tool_calls=(
                    call("edit", path="/a/f.rspdl", content="x"),
                    call("delete", path="/a"),
                ),
            )
        ]
    )
    await run(scope, llm, clock)

    cancelled = await service.cancel(actor_id=user.id, turn_id=turn.id)

    assert (cancelled.status, cancelled.stop_reason) == (TurnStatus.CANCELLED, StopReason.CANCELLED)
    await scope.tree.edit(actor_id=user.id, project_id=project.id, path="/a/f.rspdl", content="me")


# ---------------------------------------------------------------------- 취소·실패·재개


async def test_cancel_request_stops_running_turn(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "계속 봐")

    def step(items: Sequence[AgentItem], allow: bool) -> AgentStep:
        return AgentStep(text="", tool_calls=(call("ls"),))

    llm = FakeLlm([step])
    r = runner(scope, llm, clock)
    claimed = await scope.agents.claim_turn(now=clock(), lease_seconds=120)
    assert claimed is not None
    await scope.agents.request_cancel(claimed.id)
    await r.run(claimed)

    finished = await scope.agents.get_turn(turn.id)
    assert finished is not None
    assert (finished.status, finished.stop_reason) == (TurnStatus.CANCELLED, StopReason.CANCELLED)
    assert llm.calls == []


async def test_model_failure_fails_turn_and_releases_locks(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "만들어 줘")
    llm = FakeLlm(
        [AgentStep(text="", tool_calls=(call("add", parent="/", name="a.rspdl", content=""),))]
    )
    r = runner(scope, llm, clock)
    claimed = await scope.agents.claim_turn(now=clock(), lease_seconds=120)
    assert claimed is not None
    # 첫 단계만 성공하고 다음 모델 호출이 실패하게 바꾼다.
    original = llm.step

    async def failing_after_first(**kwargs: Any) -> AgentStep:
        if llm.calls:
            raise RuntimeError("모델 호출 실패")
        return await original(**kwargs)

    llm.step = failing_after_first  # type: ignore[method-assign]
    await r.run(claimed)

    finished = await scope.agents.get_turn(turn.id)
    assert finished is not None
    assert (finished.status, finished.stop_reason) == (TurnStatus.FAILED, StopReason.ERROR)
    assert finished.error == "모델 호출 실패"
    await scope.tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")


async def test_dangling_tool_call_gets_interrupted_result_on_resume(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    turn = await start(service, user, project, "봐 줘")
    await scope.agents.append_item(
        session_id=turn.session_id,
        turn_id=turn.id,
        kind=ItemKind.TOOL_CALL,
        payload={"call_id": "lost", "name": "ls", "arguments": {}},
    )
    finished = await run(scope, FakeLlm([AgentStep(text="확인했어요")]), clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    items = await scope.agents.list_items(turn.session_id)
    result = next(i for i in items if i.kind is ItemKind.TOOL_RESULT)
    assert result.payload["call_id"] == "lost"
    assert result.payload["ok"] is False


# ---------------------------------------------------------------------- 요청


async def test_same_request_id_is_processed_once(
    scope: AgentScope, service: AgentService, user: User, project: Project
) -> None:
    session = await service.create_session(actor_id=user.id, project_id=project.id)
    request_id = uuid4()
    first = await service.send_message(
        actor_id=user.id, session_id=session.id, text="a", request_id=request_id
    )
    again = await service.send_message(
        actor_id=user.id, session_id=session.id, text="a", request_id=request_id
    )

    assert first.id == again.id
    assert kinds(await scope.agents.list_items(session.id)) == ["user_message"]
    with pytest.raises(Conflict):
        await service.send_message(
            actor_id=user.id, session_id=session.id, text="b", request_id=uuid4()
        )


async def test_other_member_cannot_see_session(
    service: AgentService, user: User, other_user: User, project: Project
) -> None:
    from dahaze_api.application.errors import NotFound

    session = await service.create_session(actor_id=user.id, project_id=project.id)
    with pytest.raises(NotFound):
        await service.list_items(actor_id=other_user.id, session_id=session.id)


async def test_first_message_names_untitled_session(
    scope: AgentScope, service: AgentService, user: User, project: Project
) -> None:
    session = await service.create_session(actor_id=user.id, project_id=project.id)
    long = "주문 모델에 배송 상태를 추가하고 결제 완료 뒤에만 배송을 시작하게 해 줘\n두 번째 줄"
    await service.send_message(
        actor_id=user.id, session_id=session.id, text=long, request_id=uuid4()
    )

    renamed = await service.get_session(actor_id=user.id, session_id=session.id)
    assert renamed.title.endswith("…")
    assert len(renamed.title) == 40
    assert "두 번째 줄" not in renamed.title


async def test_given_title_is_kept(
    scope: AgentScope, service: AgentService, user: User, project: Project
) -> None:
    session = await service.create_session(actor_id=user.id, project_id=project.id, title="배송")
    await service.send_message(
        actor_id=user.id, session_id=session.id, text="a", request_id=uuid4()
    )
    kept = await service.get_session(actor_id=user.id, session_id=session.id)
    assert kept.title == "배송"


# ---------------------------------------------------------------------- 와이어프레임 배치


async def test_wireframe_tool_changes_one_screen_and_edit_cannot_drop_others(
    scope: AgentScope, service: AgentService, user: User, project: Project, clock: FakeClock
) -> None:
    """AI 가 배치 파일 전문을 다시 쓰다 다른 화면의 배치를 지운 일이 있었다."""
    await scope.tree.add(
        actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="x"
    )
    root = {"type": "group", "id": "root", "children": []}
    turn = await start(service, user, project, "카드로 바꿔 줘")
    llm = FakeLlm(
        [
            AgentStep(
                text="",
                tool_calls=(
                    call("wireframe", path="/a.wireframe.json", screen_id="m.one", layout=root),
                    call(
                        "wireframe",
                        path="/a.wireframe.json",
                        screen_id="m.two",
                        layout=root,
                        theme="shadcn",
                    ),
                    call("edit", path="/a.wireframe.json", content='{"screens": {"m.two": {}}}'),
                ),
            ),
            AgentStep(text="바꿨어요"),
        ]
    )
    finished = await run(scope, llm, clock)

    assert finished is not None and finished.stop_reason is StopReason.DONE
    saved = await scope.tree.read(actor_id=user.id, project_id=project.id, path="/a.wireframe.json")
    data = json.loads(saved.text)
    assert data["theme"] == "shadcn"
    assert set(data["screens"]) == {"m.one", "m.two"}
    items = await scope.agents.list_items(turn.session_id)
    results = [i.payload for i in items if i.kind is ItemKind.TOOL_RESULT]
    assert [r["ok"] for r in results] == [True, True, False]
    assert "m.one" in results[2]["output"]["error"]
