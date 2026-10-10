"""작업 트리·commit REST 스키마 (ADR-0008). OpenAPI 계약의 원본이다."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from dahaze_api.application.tree import TreeEntry
from dahaze_api.application.tree_inspection import (
    GrepResult,
    LinkedSymbol,
    SymbolFetch,
    SymbolSearch,
    TreeCompilation,
)
from dahaze_api.domain.rspdl import TextPosition
from dahaze_api.domain.tree import Commit, TreeFile, TreeFolder

ChangeKindOut = Literal["add", "modify", "move", "delete"]


class TreeEntryResponse(BaseModel):
    kind: Literal["folder", "file"] = Field(description="폴더인지 파일인지")
    path: str = Field(description="`/` 로 시작하는 전체 경로", examples=["/주문/결제.rspdl"])
    change: ChangeKindOut | None = Field(
        default=None, description="commit 안 된 변경의 종류. 변경이 없거나 폴더면 null"
    )
    locked_by: str | None = Field(
        default=None, description="이 파일을 잠근 AI 작업. 잠겨 있으면 저장할 수 없다"
    )


class TreeFileResponse(BaseModel):
    id: UUID = Field(description="파일 ID. 이동해도 바뀌지 않는다")
    path: str = Field(description="작업 트리 경로")
    text: str = Field(description="작업 트리 원문. 컴파일되지 않는 원문일 수 있다")
    change: ChangeKindOut | None = Field(description="commit 안 된 변경의 종류")
    committed_path: str | None = Field(description="마지막 commit 때의 경로. 새 파일이면 null")
    updated_by: UUID | None = Field(description="마지막으로 쓴 사용자")
    updated_at: datetime


class CreateFolderRequest(BaseModel):
    parent: str = Field(description="상위 폴더 경로. 루트는 `/`", examples=["/"])
    name: str = Field(description="폴더 이름", examples=["주문"])


class FolderResponse(BaseModel):
    id: UUID
    path: str
    created_at: datetime


class CreateFileRequest(BaseModel):
    parent: str = Field(description="상위 폴더 경로. 루트는 `/`", examples=["/주문"])
    name: str = Field(
        description="`.rspdl` 이나 `.wireframe.json` 으로 끝나는 파일 이름", examples=["결제.rspdl"]
    )
    content: str = Field(description="원문 전체")


class SaveFileRequest(BaseModel):
    path: str = Field(description="저장할 파일 경로")
    content: str = Field(description="원문 전체. 기존 원문을 통째로 바꾼다")


class MoveRequest(BaseModel):
    source: str = Field(description="옮길 파일이나 폴더의 경로")
    target: str = Field(description="옮긴 뒤의 전체 경로")


class DeleteRequest(BaseModel):
    path: str = Field(description="지울 파일이나 폴더의 경로")
    recursive: bool = Field(
        default=False, description="비어 있지 않은 폴더를 안의 항목과 함께 지운다"
    )


class DeleteResponse(BaseModel):
    deleted_files: list[str] = Field(description="지운 파일 경로")


class CommitRequest(BaseModel):
    paths: list[str] = Field(
        min_length=1,
        description="commit 할 파일 경로. 옮기거나 지운 파일은 옛 경로로도 고를 수 있다",
    )
    message: str = Field(min_length=1, description="commit 메시지")


class CommitChangeResponse(BaseModel):
    file_id: UUID
    kind: ChangeKindOut
    old_path: str | None = Field(description="바뀌기 전 경로. 새 파일이면 null")
    new_path: str | None = Field(description="바뀐 뒤 경로. 삭제면 null")
    diff: str = Field(description="unified diff")
    text: str | None = Field(description="바뀐 뒤의 원문 전체. 삭제면 null")


class CommitResponse(BaseModel):
    id: UUID
    project_id: UUID
    seq: int = Field(description="프로젝트 안에서 1부터 늘어나는 번호")
    author_id: UUID | None
    message: str
    created_at: datetime
    changes: list[CommitChangeResponse]


class PositionResponse(BaseModel):
    line: int = Field(description="1부터 세는 줄")
    column: int = Field(description="1부터 세는 열. 유니코드 코드 포인트 단위")


class LocatedDiagnosticResponse(BaseModel):
    path: str
    start: PositionResponse | None = Field(description="span 이 없으면 null")
    end: PositionResponse | None
    diagnostic: dict[str, Any] = Field(description="컴파일러가 준 진단 원본")


class TreeCompileResponse(BaseModel):
    rspdl_version: str
    wire_schema_version: int
    locale: str
    compiled: bool = Field(description="파일이 없어 컴파일하지 않았으면 false")
    diagnostics: list[LocatedDiagnosticResponse]


class SymbolMatchResponse(BaseModel):
    id: str = Field(description="컴파일러가 붙인 심볼 ID", examples=["inventory.item"])
    kind: str = Field(description="IR 의 컬렉션 경로", examples=["models", "models.fields"])
    name: str | None
    path: str
    start: PositionResponse
    end: PositionResponse


class UnparsedFileResponse(BaseModel):
    path: str
    error_count: int


class SymbolSearchResponse(BaseModel):
    matches: list[SymbolMatchResponse]
    unparsed: list[UnparsedFileResponse] = Field(
        description="구문 오류로 심볼을 읽지 못한 파일. 이 파일들의 심볼은 결과에 없다"
    )
    truncated: bool = Field(description="결과가 상한을 넘어 잘렸는지")


class FetchedSymbolResponse(BaseModel):
    id: str
    kind: str = Field(description="IR 컬렉션 경로")
    name: str | None
    path: str
    start: PositionResponse
    end: PositionResponse
    text: str = Field(description="심볼 선언의 원문 구간")


class LinkedSymbolResponse(BaseModel):
    kind: str = Field(description="컴파일러가 붙인 심볼 종류")
    id: str
    owner_id: str | None = Field(description="local ID 의 소속. 전역 ID 면 null")
    field: str = Field(description="참조를 만든 필드. 예: model_id")
    path: str
    start: PositionResponse = Field(description="참조하는 레코드의 원문 위치")
    end: PositionResponse


class SymbolFetchResponse(BaseModel):
    symbols: list[FetchedSymbolResponse] = Field(
        description="같은 ID 의 선언. local ID 면 여럿일 수 있다"
    )
    referenced_by: list[LinkedSymbolResponse] = Field(description="이 심볼을 가리키는 심볼")
    references: list[LinkedSymbolResponse] = Field(description="이 심볼이 가리키는 심볼")
    references_supported: bool = Field(
        description=(
            "컴파일러가 참조 목록을 주는가. false 면 두 목록이 비어 있어도 참조 없음이 아니다"
        )
    )
    unparsed: list[UnparsedFileResponse]


class GrepMatchResponse(BaseModel):
    path: str
    line: int
    text: str


class GrepResponse(BaseModel):
    matches: list[GrepMatchResponse]
    truncated: bool


# ---------------------------------------------------------------------- 변환
# REST 와 MCP 가 같은 모양으로 응답하도록 변환을 여기 한 곳에 둔다.


def entry_out(entry: TreeEntry) -> TreeEntryResponse:
    return TreeEntryResponse(
        kind=entry.kind,
        path=entry.path,
        change=entry.change.value if entry.change else None,
        locked_by=entry.locked_by,
    )


def file_out(file: TreeFile) -> TreeFileResponse:
    return TreeFileResponse(
        id=file.id,
        path=file.path,
        text=file.text,
        change=file.change.value if file.change else None,
        committed_path=file.committed_path,
        updated_by=file.updated_by,
        updated_at=file.updated_at,
    )


def folder_out(folder: TreeFolder) -> FolderResponse:
    return FolderResponse(id=folder.id, path=folder.path, created_at=folder.created_at)


def commit_out(commit: Commit) -> CommitResponse:
    return CommitResponse(
        id=commit.id,
        project_id=commit.project_id,
        seq=commit.seq,
        author_id=commit.author_id,
        message=commit.message,
        created_at=commit.created_at,
        changes=[
            CommitChangeResponse(
                file_id=change.file_id,
                kind=change.kind.value,
                old_path=change.old_path,
                new_path=change.new_path,
                diff=change.diff,
                text=change.text,
            )
            for change in commit.changes
        ],
    )


def _position(position: TextPosition | None) -> PositionResponse | None:
    return (
        None if position is None else PositionResponse(line=position.line, column=position.column)
    )


def compile_out(result: TreeCompilation) -> TreeCompileResponse:
    return TreeCompileResponse(
        rspdl_version=result.runtime.rspdl_version,
        wire_schema_version=result.runtime.wire_schema_version,
        locale=result.runtime.locale,
        compiled=result.compiled,
        diagnostics=[
            LocatedDiagnosticResponse(
                path=d.path,
                start=_position(d.start),
                end=_position(d.end),
                diagnostic=d.diagnostic,
            )
            for d in result.diagnostics
        ],
    )


def search_out(result: SymbolSearch) -> SymbolSearchResponse:
    return SymbolSearchResponse(
        matches=[
            SymbolMatchResponse(
                id=m.id,
                kind=m.kind,
                name=m.name,
                path=m.path,
                start=PositionResponse(line=m.start.line, column=m.start.column),
                end=PositionResponse(line=m.end.line, column=m.end.column),
            )
            for m in result.matches
        ],
        unparsed=[
            UnparsedFileResponse(path=u.path, error_count=u.error_count) for u in result.unparsed
        ],
        truncated=result.truncated,
    )


def fetch_out(result: SymbolFetch) -> SymbolFetchResponse:
    def pos(position: TextPosition) -> PositionResponse:
        return PositionResponse(line=position.line, column=position.column)

    def link(entry: LinkedSymbol) -> LinkedSymbolResponse:
        return LinkedSymbolResponse(
            kind=entry.kind,
            id=entry.id,
            owner_id=entry.owner_id,
            field=entry.field,
            path=entry.path,
            start=pos(entry.start),
            end=pos(entry.end),
        )

    return SymbolFetchResponse(
        symbols=[
            FetchedSymbolResponse(
                id=s.id,
                kind=s.kind,
                name=s.name,
                path=s.path,
                start=pos(s.start),
                end=pos(s.end),
                text=s.text,
            )
            for s in result.symbols
        ],
        referenced_by=[link(e) for e in result.referenced_by],
        references=[link(e) for e in result.references],
        references_supported=result.references_supported,
        unparsed=[
            UnparsedFileResponse(path=u.path, error_count=u.error_count) for u in result.unparsed
        ],
    )


def grep_out(result: GrepResult) -> GrepResponse:
    return GrepResponse(
        matches=[GrepMatchResponse(path=m.path, line=m.line, text=m.text) for m in result.matches],
        truncated=result.truncated,
    )
