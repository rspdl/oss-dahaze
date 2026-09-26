"""컴파일 결과에서 심볼과 진단을 읽는다 (`RspdlIndexerPort`).

`rspdl` 을 import 하지 않지만 IR 모양에 의존하므로 이 디렉터리에 둔다. rspdl 을 올릴 때
`local_adapter.py` 와 함께 점검한다.

심볼 종류를 하나씩 나열하지 않는다. `id` 와 `span` 을 가진 노드를 전부 심볼로 보고, 종류는
IR 의 컬렉션 경로로 붙인다. 컴파일러가 종류를 추가해도 이 파일을 고치지 않아도 된다.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from dahaze_api.domain.rspdl import FileDiagnostic, RspdlIndex, RspdlSymbol, UnparsedFile

MODULE_KIND = "module"


class LocalRspdlIndexer:
    def index(self, result: Mapping[str, Any]) -> RspdlIndex:
        """`result` 는 `AnalysisOutcome.result` 다."""
        symbols: list[RspdlSymbol] = []
        unparsed: list[UnparsedFile] = []
        diagnostics: list[FileDiagnostic] = []
        for file in _files(result):
            path = str(file.get("path", ""))
            file_diagnostics = [d for d in file.get("diagnostics") or [] if isinstance(d, Mapping)]
            diagnostics.extend(FileDiagnostic(path=path, diagnostic=d) for d in file_diagnostics)
            module = file.get("module")
            if not isinstance(module, Mapping):
                errors = sum(1 for d in file_diagnostics if d.get("severity") == "error")
                unparsed.append(UnparsedFile(path=path, error_count=errors))
                continue
            symbols.extend(_symbols(module, kind=MODULE_KIND, path=path))
        return RspdlIndex(
            symbols=tuple(symbols), unparsed=tuple(unparsed), diagnostics=tuple(diagnostics)
        )


def _files(result: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    # `AnalysisOutcome.result` 는 SDK 응답의 `result` 필드다. `files` 가 최상위에 있다.
    files = result.get("files")
    for file in files if isinstance(files, list) else []:
        if isinstance(file, Mapping):
            yield file


def _symbols(node: Any, *, kind: str, path: str) -> Iterator[RspdlSymbol]:
    if isinstance(node, list):
        for item in node:
            yield from _symbols(item, kind=kind, path=path)
        return
    if not isinstance(node, Mapping):
        return
    symbol = _symbol(node, kind=kind, path=path)
    if symbol is not None:
        yield symbol
    for key, value in node.items():
        if key == "span":
            continue
        child_kind = key if kind == MODULE_KIND else f"{kind}.{key}"
        yield from _symbols(value, kind=child_kind, path=path)


def _symbol(node: Mapping[str, Any], *, kind: str, path: str) -> RspdlSymbol | None:
    symbol_id = node.get("id")
    span = node.get("span")
    if not isinstance(symbol_id, str) or not isinstance(span, Mapping):
        return None
    start, end = span.get("start"), span.get("end")
    if not isinstance(start, int) or not isinstance(end, int):
        return None
    name = node.get("name")
    return RspdlSymbol(
        id=symbol_id,
        kind=kind,
        name=name if isinstance(name, str) else None,
        path=path,
        span_start=start,
        span_end=end,
    )
