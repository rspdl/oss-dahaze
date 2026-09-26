"""공유 작업 트리 유스케이스 (ADR-0008).

앱 AI, MCP, 사람의 에디터가 모두 여기를 지난다. 쓰기는 두 부류다.

- `holder` 가 있는 쓰기는 AI 다. 건드린 파일의 잠금을 얻고, 턴이 끝나면 `release_locks` 로
  한꺼번에 푼다.
- `holder` 가 없는 쓰기는 사람이다. 잠금을 얻지 않고, 살아 있는 잠금이 있으면 막힌다.

한 프로젝트의 트리 변경은 프로젝트 행 잠금으로 직렬화한다. 동시 편집은 드물다고 보고
(ADR-0008) 더 잘게 나누지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from dahaze_api.application.errors import (
    AccessDenied,
    Conflict,
    FolderNotEmpty,
    Locked,
    NotFound,
)
from dahaze_api.domain.entities import ProjectMembership
from dahaze_api.domain.ports import ProjectRepositoryPort, TreeRepositoryPort
from dahaze_api.domain.tree import (
    ROOT,
    ChangeKind,
    Commit,
    FileLock,
    TreeFile,
    TreeFolder,
    describe_change,
    is_file_path,
    is_folder_path,
    is_under,
    join_path,
    parent_of,
    rebase,
)

Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class TreeEntry:
    """`ls` 한 줄."""

    kind: Literal["folder", "file"]
    path: str
    change: ChangeKind | None = None
    locked_by: str | None = None


@dataclass(frozen=True, slots=True)
class _Snapshot:
    """트랜잭션 안에서 읽은 트리 전체. 프로젝트 하나의 문서 수는 수십 개 수준이다."""

    folders: dict[str, TreeFolder]
    live: dict[str, TreeFile]
    files: list[TreeFile]
    locks: dict[UUID, FileLock]

    def exists(self, path: str) -> bool:
        return path == ROOT or path in self.folders or path in self.live

    def is_folder(self, path: str) -> bool:
        return path == ROOT or path in self.folders

    def live_lock(self, file_id: UUID, now: datetime) -> FileLock | None:
        lock = self.locks.get(file_id)
        return lock if lock is not None and lock.is_live(now) else None


class TreeService:
    def __init__(
        self,
        *,
        projects: ProjectRepositoryPort,
        tree: TreeRepositoryPort,
        clock: Clock = _utcnow,
    ) -> None:
        self._projects = projects
        self._tree = tree
        self._clock = clock

    # ------------------------------------------------------------------ 읽기

    async def ls(self, *, actor_id: UUID, project_id: UUID, path: str = ROOT) -> list[TreeEntry]:
        """`path` 아래 전체. 폴더가 먼저, 각각 경로순."""
        await self._require_member(actor_id, project_id)
        snap = await self._snapshot(project_id)
        if not snap.is_folder(path):
            raise NotFound(f"폴더가 없다: {path}")
        now = self._clock()
        entries = [
            TreeEntry(kind="folder", path=folder)
            for folder in sorted(snap.folders)
            if is_under(folder, path)
        ]
        for file_path in sorted(snap.live):
            if not is_under(file_path, path):
                continue
            file = snap.live[file_path]
            lock = snap.live_lock(file.id, now)
            entries.append(
                TreeEntry(
                    kind="file",
                    path=file_path,
                    change=file.change,
                    locked_by=lock.holder if lock else None,
                )
            )
        return entries

    async def read(self, *, actor_id: UUID, project_id: UUID, path: str) -> TreeFile:
        await self._require_member(actor_id, project_id)
        snap = await self._snapshot(project_id)
        return self._file(snap, path)

    async def changes(self, *, actor_id: UUID, project_id: UUID) -> list[TreeFile]:
        """commit 안 된 변경이 있는 파일. 지워진 파일도 포함한다."""
        await self._require_member(actor_id, project_id)
        snap = await self._snapshot(project_id)
        return [file for file in snap.files if file.change is not None]

    async def list_commits(self, *, actor_id: UUID, project_id: UUID) -> list[Commit]:
        await self._require_member(actor_id, project_id)
        return await self._tree.list_commits(project_id)

    async def get_commit(self, *, actor_id: UUID, commit_id: UUID) -> Commit:
        commit = await self._tree.get_commit(commit_id)
        if commit is None:
            raise NotFound("commit 을 찾을 수 없다")
        await self._require_member(actor_id, commit.project_id)
        return commit

    # ------------------------------------------------------------------ 쓰기

    async def mkdir(
        self, *, actor_id: UUID, project_id: UUID, parent: str, name: str
    ) -> TreeFolder:
        snap = await self._begin_write(actor_id, project_id)
        path = join_path(parent, name)
        if not is_folder_path(path):
            raise Conflict(f"폴더 경로가 올바르지 않다: {path!r}")
        self._require_parent(snap, path)
        self._require_free(snap, path)
        return await self._tree.create_folder(project_id=project_id, path=path)

    async def add(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        parent: str,
        name: str,
        content: str,
        holder: str | None = None,
    ) -> TreeFile:
        snap = await self._begin_write(actor_id, project_id)
        path = join_path(parent, name)
        if not is_file_path(path):
            raise Conflict(f"파일 경로가 올바르지 않다: {path!r} (.rspdl 로 끝나야 한다)")
        self._require_parent(snap, path)
        self._require_free(snap, path)
        created = await self._tree.create_file(
            project_id=project_id, path=path, text=content, actor_id=actor_id
        )
        await self._claim(snap, [created], actor_id=actor_id, holder=holder)
        return created

    async def edit(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        path: str,
        content: str,
        holder: str | None = None,
    ) -> TreeFile:
        """전문을 바꾼다. 사람의 저장 버튼도 이 경로다."""
        snap = await self._begin_write(actor_id, project_id)
        file = self._file(snap, path)
        await self._claim(snap, [file], actor_id=actor_id, holder=holder)
        return await self._tree.update_file(file.id, actor_id=actor_id, text=content)

    async def move(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        source: str,
        target: str,
        holder: str | None = None,
    ) -> list[TreeFile]:
        """파일이나 폴더를 옮긴다. 파일 ID 가 유지되므로 이력이 이어진다."""
        snap = await self._begin_write(actor_id, project_id)
        if source == ROOT:
            raise Conflict("루트는 옮길 수 없다")
        if source == target:
            raise Conflict("같은 경로로는 옮길 수 없다")
        self._require_parent(snap, target)
        self._require_free(snap, target)

        if source in snap.live:
            if not is_file_path(target):
                raise Conflict(f"파일 경로가 올바르지 않다: {target!r} (.rspdl 로 끝나야 한다)")
            file = snap.live[source]
            await self._claim(snap, [file], actor_id=actor_id, holder=holder)
            return [await self._tree.update_file(file.id, actor_id=actor_id, path=target)]

        if source not in snap.folders:
            raise NotFound(f"경로가 없다: {source}")
        if not is_folder_path(target):
            raise Conflict(f"폴더 경로가 올바르지 않다: {target!r}")
        if is_under(target, source):
            raise Conflict("폴더를 자기 안으로 옮길 수 없다")

        files = [file for path, file in snap.live.items() if is_under(path, source)]
        await self._claim(snap, files, actor_id=actor_id, holder=holder)
        for path, folder in snap.folders.items():
            if path == source or is_under(path, source):
                await self._tree.move_folder(folder.id, path=rebase(path, source, target))
        return [
            await self._tree.update_file(
                file.id, actor_id=actor_id, path=rebase(file.path, source, target)
            )
            for file in files
        ]

    async def delete(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        path: str,
        holder: str | None = None,
        recursive: bool = False,
    ) -> list[str]:
        """지운 파일 경로. 비어 있지 않은 폴더는 `recursive` 없이 지우지 않는다."""
        snap = await self._begin_write(actor_id, project_id)
        if path == ROOT:
            raise Conflict("루트는 지울 수 없다")

        if path in snap.live:
            file = snap.live[path]
            await self._claim(snap, [file], actor_id=actor_id, holder=holder)
            await self._discard(file, actor_id=actor_id)
            return [path]

        if path not in snap.folders:
            raise NotFound(f"경로가 없다: {path}")
        folders = [folder for p, folder in snap.folders.items() if is_under(p, path)]
        files = [file for p, file in snap.live.items() if is_under(p, path)]
        if (folders or files) and not recursive:
            raise FolderNotEmpty(
                f"비어 있지 않은 폴더다: {path} (항목 {len(folders) + len(files)}개)",
                path=path,
                entries=len(folders) + len(files),
            )
        await self._claim(snap, files, actor_id=actor_id, holder=holder)
        for file in files:
            await self._discard(file, actor_id=actor_id)
        for folder in [*folders, snap.folders[path]]:
            await self._tree.delete_folder(folder.id)
        return [file.path for file in files]

    async def commit(
        self,
        *,
        actor_id: UUID,
        project_id: UUID,
        paths: Sequence[str],
        message: str,
        holder: str | None = None,
    ) -> Commit:
        """고른 파일의 변경만 이력으로 남긴다. 이동한 파일은 옛 경로로도 고를 수 있다."""
        snap = await self._begin_write(actor_id, project_id)
        message = message.strip()
        if not message:
            raise Conflict("commit 메시지가 필요하다")
        if not paths:
            raise Conflict("commit 할 파일을 하나 이상 골라야 한다")

        chosen: dict[UUID, TreeFile] = {}
        for path in paths:
            matched = [f for f in snap.files if f.change is not None and f.matches(path)]
            if not matched:
                raise Conflict(f"commit 할 변경이 없는 경로다: {path}")
            chosen.update((f.id, f) for f in matched)

        # commit 은 잠금을 얻지 않는다. 남이 쓰고 있는 파일을 중간 상태로 이력에 넣지 않도록
        # 막기만 한다.
        self._reject_foreign_locks(snap, chosen.values(), holder=holder)
        files = sorted(chosen.values(), key=lambda f: f.committed_path or f.path)
        commit = await self._tree.create_commit(
            project_id=project_id,
            author_id=actor_id,
            message=message,
            changes=[describe_change(file) for file in files],
        )
        for file in files:
            if file.change is ChangeKind.DELETE:
                await self._tree.remove_file(file.id)
            else:
                await self._tree.mark_committed(file.id)
        return commit

    async def release_locks(self, *, holder: str, project_id: UUID | None = None) -> int:
        """보유자의 잠금을 모두 푼다. 턴 종료·강제 종료·MCP `unlock` 이 부른다.

        접근 검사를 하지 않는다. 자기 `holder` 를 아는 쪽만 부를 수 있고, 푸는 것은 남의
        데이터를 바꾸지 않는다.
        """
        return await self._tree.release_locks(holder=holder, project_id=project_id)

    # ------------------------------------------------------------------ 내부

    async def _require_member(self, actor_id: UUID, project_id: UUID) -> ProjectMembership:
        # 멤버가 아니면 없는 것으로 보인다. 남의 프로젝트가 존재한다는 사실을 숨긴다.
        membership = await self._projects.membership_of(project_id=project_id, user_id=actor_id)
        if membership is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        return membership

    async def _begin_write(self, actor_id: UUID, project_id: UUID) -> _Snapshot:
        membership = await self._require_member(actor_id, project_id)
        if not membership.role.can_write:
            raise AccessDenied("이 프로젝트에 쓰기 권한이 없다")
        project = await self._projects.get(project_id)
        if project is None:
            raise NotFound("프로젝트를 찾을 수 없다")
        if project.is_archived:
            raise Conflict("보관된 프로젝트는 바꿀 수 없다")
        await self._tree.lock_project(project_id)
        return await self._snapshot(project_id)

    async def _snapshot(self, project_id: UUID) -> _Snapshot:
        folders = await self._tree.list_folders(project_id)
        files = await self._tree.list_files(project_id)
        locks = await self._tree.list_locks(project_id)
        return _Snapshot(
            folders={folder.path: folder for folder in folders},
            live={file.path: file for file in files if not file.deleted},
            files=files,
            locks={lock.file_id: lock for lock in locks},
        )

    @staticmethod
    def _file(snap: _Snapshot, path: str) -> TreeFile:
        file = snap.live.get(path)
        if file is None:
            raise NotFound(f"파일이 없다: {path}")
        return file

    @staticmethod
    def _require_parent(snap: _Snapshot, path: str) -> None:
        parent = parent_of(path)
        if not snap.is_folder(parent):
            raise NotFound(f"상위 폴더가 없다: {parent}")

    @staticmethod
    def _require_free(snap: _Snapshot, path: str) -> None:
        if snap.exists(path):
            raise Conflict(f"이미 있는 경로다: {path}")

    def _reject_foreign_locks(
        self, snap: _Snapshot, files: Iterable[TreeFile], *, holder: str | None
    ) -> None:
        now = self._clock()
        blocked = [
            (file.path, lock.holder)
            for file in files
            if (lock := snap.live_lock(file.id, now)) is not None and lock.holder != holder
        ]
        if blocked:
            paths = [path for path, _ in blocked]
            raise Locked(
                f"다른 작업이 잠근 파일이다: {', '.join(paths)}",
                paths=paths,
                holders=sorted({h for _, h in blocked}),
            )

    async def _claim(
        self,
        snap: _Snapshot,
        files: Sequence[TreeFile],
        *,
        actor_id: UUID,
        holder: str | None,
    ) -> None:
        """쓰기 전에 잠금을 확인한다. AI 쓰기면 잠금을 얻거나 마지막 쓰기 시각을 갱신한다."""
        self._reject_foreign_locks(snap, files, holder=holder)
        if holder is None:
            return
        now = self._clock()
        for file in files:
            taken = await self._tree.put_lock(
                file_id=file.id,
                project_id=file.project_id,
                holder=holder,
                actor_id=actor_id,
                now=now,
            )
            if not taken:
                # 스냅샷 이후 누가 잠갔다. 프로젝트 행 잠금이 있으면 오지 않는 경로지만,
                # 조용히 잠금 없이 쓰는 것보다 실패가 낫다.
                raise Locked(
                    f"다른 작업이 잠근 파일이다: {file.path}", paths=[file.path], holders=[]
                )

    async def _discard(self, file: TreeFile, *, actor_id: UUID) -> None:
        # commit 된 적 없는 파일은 이력에 남길 것이 없다. 행째 없앤다.
        if file.committed_path is None:
            await self._tree.remove_file(file.id)
        else:
            await self._tree.update_file(file.id, actor_id=actor_id, deleted=True)
