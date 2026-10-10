"""공유 작업 트리와 commit (ADR-0008).

프로젝트마다 작업 트리 하나를 모든 멤버와 모든 세션이 같이 쓴다. 파일은 자기 작업 상태와
마지막 commit 상태를 함께 들고 있고, 둘의 차이가 곧 commit 안 된 변경이다. SVN 의
작업 사본이 base 를 들고 있는 것과 같은 구조다.

이 모듈은 ORM 도 프레임워크도 모른다.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

ROOT = "/"
MAX_PATH_LENGTH = 500

# 잠금은 그 보유자의 마지막 쓰기부터 이 시간이 지나면 만료된다.
LOCK_TTL = timedelta(minutes=10)

# 경로 조각을 명시적으로 나열한다. 문자 클래스로 뭉뚱그리면 `..` 이 통과해 상위 경로를
# 가리키는 문자열이 저장된다. `\w` 는 유니코드라 한글 이름도 받는다.
_SEGMENT = r"[\w-]+"
FOLDER_PATH_PATTERN = re.compile(rf"^(?:/{_SEGMENT})+$")
FILE_PATH_PATTERN = re.compile(rf"^(?:/{_SEGMENT})*/{_SEGMENT}(?:\.rspdl|\.wireframe\.json)$")

# 작업 트리에 둘 수 있는 파일은 두 종류다. 컴파일러에 넘기는 것은 `.rspdl` 뿐이다.
# `<문서>.wireframe.json` 은 그 문서 화면들의 와이어프레임 배치(보드 위치·Column/Row/Box 트리)다.
# 기획 의미가 아니라 표시 방식이므로 컴파일하지 않지만, 같은 commit·잠금·diff 를 탄다.
RSPDL_SUFFIX = ".rspdl"
WIREFRAME_SUFFIX = ".wireframe.json"


class InvalidPattern(ValueError):
    """grep 패턴을 컴파일할 수 없다."""


class ChangeKind(StrEnum):
    ADD = "add"
    MODIFY = "modify"
    MOVE = "move"
    DELETE = "delete"


def is_folder_path(path: str) -> bool:
    return len(path) <= MAX_PATH_LENGTH and FOLDER_PATH_PATTERN.match(path) is not None


def is_file_path(path: str) -> bool:
    return len(path) <= MAX_PATH_LENGTH and FILE_PATH_PATTERN.match(path) is not None


def is_rspdl_path(path: str) -> bool:
    return path.endswith(RSPDL_SUFFIX)


WIREFRAME_THEMES = frozenset({"wireframe", "shadcn", "material", "bootstrap"})


def wireframe_problem(path: str, text: str) -> str | None:
    """배치 파일이 읽을 수 있는 모양인지. 문제가 없으면 `None`.

    배치는 컴파일러가 보지 않으므로 저장할 때 모양만 확인한다. 깨진 JSON 을 저장하면 화면이
    그 문서의 배치를 통째로 잃는다. 노드의 세부 값은 화면이 기본값으로 채워 읽는다.
    """
    if not path.endswith(WIREFRAME_SUFFIX):
        return None
    if not text.strip():
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        return f"JSON 이 아니다 ({exc.lineno}행 {exc.colno}열: {exc.msg})"
    if not isinstance(value, dict):
        return "최상위는 JSON 객체여야 한다"
    if "screens" in value and not isinstance(value["screens"], dict):
        return "`screens` 는 화면 id 를 키로 하는 객체여야 한다"
    for screen_id, entry in (value.get("screens") or {}).items():
        if not isinstance(entry, dict):
            return f"`screens.{screen_id}` 는 객체여야 한다"
        layout = entry.get("layout")
        if layout is not None and (not isinstance(layout, dict) or layout.get("type") != "group"):
            return f'`screens.{screen_id}.layout` 은 `"type": "group"` 인 루트 노드여야 한다'
    theme = value.get("theme")
    if theme is not None and theme not in WIREFRAME_THEMES:
        return f"`theme` 은 {', '.join(sorted(WIREFRAME_THEMES))} 중 하나여야 한다"
    return None


def file_kind(path: str) -> str:
    """옮기기 전후로 종류가 같은지 볼 때 쓴다."""
    return "wireframe" if path.endswith(WIREFRAME_SUFFIX) else "rspdl"


def join_path(parent: str, name: str) -> str:
    return f"/{name}" if parent == ROOT else f"{parent}/{name}"


def parent_of(path: str) -> str:
    head, _, _ = path.rpartition("/")
    return head or ROOT


def is_under(path: str, folder: str) -> bool:
    """`path` 가 `folder` 의 자손인가. 자기 자신은 자손이 아니다."""
    if folder == ROOT:
        return path != ROOT
    return path.startswith(folder + "/")


def rebase(path: str, old_prefix: str, new_prefix: str) -> str:
    """폴더를 옮길 때 자손 경로의 접두사를 바꾼다."""
    return new_prefix + path[len(old_prefix) :]


@dataclass(frozen=True, slots=True)
class TreeFolder:
    """폴더. 빈 폴더도 남아야 `mkdir` 가 의미를 가진다.

    폴더는 commit 대상이 아니다. 이력은 파일에만 남는다.
    """

    id: UUID
    project_id: UUID
    path: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class TreeFile:
    """작업 트리의 파일 하나.

    `path`·`text` 는 작업 상태, `committed_*` 는 마지막 commit 상태다. 한 번도 commit 되지
    않은 파일은 `committed_path` 가 `None` 이다. 지워진 파일은 commit 전까지 `deleted` 로
    남아 있어야 삭제를 commit 할 수 있다.
    """

    id: UUID
    project_id: UUID
    path: str
    text: str
    deleted: bool
    committed_path: str | None
    committed_text: str | None
    updated_by: UUID | None
    updated_at: datetime

    @property
    def change(self) -> ChangeKind | None:
        """commit 안 된 변경의 종류. 변경이 없으면 `None`."""
        if self.committed_path is None:
            return ChangeKind.ADD
        if self.deleted:
            return ChangeKind.DELETE
        if self.path != self.committed_path:
            return ChangeKind.MOVE
        if self.text != self.committed_text:
            return ChangeKind.MODIFY
        return None

    def matches(self, path: str) -> bool:
        """commit 할 파일을 경로로 고를 때 쓴다. 이동한 파일은 옛 경로로도 고를 수 있다."""
        if not self.deleted and self.path == path:
            return True
        return self.change in (ChangeKind.MOVE, ChangeKind.DELETE) and self.committed_path == path


@dataclass(frozen=True, slots=True)
class FileLock:
    """AI 쓰기의 파일 잠금.

    `holder` 는 불투명한 문자열이다. 앱 AI 세션이든 MCP 클라이언트든 같은 값을 다시 내면
    같은 보유자다.
    """

    file_id: UUID
    project_id: UUID
    holder: str
    actor_id: UUID | None
    last_write_at: datetime

    def is_live(self, now: datetime) -> bool:
        return now - self.last_write_at < LOCK_TTL


@dataclass(frozen=True, slots=True)
class CommitChange:
    file_id: UUID
    kind: ChangeKind
    old_path: str | None
    new_path: str | None
    diff: str
    # 바뀐 뒤의 전문. 삭제면 `None`. diff 는 표시용이고 복원은 이 전문으로 한다 — 역패치
    # 사슬 하나가 깨져 그 이전 이력을 잃는 일을 막는다.
    text: str | None


@dataclass(frozen=True, slots=True)
class Commit:
    id: UUID
    project_id: UUID
    seq: int
    author_id: UUID | None
    message: str
    created_at: datetime
    changes: tuple[CommitChange, ...]


def describe_change(file: TreeFile) -> CommitChange:
    """commit 안 된 파일 하나를 commit 기록으로 옮긴다."""
    kind = file.change
    if kind is None:
        raise ValueError(f"변경이 없는 파일이다: {file.path}")
    old_path = file.committed_path
    new_path = None if kind is ChangeKind.DELETE else file.path
    old_text = file.committed_text or ""
    new_text = "" if kind is ChangeKind.DELETE else file.text
    return CommitChange(
        file_id=file.id,
        kind=kind,
        old_path=old_path,
        new_path=new_path,
        diff=unified_diff(old_path, new_path, old_text, new_text),
        text=None if kind is ChangeKind.DELETE else file.text,
    )


def unified_diff(old_path: str | None, new_path: str | None, old: str, new: str) -> str:
    # 줄바꿈 없이 끝나는 마지막 줄이 다음 헤더와 붙지 않도록 줄 단위로 비교한다. 끝 줄바꿈
    # 유무는 diff 에서 사라지지만 전문이 함께 남으므로 잃는 것은 없다.
    lines = difflib.unified_diff(
        old.splitlines(),
        new.splitlines(),
        fromfile=f"a{old_path}" if old_path else "/dev/null",
        tofile=f"b{new_path}" if new_path else "/dev/null",
        lineterm="",
    )
    body = "\n".join(lines)
    return body + "\n" if body else ""
