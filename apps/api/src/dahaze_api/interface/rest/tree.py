"""작업 트리·commit 엔드포인트 (ADR-0008).

사람의 에디터가 쓰는 경로다. 잠금 보유자(`holder`)를 받지 않으므로, AI 가 잠근 파일은
여기서 저장할 수 없다. 컴파일 진단은 오류가 아니라 `200` 응답 안에 담긴다.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from dahaze_api.application.errors import (
    AccessDenied,
    Conflict,
    FolderNotEmpty,
    Locked,
    NotFound,
)
from dahaze_api.domain.tree import ROOT
from dahaze_api.interface.rest.dependencies import CurrentUser, Inspector, Tree
from dahaze_api.interface.rest.tree_schemas import (
    CommitRequest,
    CommitResponse,
    CreateFileRequest,
    CreateFolderRequest,
    DeleteRequest,
    DeleteResponse,
    FolderResponse,
    GrepResponse,
    MoveRequest,
    SaveFileRequest,
    SymbolSearchResponse,
    TreeCompileResponse,
    TreeEntryResponse,
    TreeFileResponse,
    commit_out,
    compile_out,
    entry_out,
    file_out,
    folder_out,
    grep_out,
    search_out,
)

router = APIRouter(prefix="/api", tags=["tree"])


@contextmanager
def _http_errors() -> Iterator[None]:
    """유스케이스 오류 → HTTP. 잠금과 비어 있지 않은 폴더는 화면이 구분해야 하므로
    `code` 를 붙인다."""
    try:
        yield
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except Locked as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "locked", "message": str(exc), "paths": exc.paths, "holders": exc.holders},
        ) from exc
    except FolderNotEmpty as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "folder_not_empty",
                "message": str(exc),
                "path": exc.path,
                "entries": exc.entries,
            },
        ) from exc
    except Conflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# ------------------------------------------------------------------ 읽기


@router.get("/projects/{project_id}/tree", name="list_tree")
async def list_tree(
    project_id: UUID,
    user: CurrentUser,
    tree: Tree,
    path: str = Query(default=ROOT, description="이 폴더 아래 전체를 돌려준다"),
) -> list[TreeEntryResponse]:
    with _http_errors():
        entries = await tree.ls(actor_id=user.id, project_id=project_id, path=path)
    return [entry_out(e) for e in entries]


@router.get("/projects/{project_id}/tree/file", name="read_tree_file")
async def read_tree_file(
    project_id: UUID, user: CurrentUser, tree: Tree, path: str = Query()
) -> TreeFileResponse:
    with _http_errors():
        file = await tree.read(actor_id=user.id, project_id=project_id, path=path)
    return file_out(file)


@router.get("/projects/{project_id}/tree/changes", name="list_tree_changes")
async def list_tree_changes(
    project_id: UUID, user: CurrentUser, tree: Tree
) -> list[TreeFileResponse]:
    """commit 안 된 변경이 있는 파일. 지운 파일도 포함한다."""
    with _http_errors():
        files = await tree.changes(actor_id=user.id, project_id=project_id)
    return [file_out(f) for f in files]


@router.get("/projects/{project_id}/tree/compile", name="compile_tree")
async def compile_tree(
    project_id: UUID, user: CurrentUser, inspector: Inspector
) -> TreeCompileResponse:
    """작업 트리 전체를 컴파일한 진단. 진단은 오류 응답이 아니다."""
    with _http_errors():
        result = await inspector.compile(actor_id=user.id, project_id=project_id)
    return compile_out(result)


@router.get("/projects/{project_id}/tree/search", name="search_tree_symbols")
async def search_tree_symbols(
    project_id: UUID,
    user: CurrentUser,
    inspector: Inspector,
    query: str = Query(default="", description="심볼 ID·이름 부분 일치"),
    kind: str | None = Query(default=None, description="IR 컬렉션 경로. 예: models"),
) -> SymbolSearchResponse:
    with _http_errors():
        result = await inspector.search(
            actor_id=user.id, project_id=project_id, query=query, kind=kind
        )
    return search_out(result)


@router.get("/projects/{project_id}/tree/grep", name="grep_tree")
async def grep_tree(
    project_id: UUID,
    user: CurrentUser,
    inspector: Inspector,
    pattern: str = Query(description="RE2 정규식"),
    path_glob: str | None = Query(default=None, description="`*` 는 `/` 도 넘는다"),
) -> GrepResponse:
    with _http_errors():
        result = await inspector.grep(
            actor_id=user.id, project_id=project_id, pattern=pattern, path_glob=path_glob
        )
    return grep_out(result)


# ------------------------------------------------------------------ 쓰기


@router.post(
    "/projects/{project_id}/tree/folders",
    name="create_tree_folder",
    status_code=status.HTTP_201_CREATED,
)
async def create_tree_folder(
    project_id: UUID, body: CreateFolderRequest, user: CurrentUser, tree: Tree
) -> FolderResponse:
    with _http_errors():
        folder = await tree.mkdir(
            actor_id=user.id, project_id=project_id, parent=body.parent, name=body.name
        )
    return folder_out(folder)


@router.post(
    "/projects/{project_id}/tree/files",
    name="create_tree_file",
    status_code=status.HTTP_201_CREATED,
)
async def create_tree_file(
    project_id: UUID, body: CreateFileRequest, user: CurrentUser, tree: Tree
) -> TreeFileResponse:
    with _http_errors():
        file = await tree.add(
            actor_id=user.id,
            project_id=project_id,
            parent=body.parent,
            name=body.name,
            content=body.content,
        )
    return file_out(file)


@router.put("/projects/{project_id}/tree/file", name="save_tree_file")
async def save_tree_file(
    project_id: UUID, body: SaveFileRequest, user: CurrentUser, tree: Tree
) -> TreeFileResponse:
    """에디터의 저장 버튼. AI 가 잠근 파일이면 409 `locked`."""
    with _http_errors():
        file = await tree.edit(
            actor_id=user.id, project_id=project_id, path=body.path, content=body.content
        )
    return file_out(file)


@router.post("/projects/{project_id}/tree/move", name="move_tree_entry")
async def move_tree_entry(
    project_id: UUID, body: MoveRequest, user: CurrentUser, tree: Tree
) -> list[TreeFileResponse]:
    with _http_errors():
        moved = await tree.move(
            actor_id=user.id, project_id=project_id, source=body.source, target=body.target
        )
    return [file_out(f) for f in moved]


@router.post("/projects/{project_id}/tree/delete", name="delete_tree_entry")
async def delete_tree_entry(
    project_id: UUID, body: DeleteRequest, user: CurrentUser, tree: Tree
) -> DeleteResponse:
    """비어 있지 않은 폴더를 `recursive` 없이 지우면 409 `folder_not_empty`."""
    with _http_errors():
        deleted = await tree.delete(
            actor_id=user.id, project_id=project_id, path=body.path, recursive=body.recursive
        )
    return DeleteResponse(deleted_files=deleted)


# ------------------------------------------------------------------ commit


@router.post(
    "/projects/{project_id}/commits",
    name="create_commit",
    status_code=status.HTTP_201_CREATED,
)
async def create_commit(
    project_id: UUID, body: CommitRequest, user: CurrentUser, tree: Tree
) -> CommitResponse:
    with _http_errors():
        commit = await tree.commit(
            actor_id=user.id, project_id=project_id, paths=body.paths, message=body.message
        )
    return commit_out(commit)


@router.get("/projects/{project_id}/commits", name="list_commits")
async def list_commits(project_id: UUID, user: CurrentUser, tree: Tree) -> list[CommitResponse]:
    """최신이 먼저."""
    with _http_errors():
        commits = await tree.list_commits(actor_id=user.id, project_id=project_id)
    return [commit_out(c) for c in commits]


@router.get("/commits/{commit_id}", name="get_commit")
async def get_commit(commit_id: UUID, user: CurrentUser, tree: Tree) -> CommitResponse:
    with _http_errors():
        commit = await tree.get_commit(actor_id=user.id, commit_id=commit_id)
    return commit_out(commit)
