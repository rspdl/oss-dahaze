"""공유 작업 트리, commit, 파일 잠금 (ADR-0008)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.errors import (
    AccessDenied,
    Conflict,
    FolderNotEmpty,
    Locked,
    NotFound,
)
from dahaze_api.application.tree import TreeService
from dahaze_api.domain.entities import Project, ProjectRole, User
from dahaze_api.domain.tree import ChangeKind
from dahaze_api.infrastructure.db.repositories import SqlProjectRepository
from dahaze_api.infrastructure.db.tree_repository import SqlTreeRepository

AI = "session:ai-1"
OTHER_AI = "session:ai-2"


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 26, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def tree(session: AsyncSession, clock: FakeClock) -> TreeService:
    return TreeService(
        projects=SqlProjectRepository(session),
        tree=SqlTreeRepository(session),
        clock=clock,
    )


@pytest.fixture
async def project(session: AsyncSession, user: User) -> Project:
    return await SqlProjectRepository(session).create(
        owner_id=user.id,
        slug=f"tree-{uuid4().hex[:8]}",
        name="트리",
        description=None,
        default_rspdl_version="0.1.4",
    )


async def _paths(tree: TreeService, user: User, project: Project) -> list[str]:
    return [e.path for e in await tree.ls(actor_id=user.id, project_id=project.id)]


# ---------------------------------------------------------------------- 폴더·파일


async def test_mkdir_add_read_ls(tree: TreeService, user: User, project: Project) -> None:
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="주문")
    await tree.add(
        actor_id=user.id, project_id=project.id, parent="/주문", name="결제.rspdl", content="A"
    )
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="빈폴더")

    entries = await tree.ls(actor_id=user.id, project_id=project.id)
    # 폴더가 먼저, 각각 경로의 코드 포인트순이다.
    assert [(e.kind, e.path) for e in entries] == [
        ("folder", "/빈폴더"),
        ("folder", "/주문"),
        ("file", "/주문/결제.rspdl"),
    ]
    assert entries[-1].change is ChangeKind.ADD

    file = await tree.read(actor_id=user.id, project_id=project.id, path="/주문/결제.rspdl")
    assert file.text == "A"


async def test_add_requires_existing_parent_and_free_path(
    tree: TreeService, user: User, project: Project
) -> None:
    with pytest.raises(NotFound):
        await tree.add(
            actor_id=user.id, project_id=project.id, parent="/없음", name="a.rspdl", content=""
        )
    await tree.add(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="")
    with pytest.raises(Conflict):
        await tree.add(
            actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content=""
        )
    with pytest.raises(Conflict):
        await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl")


@pytest.mark.parametrize("name", ["../x.rspdl", "a.txt", "a b.rspdl", "", ".rspdl"])
async def test_rejects_bad_file_names(
    tree: TreeService, user: User, project: Project, name: str
) -> None:
    with pytest.raises(Conflict):
        await tree.add(actor_id=user.id, project_id=project.id, parent="/", name=name, content="")


async def test_error_text_is_saved_as_is(tree: TreeService, user: User, project: Project) -> None:
    """컴파일되지 않는 원문도 저장한다. 진단은 compile 이 보여준다."""
    broken = "@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다\n"
    await tree.add(
        actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content=broken
    )
    file = await tree.read(actor_id=user.id, project_id=project.id, path="/a.rspdl")
    assert file.text == broken


# ---------------------------------------------------------------------- 이동·삭제


async def test_move_folder_rebases_descendants_and_keeps_file_id(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a")
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/a", name="b")
    added = await tree.add(
        actor_id=user.id, project_id=project.id, parent="/a/b", name="f.rspdl", content="x"
    )

    moved = await tree.move(actor_id=user.id, project_id=project.id, source="/a", target="/z")

    assert [f.id for f in moved] == [added.id]
    assert await _paths(tree, user, project) == ["/z", "/z/b", "/z/b/f.rspdl"]


async def test_cannot_move_folder_into_itself(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a")
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/a", name="b")
    with pytest.raises(Conflict):
        await tree.move(actor_id=user.id, project_id=project.id, source="/a", target="/a/b/c")


async def test_delete_non_empty_folder_needs_recursive(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a")
    await tree.add(actor_id=user.id, project_id=project.id, parent="/a", name="f.rspdl", content="")

    with pytest.raises(FolderNotEmpty) as info:
        await tree.delete(actor_id=user.id, project_id=project.id, path="/a")
    assert info.value.entries == 1

    deleted = await tree.delete(actor_id=user.id, project_id=project.id, path="/a", recursive=True)
    assert deleted == ["/a/f.rspdl"]
    assert await _paths(tree, user, project) == []


async def test_deleting_uncommitted_file_leaves_nothing_to_commit(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.add(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="")
    await tree.delete(actor_id=user.id, project_id=project.id, path="/a.rspdl")
    assert await tree.changes(actor_id=user.id, project_id=project.id) == []


# ---------------------------------------------------------------------- commit


async def test_commit_only_selected_files(tree: TreeService, user: User, project: Project) -> None:
    for name in ("a.rspdl", "b.rspdl"):
        await tree.add(
            actor_id=user.id, project_id=project.id, parent="/", name=name, content="v1\n"
        )

    commit = await tree.commit(
        actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="a 추가"
    )

    assert commit.seq == 1
    assert [(c.kind, c.new_path) for c in commit.changes] == [(ChangeKind.ADD, "/a.rspdl")]
    assert commit.changes[0].text == "v1\n"
    assert "+v1" in commit.changes[0].diff
    remaining = await tree.changes(actor_id=user.id, project_id=project.id)
    assert [f.path for f in remaining] == ["/b.rspdl"]


async def test_commit_records_modify_move_and_delete(
    tree: TreeService, user: User, project: Project
) -> None:
    for name in ("a.rspdl", "b.rspdl", "c.rspdl"):
        await tree.add(
            actor_id=user.id, project_id=project.id, parent="/", name=name, content="v1\n"
        )
    await tree.commit(
        actor_id=user.id,
        project_id=project.id,
        paths=["/a.rspdl", "/b.rspdl", "/c.rspdl"],
        message="처음",
    )

    await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="v2\n")
    await tree.move(actor_id=user.id, project_id=project.id, source="/b.rspdl", target="/b2.rspdl")
    await tree.delete(actor_id=user.id, project_id=project.id, path="/c.rspdl")

    # 옮긴 파일은 옛 경로로도 고를 수 있다.
    commit = await tree.commit(
        actor_id=user.id,
        project_id=project.id,
        paths=["/a.rspdl", "/b.rspdl", "/c.rspdl"],
        message="정리",
    )

    by_kind = {c.kind: c for c in commit.changes}
    assert by_kind[ChangeKind.MODIFY].diff.count("-v1") == 1
    assert (by_kind[ChangeKind.MOVE].old_path, by_kind[ChangeKind.MOVE].new_path) == (
        "/b.rspdl",
        "/b2.rspdl",
    )
    assert by_kind[ChangeKind.DELETE].text is None
    assert await tree.changes(actor_id=user.id, project_id=project.id) == []
    assert [c.seq for c in await tree.list_commits(actor_id=user.id, project_id=project.id)] == [
        2,
        1,
    ]


async def test_commit_requires_message_and_changes(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.add(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="")
    with pytest.raises(Conflict):
        await tree.commit(actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message=" ")
    await tree.commit(actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="m")
    with pytest.raises(Conflict):
        await tree.commit(actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="m")


async def test_moving_back_to_committed_path_is_not_a_change(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.add(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="")
    await tree.commit(actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="m")
    await tree.move(actor_id=user.id, project_id=project.id, source="/a.rspdl", target="/b.rspdl")
    await tree.move(actor_id=user.id, project_id=project.id, source="/b.rspdl", target="/a.rspdl")
    assert await tree.changes(actor_id=user.id, project_id=project.id) == []


# ---------------------------------------------------------------------- 잠금


async def test_ai_write_locks_file_against_humans_and_other_ai(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.add(actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="")
    await tree.edit(
        actor_id=user.id, project_id=project.id, path="/a.rspdl", content="ai", holder=AI
    )

    entries = await tree.ls(actor_id=user.id, project_id=project.id)
    assert entries[0].locked_by == AI

    with pytest.raises(Locked) as info:
        await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")
    assert info.value.holders == [AI]
    with pytest.raises(Locked):
        await tree.edit(
            actor_id=user.id, project_id=project.id, path="/a.rspdl", content="x", holder=OTHER_AI
        )
    with pytest.raises(Locked):
        await tree.commit(actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="m")

    # 보유자 자신은 계속 쓰고 commit 할 수 있다.
    await tree.edit(
        actor_id=user.id, project_id=project.id, path="/a.rspdl", content="ai2", holder=AI
    )
    await tree.commit(
        actor_id=user.id, project_id=project.id, paths=["/a.rspdl"], message="m", holder=AI
    )


async def test_release_frees_all_locks_of_holder(
    tree: TreeService, user: User, project: Project
) -> None:
    for name in ("a.rspdl", "b.rspdl"):
        await tree.add(
            actor_id=user.id, project_id=project.id, parent="/", name=name, content="", holder=AI
        )
    assert await tree.release_locks(holder=AI, project_id=project.id) == 2
    await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")


async def test_lock_expires_ten_minutes_after_last_write(
    tree: TreeService, user: User, project: Project, clock: FakeClock
) -> None:
    await tree.add(
        actor_id=user.id, project_id=project.id, parent="/", name="a.rspdl", content="", holder=AI
    )
    clock.advance(minutes=9)
    await tree.edit(
        actor_id=user.id, project_id=project.id, path="/a.rspdl", content="1", holder=AI
    )
    clock.advance(minutes=9)
    # 마지막 쓰기부터 9분이라 아직 살아 있다.
    with pytest.raises(Locked):
        await tree.edit(actor_id=user.id, project_id=project.id, path="/a.rspdl", content="me")

    clock.advance(minutes=1)
    await tree.edit(
        actor_id=user.id, project_id=project.id, path="/a.rspdl", content="2", holder=OTHER_AI
    )
    entries = await tree.ls(actor_id=user.id, project_id=project.id)
    assert entries[0].locked_by == OTHER_AI


async def test_moving_folder_needs_every_file_unlocked(
    tree: TreeService, user: User, project: Project
) -> None:
    await tree.mkdir(actor_id=user.id, project_id=project.id, parent="/", name="a")
    await tree.add(
        actor_id=user.id, project_id=project.id, parent="/a", name="f.rspdl", content="", holder=AI
    )
    with pytest.raises(Locked):
        await tree.move(actor_id=user.id, project_id=project.id, source="/a", target="/b")
    with pytest.raises(Locked):
        await tree.delete(actor_id=user.id, project_id=project.id, path="/a", recursive=True)
    # 막힌 쓰기는 아무것도 바꾸지 않는다.
    assert await _paths(tree, user, project) == ["/a", "/a/f.rspdl"]


# ---------------------------------------------------------------------- 권한


async def test_non_member_sees_nothing(
    tree: TreeService, other_user: User, project: Project
) -> None:
    with pytest.raises(NotFound):
        await tree.ls(actor_id=other_user.id, project_id=project.id)
    with pytest.raises(NotFound):
        await tree.mkdir(actor_id=other_user.id, project_id=project.id, parent="/", name="a")


async def test_viewer_cannot_write(
    session: AsyncSession, tree: TreeService, other_user: User, project: Project
) -> None:
    await SqlProjectRepository(session).add_member(
        project_id=project.id, user_id=other_user.id, role=ProjectRole.VIEWER
    )
    assert await tree.ls(actor_id=other_user.id, project_id=project.id) == []
    with pytest.raises(AccessDenied):
        await tree.mkdir(actor_id=other_user.id, project_id=project.id, parent="/", name="a")
