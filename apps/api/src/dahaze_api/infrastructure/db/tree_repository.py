"""`TreeRepositoryPort` 의 SQLAlchemy 구현체 (ADR-0008)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.domain.tree import (
    LOCK_TTL,
    ChangeKind,
    Commit,
    CommitChange,
    FileLock,
    TreeFile,
    TreeFolder,
)
from dahaze_api.infrastructure.db.models import (
    CommitChangeRow,
    CommitRow,
    FileLockRow,
    ProjectRow,
    TreeFileRow,
    TreeFolderRow,
)


def _to_folder(row: TreeFolderRow) -> TreeFolder:
    return TreeFolder(
        id=row.id, project_id=row.project_id, path=row.path, created_at=row.created_at
    )


def _to_file(row: TreeFileRow) -> TreeFile:
    return TreeFile(
        id=row.id,
        project_id=row.project_id,
        path=row.path,
        text=row.text,
        deleted=row.deleted,
        committed_path=row.committed_path,
        committed_text=row.committed_text,
        updated_by=row.updated_by,
        updated_at=row.updated_at,
    )


def _to_lock(row: FileLockRow) -> FileLock:
    return FileLock(
        file_id=row.file_id,
        project_id=row.project_id,
        holder=row.holder,
        actor_id=row.actor_id,
        last_write_at=row.last_write_at,
    )


def _to_commit(row: CommitRow) -> Commit:
    return Commit(
        id=row.id,
        project_id=row.project_id,
        seq=row.seq,
        author_id=row.author_id,
        message=row.message,
        created_at=row.created_at,
        changes=tuple(
            CommitChange(
                file_id=change.file_id,
                kind=ChangeKind(change.kind),
                old_path=change.old_path,
                new_path=change.new_path,
                diff=change.diff,
                text=change.text,
            )
            for change in row.changes
        ),
    )


class SqlTreeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def lock_project(self, project_id: UUID) -> None:
        await self._session.execute(
            select(ProjectRow.id).where(ProjectRow.id == project_id).with_for_update()
        )

    # ------------------------------------------------------------------ 폴더

    async def list_folders(self, project_id: UUID) -> list[TreeFolder]:
        rows = await self._session.scalars(
            select(TreeFolderRow)
            .where(TreeFolderRow.project_id == project_id)
            .order_by(TreeFolderRow.path)
        )
        return [_to_folder(row) for row in rows]

    async def create_folder(self, *, project_id: UUID, path: str) -> TreeFolder:
        row = TreeFolderRow(id=uuid4(), project_id=project_id, path=path)
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_folder(row)

    async def move_folder(self, folder_id: UUID, *, path: str) -> None:
        await self._session.execute(
            update(TreeFolderRow).where(TreeFolderRow.id == folder_id).values(path=path)
        )

    async def delete_folder(self, folder_id: UUID) -> None:
        await self._session.execute(delete(TreeFolderRow).where(TreeFolderRow.id == folder_id))

    # ------------------------------------------------------------------ 파일

    async def list_files(self, project_id: UUID) -> list[TreeFile]:
        rows = await self._session.scalars(
            select(TreeFileRow)
            .where(TreeFileRow.project_id == project_id)
            .order_by(TreeFileRow.path)
            .execution_options(populate_existing=True)
        )
        return [_to_file(row) for row in rows]

    async def create_file(
        self, *, project_id: UUID, path: str, text: str, actor_id: UUID
    ) -> TreeFile:
        row = TreeFileRow(
            id=uuid4(), project_id=project_id, path=path, text=text, updated_by=actor_id
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_file(row)

    async def update_file(
        self,
        file_id: UUID,
        *,
        actor_id: UUID,
        path: str | None = None,
        text: str | None = None,
        deleted: bool | None = None,
    ) -> TreeFile:
        values: dict[str, object] = {"updated_by": actor_id, "updated_at": func.now()}
        if path is not None:
            values["path"] = path
        if text is not None:
            values["text"] = text
        if deleted is not None:
            values["deleted"] = deleted
        await self._session.execute(
            update(TreeFileRow).where(TreeFileRow.id == file_id).values(**values)
        )
        row = await self._session.scalar(
            select(TreeFileRow)
            .where(TreeFileRow.id == file_id)
            .execution_options(populate_existing=True)
        )
        assert row is not None
        return _to_file(row)

    async def remove_file(self, file_id: UUID) -> None:
        await self._session.execute(delete(TreeFileRow).where(TreeFileRow.id == file_id))

    async def mark_committed(self, file_id: UUID) -> None:
        await self._session.execute(
            update(TreeFileRow)
            .where(TreeFileRow.id == file_id)
            .values(committed_path=TreeFileRow.path, committed_text=TreeFileRow.text)
        )

    # ------------------------------------------------------------------ 잠금

    async def list_locks(self, project_id: UUID) -> list[FileLock]:
        rows = await self._session.scalars(
            select(FileLockRow).where(FileLockRow.project_id == project_id)
        )
        return [_to_lock(row) for row in rows]

    async def put_lock(
        self,
        *,
        file_id: UUID,
        project_id: UUID,
        holder: str,
        actor_id: UUID,
        now: datetime,
    ) -> bool:
        stmt = insert(FileLockRow).values(
            file_id=file_id,
            project_id=project_id,
            holder=holder,
            actor_id=actor_id,
            last_write_at=now,
        )
        # 같은 보유자면 시각만 갱신하고, 만료된 남의 잠금이면 빼앗는다. 살아 있는 남의
        # 잠금은 그대로 두고 `False` 를 돌려준다 — 유스케이스가 먼저 거르지만, 여기서도 덮어쓰지
        # 않는다.
        stmt = stmt.on_conflict_do_update(
            index_elements=[FileLockRow.file_id],
            set_={
                "holder": stmt.excluded.holder,
                "actor_id": stmt.excluded.actor_id,
                "last_write_at": stmt.excluded.last_write_at,
            },
            where=(FileLockRow.holder == stmt.excluded.holder)
            | (FileLockRow.last_write_at <= stmt.excluded.last_write_at - LOCK_TTL),
        )
        taken = await self._session.scalar(stmt.returning(FileLockRow.file_id))
        return taken is not None

    async def release_locks(self, *, holder: str, project_id: UUID | None = None) -> int:
        stmt = delete(FileLockRow).where(FileLockRow.holder == holder)
        if project_id is not None:
            stmt = stmt.where(FileLockRow.project_id == project_id)
        result = await self._session.execute(stmt)
        return int(getattr(result, "rowcount", 0) or 0)

    # ------------------------------------------------------------------ commit

    async def create_commit(
        self,
        *,
        project_id: UUID,
        author_id: UUID,
        message: str,
        changes: Sequence[CommitChange],
    ) -> Commit:
        current = await self._session.scalar(
            select(func.max(CommitRow.seq)).where(CommitRow.project_id == project_id)
        )
        row = CommitRow(
            id=uuid4(),
            project_id=project_id,
            seq=(current or 0) + 1,
            author_id=author_id,
            message=message,
            changes=[
                CommitChangeRow(
                    id=uuid4(),
                    position=position,
                    file_id=change.file_id,
                    kind=change.kind.value,
                    old_path=change.old_path,
                    new_path=change.new_path,
                    diff=change.diff,
                    text=change.text,
                )
                for position, change in enumerate(changes)
            ],
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row, ["created_at"])
        return _to_commit(row)

    async def list_commits(self, project_id: UUID) -> list[Commit]:
        rows = await self._session.scalars(
            select(CommitRow)
            .where(CommitRow.project_id == project_id)
            .order_by(CommitRow.seq.desc())
        )
        return [_to_commit(row) for row in rows]

    async def get_commit(self, commit_id: UUID) -> Commit | None:
        row = await self._session.get(CommitRow, commit_id)
        return None if row is None else _to_commit(row)
