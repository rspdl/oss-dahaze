#!/usr/bin/env python3
"""헥사고날 경계를 검사한다.

ADR-0001 은 어느 계층이 무엇을 import 할 수 있는지 정한다. 그 규칙이 주석으로만 있으면
두 번째 기여자가 들어오는 순간 무너지므로, 여기서 기계적으로 막는다.

규칙:

1. `rspdl` 은 `infrastructure/rspdl/` 안에서만 import 한다.
   RSPDL 버전 변경의 폭발 반경을 한 디렉터리로 묶기 위해서다 (ADR-0002).
2. `openai` 는 `infrastructure/llm/` 안에서만 import 한다.
3. `domain/` 은 순수해야 한다. 다른 계층도, 프레임워크도 import 하지 않는다.
4. `application/` 은 `infrastructure/` 와 `interface/` 를 import 하지 않는다.
   의존은 port 를 통해서만 흐른다.

사용:
    python3 scripts/check_boundaries.py
"""

from __future__ import annotations

import ast
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

API_SRC = Path(__file__).resolve().parent.parent / "apps" / "api" / "src" / "dahaze_api"

# 특정 서드파티를 붙잡아 둘 디렉터리. 키는 최상위 모듈 이름.
CONFINED_PACKAGES: dict[str, str] = {
    "rspdl": "infrastructure/rspdl",
    "openai": "infrastructure/llm",
}

# 계층이 import 할 수 없는 내부 계층.
FORBIDDEN_LAYER_IMPORTS: dict[str, tuple[str, ...]] = {
    "domain": ("application", "infrastructure", "interface"),
    "application": ("infrastructure", "interface"),
}

# `domain/` 이 손대면 안 되는 프레임워크. 도메인은 순수하게 둔다.
DOMAIN_FORBIDDEN_THIRD_PARTY = frozenset(
    {"fastapi", "sqlalchemy", "alembic", "httpx", "pydantic", "mcp", "starlette"}
)


@dataclass(frozen=True)
class Violation:
    path: Path
    line: int
    message: str

    def __str__(self) -> str:
        rel = self.path.relative_to(API_SRC.parent.parent.parent.parent)
        return f"{rel}:{self.line}: {self.message}"


def _imported_roots(tree: ast.AST) -> Iterator[tuple[str, int]]:
    """이 파일이 import 하는 최상위 모듈 이름들."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.split(".")[0], node.lineno
        elif isinstance(node, ast.ImportFrom):
            # 상대 import 는 같은 패키지 안이므로 계층 규칙의 대상이 아니다.
            if node.level == 0 and node.module:
                yield node.module.split(".")[0], node.lineno
                yield node.module, node.lineno


def _layer_of(path: Path) -> str:
    return path.relative_to(API_SRC).parts[0]


def _check_file(path: Path) -> Iterator[Violation]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    relative = path.relative_to(API_SRC).as_posix()
    layer = _layer_of(path)

    for name, lineno in _imported_roots(tree):
        # 규칙 1·2 — 서드파티 격리
        if name in CONFINED_PACKAGES:
            allowed = CONFINED_PACKAGES[name]
            if not relative.startswith(f"{allowed}/"):
                yield Violation(
                    path,
                    lineno,
                    f"`{name}` 은 {allowed}/ 안에서만 import 할 수 있다. "
                    f"어댑터를 통해 쓸 것 (ADR-0001).",
                )

        # 규칙 3·4 — 계층 방향
        if name.startswith("dahaze_api."):
            target_layer = name.split(".")[1] if name.count(".") >= 1 else ""
            forbidden = FORBIDDEN_LAYER_IMPORTS.get(layer, ())
            if target_layer in forbidden:
                yield Violation(
                    path,
                    lineno,
                    f"{layer}/ 는 {target_layer}/ 를 import 할 수 없다. "
                    f"의존은 port 를 통해서만 흐른다 (ADR-0001).",
                )

        # 규칙 3 — 도메인 순수성
        if layer == "domain" and name in DOMAIN_FORBIDDEN_THIRD_PARTY:
            yield Violation(
                path,
                lineno,
                f"domain/ 은 `{name}` 을 import 할 수 없다. 도메인은 프레임워크를 모른다.",
            )


def main() -> int:
    if not API_SRC.exists():
        print(f"경로를 찾을 수 없다: {API_SRC}", file=sys.stderr)
        return 1

    violations = [
        v
        for path in sorted(API_SRC.rglob("*.py"))
        for v in _check_file(path)
    ]

    if violations:
        print(f"경계 위반 {len(violations)}건:\n", file=sys.stderr)
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        print(
            "\n규칙은 docs/adr/0001-monorepo-structure-and-stack.md 에 있다.",
            file=sys.stderr,
        )
        return 1

    checked = sum(1 for _ in API_SRC.rglob("*.py"))
    print(f"경계 검사 통과 ({checked}개 파일)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
