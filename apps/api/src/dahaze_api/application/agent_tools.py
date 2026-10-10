"""앱 AI 의 도구 (ADR-0005, ADR-0008).

MCP 와 같은 도구 세트다. 차이는 둘이다.

- 프로젝트가 세션에 정해져 있어 `project_id` 인자가 없다.
- `unlock` 이 없다. 앱 AI 의 잠금은 턴이 끝날 때 runner 가 푼다.

도구 결과는 모델이 읽는 값이다. 실패도 예외로 던지지 않고 `ok=False` 결과로 돌려준다 —
모델이 실패 이유를 읽고 스스로 고칠 수 있어야 한다.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any
from uuid import UUID

from dahaze_api.application.errors import ApplicationError, FolderNotEmpty, Locked
from dahaze_api.application.tree import TreeService
from dahaze_api.application.tree_inspection import LinkedSymbol, SymbolFetch, TreeInspector
from dahaze_api.domain.agent import FileChange, ToolCall, ToolOutcome, ToolSpec
from dahaze_api.domain.rspdl import TextPosition
from dahaze_api.domain.tree import is_under


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


TOOL_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="ls",
        description=(
            "작업 트리의 폴더와 파일을 path 아래 전부 나열한다. 파일마다 commit 안 된 변경 "
            "종류(change)와 잠근 작업(locked_by)이 붙는다. 경로는 / 로 시작한다. 새 파일을 "
            "만들기 전에 이 도구로 도메인 폴더와 파일 구성을 확인한다."
        ),
        parameters=_object({"path": _string("나열할 폴더. 루트는 /")}, []),
    ),
    ToolSpec(
        name="read",
        description="파일 하나의 원문 전체를 읽는다. 편집하기 전에 반드시 먼저 읽는다.",
        parameters=_object({"path": _string("파일 경로")}, ["path"]),
    ),
    ToolSpec(
        name="search",
        description=(
            "작업 트리 전체를 컴파일해 심볼(모델·필드·역할·행동·정책·화면 등)을 찾는다. query 는 "
            "심볼 ID(예: inventory.item)나 이름(예: 재고 항목)에 부분 일치한다. kind 는 IR 컬렉션 "
            "경로(module, models, models.fields, roles, actions, policies, screens 등)로 거른다. "
            "kind 를 module 로 주면 파일마다 하나인 모듈 목록이 나온다. 결과마다 파일 경로와 줄 "
            "범위가 있다. 원문 텍스트는 찾지 않는다. unparsed 에 있는 파일은 구문 "
            "오류로 심볼을 읽지 못한 파일이다."
        ),
        parameters=_object(
            {
                "query": _string("심볼 ID·이름 부분 일치. kind 만으로 찾을 때는 빈 문자열"),
                "kind": _string("IR 컬렉션 경로. 거르지 않으면 빈 문자열"),
            },
            [],
        ),
    ),
    ToolSpec(
        name="fetch",
        description=(
            "심볼 ID 하나의 원문 구간과 연결을 돌려준다. referenced_by 는 이 심볼을 가리키는 "
            "심볼(정책·제약·화면 요소 등), references 는 이 심볼이 가리키는 심볼이다. ID 는 "
            "search 결과의 id 를 쓴다. 정책·제약 ID 는 원문을 고치면 바뀔 수 있으므로, 편집 뒤에는 "
            "모델·역할·행동처럼 이름 있는 심볼에서 다시 fetch 한다. references_supported 가 "
            "false 면 이 컴파일러는 연결을 주지 않는다."
        ),
        parameters=_object(
            {
                "id": _string("심볼 ID. 예: inventory.item"),
                "owner_id": _string(
                    "local ID 의 소속. 결과의 owner_id 를 그대로 쓴다. 전역 ID 면 빈 문자열"
                ),
            },
            ["id"],
        ),
    ),
    ToolSpec(
        name="grep",
        description=(
            "원문을 줄 단위 RE2 정규식으로 찾는다. path_glob 의 * 는 / 도 넘는다. 심볼을 찾을 "
            "때는 search 가 정확하다."
        ),
        parameters=_object(
            {
                "pattern": _string("RE2 정규식"),
                "path_glob": _string("파일 경로 glob. 거르지 않으면 빈 문자열"),
            },
            ["pattern"],
        ),
    ),
    ToolSpec(
        name="compile",
        description=(
            "작업 트리의 모든 파일을 함께 컴파일해 진단을 돌려준다. 진단마다 파일 경로와 시작·끝 "
            "줄·열이 있다. 파일을 고친 뒤에는 이 도구로 확인한다."
        ),
        parameters=_object({}, []),
    ),
    ToolSpec(
        name="mkdir",
        description=(
            "parent 폴더 아래에 name 폴더를 만든다. 루트는 / 다. 폴더는 도메인 영역(회원·예약·"
            "결제 등) 단위로 만든다. 같은 영역 폴더가 이미 있으면 만들지 않고 그 폴더를 쓴다. "
            "이름에는 한글·영숫자·_·- 만 쓴다."
        ),
        parameters=_object(
            {"parent": _string("상위 폴더"), "name": _string("폴더 이름")}, ["parent", "name"]
        ),
    ),
    ToolSpec(
        name="add",
        description=(
            "parent 폴더 아래에 name 파일을 원문 content 로 만든다. 이름은 .rspdl 로 끝나야 한다. "
            "파일 하나가 모듈 하나이므로 content 는 모듈 머리말로 시작하고, 모듈 ID 는 다른 파일과 "
            "겹치지 않아야 한다. 백틱 참조는 같은 파일 안의 선언만 찾으므로, 다른 파일의 모델을 "
            "참조해야 하면 새 파일을 만들지 말고 그 파일을 edit 한다. 작업 트리에 바로 저장된다."
        ),
        parameters=_object(
            {
                "parent": _string("상위 폴더"),
                "name": _string(".rspdl 로 끝나는 파일 이름"),
                "content": _string("RSPDL 원문 전체"),
            },
            ["parent", "name", "content"],
        ),
    ),
    ToolSpec(
        name="edit",
        description=(
            "파일 원문을 content 전체로 바꾼다. 부분 수정이 아니므로 read 로 읽은 원문에서 고친 "
            "전문을 보낸다. 작업 트리에 바로 저장된다."
        ),
        parameters=_object(
            {"path": _string("파일 경로"), "content": _string("RSPDL 원문 전체")},
            ["path", "content"],
        ),
    ),
    ToolSpec(
        name="wireframe",
        description=(
            "와이어프레임 배치 파일(<문서>.wireframe.json)에서 화면 하나의 항목만 바꾼다. 다른 "
            "화면의 항목과 모르는 키는 그대로 둔다. 파일이 없으면 만든다. 배치 파일은 edit 대신 "
            '이 도구로 고친다. layout 은 그 화면의 루트 노드 전체({"type": "group", "id": '
            '"root", ...}), theme 은 문서 전체의 UI 스타일이다. 바꾸지 않을 것은 빼고 보낸다.'
        ),
        parameters=_object(
            {
                "path": _string("배치 파일 경로. 예: /주문/카페.wireframe.json"),
                "screen_id": _string("화면 id 전체. 예: cafe_order.menu_screen"),
                "layout": {
                    "type": "object",
                    "description": "그 화면의 배치 트리 루트. 바꾸지 않으면 뺀다",
                },
                "theme": {
                    "type": "string",
                    "enum": ["wireframe", "shadcn", "material", "bootstrap"],
                    "description": "문서의 UI 스타일. 바꾸지 않으면 뺀다",
                },
            },
            ["path", "screen_id"],
        ),
    ),
    ToolSpec(
        name="mv",
        description="파일이나 폴더를 target 전체 경로로 옮긴다. 파일 이력이 이어진다.",
        parameters=_object(
            {"source": _string("옮길 경로"), "target": _string("옮긴 뒤의 전체 경로")},
            ["source", "target"],
        ),
    ),
    ToolSpec(
        name="delete",
        description=(
            "파일이나 폴더를 지운다. 비어 있지 않은 폴더는 사용자 승인을 받은 뒤 안의 항목까지 "
            "지운다."
        ),
        parameters=_object({"path": _string("지울 경로")}, ["path"]),
    ),
    ToolSpec(
        name="commit",
        description=(
            "고른 파일의 commit 안 된 변경을 이력으로 남긴다. message 는 필수다. 사용자가 commit "
            "을 요청했을 때만 부른다."
        ),
        parameters=_object(
            {
                "paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "commit 할 파일 경로. 옮기거나 지운 파일은 옛 경로로도 고를 수 있다"
                    ),
                },
                "message": _string("commit 메시지"),
            },
            ["paths", "message"],
        ),
    ),
)

TOOL_NAMES = frozenset(spec.name for spec in TOOL_SPECS)


_Handler = Callable[[Mapping[str, Any], bool], Awaitable[ToolOutcome]]


class InvalidArguments(ValueError):
    """모델이 도구 인자를 틀리게 보냈다. 결과로 돌려주어 모델이 고치게 한다."""


def _arg(arguments: Mapping[str, Any], name: str, *, default: str | None = None) -> str:
    value = arguments.get(name, default)
    if value is None:
        raise InvalidArguments(f"`{name}` 인자가 필요하다")
    if not isinstance(value, str):
        raise InvalidArguments(f"`{name}` 는 문자열이어야 한다")
    return value


def fetch_output(result: SymbolFetch) -> dict[str, Any]:
    """fetch 결과. 앱 AI 도구와 MCP 가 같은 모양을 쓴다."""

    def link(entry: LinkedSymbol) -> dict[str, Any]:
        return {
            "kind": entry.kind,
            "id": entry.id,
            "owner_id": entry.owner_id,
            "field": entry.field,
            "path": entry.path,
            "start": _position(entry.start),
            "end": _position(entry.end),
        }

    return {
        "symbols": [
            {
                "id": s.id,
                "kind": s.kind,
                "name": s.name,
                "path": s.path,
                "start": _position(s.start),
                "end": _position(s.end),
                "text": s.text,
            }
            for s in result.symbols
        ],
        "referenced_by": [link(e) for e in result.referenced_by],
        "references": [link(e) for e in result.references],
        "references_supported": result.references_supported,
        "unparsed": [{"path": u.path, "error_count": u.error_count} for u in result.unparsed],
    }


def _position(position: TextPosition | None) -> dict[str, int] | None:
    return None if position is None else {"line": position.line, "column": position.column}


class AgentToolbox:
    """세션 하나의 도구 실행기. 도구 호출마다 새 트랜잭션에서 만든다."""

    def __init__(
        self,
        *,
        tree: TreeService,
        inspector: TreeInspector,
        actor_id: UUID,
        project_id: UUID,
        holder: str,
    ) -> None:
        self._tree = tree
        self._inspector = inspector
        self._actor_id = actor_id
        self._project_id = project_id
        self._holder = holder

    async def execute(self, call: ToolCall, *, recursive_delete: bool = False) -> ToolOutcome:
        if call.name not in TOOL_NAMES:
            return ToolOutcome(ok=False, output={"error": f"없는 도구다: {call.name}"})
        try:
            handler: _Handler = getattr(self, f"_{call.name}")
            return await handler(call.arguments, recursive_delete)
        except InvalidArguments as exc:
            return ToolOutcome(ok=False, output={"error": str(exc)})
        except Locked as exc:
            return ToolOutcome(
                ok=False,
                output={
                    "error": str(exc),
                    "paths": exc.paths,
                    "holders": exc.holders,
                    "instruction": "다른 작업이 이 파일을 쓰고 있다. 사용자에게 알리고 멈춘다.",
                },
                lock_conflict=True,
            )
        except FolderNotEmpty as exc:
            return ToolOutcome(
                ok=False,
                output={"error": str(exc), "path": exc.path, "entries": exc.entries},
                needs_approval=f"{exc.path} 폴더와 안의 항목 {exc.entries}개를 지운다",
            )
        except ApplicationError as exc:
            return ToolOutcome(ok=False, output={"error": str(exc)})

    # ------------------------------------------------------------------ 읽기

    async def _ls(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        entries = await self._tree.ls(
            actor_id=self._actor_id,
            project_id=self._project_id,
            path=_arg(args, "path", default="/"),
        )
        return ToolOutcome(
            ok=True,
            output=[
                {
                    "kind": e.kind,
                    "path": e.path,
                    "change": e.change.value if e.change else None,
                    "locked_by": e.locked_by,
                }
                for e in entries
            ],
        )

    async def _read(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        file = await self._tree.read(
            actor_id=self._actor_id, project_id=self._project_id, path=_arg(args, "path")
        )
        return ToolOutcome(ok=True, output={"path": file.path, "text": file.text})

    async def _search(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        kind = _arg(args, "kind", default="") or None
        result = await self._inspector.search(
            actor_id=self._actor_id,
            project_id=self._project_id,
            query=_arg(args, "query", default=""),
            kind=kind,
        )
        return ToolOutcome(
            ok=True,
            output={
                "matches": [
                    {
                        "id": m.id,
                        "kind": m.kind,
                        "name": m.name,
                        "path": m.path,
                        "start": _position(m.start),
                        "end": _position(m.end),
                    }
                    for m in result.matches
                ],
                "unparsed": [
                    {"path": u.path, "error_count": u.error_count} for u in result.unparsed
                ],
                "truncated": result.truncated,
            },
        )

    async def _fetch(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        result = await self._inspector.fetch(
            actor_id=self._actor_id,
            project_id=self._project_id,
            symbol_id=_arg(args, "id"),
            owner_id=_arg(args, "owner_id", default="") or None,
        )
        return ToolOutcome(ok=True, output=fetch_output(result))

    async def _grep(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        result = await self._inspector.grep(
            actor_id=self._actor_id,
            project_id=self._project_id,
            pattern=_arg(args, "pattern"),
            path_glob=_arg(args, "path_glob", default="") or None,
        )
        return ToolOutcome(
            ok=True,
            output={
                "matches": [
                    {"path": m.path, "line": m.line, "text": m.text} for m in result.matches
                ],
                "truncated": result.truncated,
            },
        )

    async def _compile(self, _args: Mapping[str, Any], _: bool) -> ToolOutcome:
        result = await self._inspector.compile(actor_id=self._actor_id, project_id=self._project_id)
        return ToolOutcome(
            ok=True,
            output={
                "compiled": result.compiled,
                "diagnostics": [
                    {
                        "path": d.path,
                        "start": _position(d.start),
                        "end": _position(d.end),
                        "diagnostic": d.diagnostic,
                    }
                    for d in result.diagnostics
                ],
            },
        )

    # ------------------------------------------------------------------ 쓰기

    async def _mkdir(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        folder = await self._tree.mkdir(
            actor_id=self._actor_id,
            project_id=self._project_id,
            parent=_arg(args, "parent"),
            name=_arg(args, "name"),
        )
        return ToolOutcome(ok=True, output={"path": folder.path})

    async def _add(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        content = _arg(args, "content")
        file = await self._tree.add(
            actor_id=self._actor_id,
            project_id=self._project_id,
            parent=_arg(args, "parent"),
            name=_arg(args, "name"),
            content=content,
            holder=self._holder,
        )
        return ToolOutcome(
            ok=True,
            output={"path": file.path},
            changes=(FileChange(None, file.path, None, content),),
        )

    async def _edit(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        path = _arg(args, "path")
        content = _arg(args, "content")
        before = await self._tree.read(
            actor_id=self._actor_id, project_id=self._project_id, path=path
        )
        await self._tree.edit(
            actor_id=self._actor_id,
            project_id=self._project_id,
            path=path,
            content=content,
            holder=self._holder,
        )
        return ToolOutcome(
            ok=True,
            output={"path": path},
            changes=(FileChange(path, path, before.text, content),),
        )

    async def _wireframe(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        path = _arg(args, "path")
        screen_id = _arg(args, "screen_id")
        layout = args.get("layout")
        theme = args.get("theme")
        if layout is not None and not isinstance(layout, dict):
            raise InvalidArguments("layout 은 루트 노드 객체여야 한다")
        if theme is not None and not isinstance(theme, str):
            raise InvalidArguments("theme 은 문자열이어야 한다")
        if layout is not None and path.endswith(".wireframe.json"):
            problems = await self._inspector.check_wireframe_layout(
                actor_id=self._actor_id,
                project_id=self._project_id,
                document_path=path.removesuffix(".wireframe.json") + ".rspdl",
                screen_id=screen_id,
                layout=layout,
            )
            if problems:
                raise InvalidArguments(
                    "저장하지 않았다. 배치의 문서 요소 자리가 맞지 않는다: " + " / ".join(problems)
                )
        before, file = await self._tree.set_wireframe_screen(
            actor_id=self._actor_id,
            project_id=self._project_id,
            path=path,
            screen_id=screen_id,
            layout=layout,
            theme=theme,
            holder=self._holder,
        )
        return ToolOutcome(
            ok=True,
            output={"path": path, "screen_id": screen_id, "created": before is None},
            changes=(FileChange(None if before is None else path, path, before, file.text),),
        )

    async def _mv(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        source = _arg(args, "source")
        target = _arg(args, "target")
        moved = await self._tree.move(
            actor_id=self._actor_id,
            project_id=self._project_id,
            source=source,
            target=target,
            holder=self._holder,
        )
        changes = tuple(
            FileChange(source + file.path[len(target) :], file.path, file.text, file.text)
            for file in moved
        )
        return ToolOutcome(ok=True, output={"moved": [f.path for f in moved]}, changes=changes)

    async def _delete(self, args: Mapping[str, Any], recursive: bool) -> ToolOutcome:
        path = _arg(args, "path")
        files = await self._tree.files(actor_id=self._actor_id, project_id=self._project_id)
        texts = {f.path: f.text for f in files if f.path == path or is_under(f.path, path)}
        deleted = await self._tree.delete(
            actor_id=self._actor_id,
            project_id=self._project_id,
            path=path,
            holder=self._holder,
            recursive=recursive,
        )
        return ToolOutcome(
            ok=True,
            output={"deleted_files": deleted},
            changes=tuple(FileChange(p, None, texts.get(p), None) for p in deleted),
        )

    async def _commit(self, args: Mapping[str, Any], _: bool) -> ToolOutcome:
        paths = args.get("paths")
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            raise InvalidArguments("`paths` 는 문자열 배열이어야 한다")
        commit = await self._tree.commit(
            actor_id=self._actor_id,
            project_id=self._project_id,
            paths=paths,
            message=_arg(args, "message"),
            holder=self._holder,
        )
        return ToolOutcome(
            ok=True,
            output={
                "commit_id": str(commit.id),
                "seq": commit.seq,
                "changes": [
                    {"kind": c.kind.value, "old_path": c.old_path, "new_path": c.new_path}
                    for c in commit.changes
                ],
            },
        )
