#!/usr/bin/env python3
"""두 rspdl 버전으로 같은 코퍼스를 컴파일하고 차이를 리포트한다.

rspdl 버전을 올리는 것은 의존성 갱신이 아니라 제품 변경이다. 문법이 바뀌면 이미 저장된
사용자 문서가 컴파일되지 않을 수 있고, 그건 배포하고 나서 알면 늦다.

각 버전은 **별도 프로세스**에서 돈다. 한 프로세스에 rspdl 두 버전을 올릴 수 없기 때문이다
(ADR-0002). `uv run --no-project --with rspdl==<버전>` 이 그 격리를 만든다.

    python3 scripts/rspdl_recompile_report.py --to 0.2.0
    python3 scripts/rspdl_recompile_report.py --from 0.1.0 --to 0.2.0 --corpus fixtures/corpus
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "scripts" / "rspdl_compile_worker.py"
PYPROJECT = ROOT / "apps" / "api" / "pyproject.toml"
DEFAULT_CORPUS = ROOT / "fixtures" / "corpus"


def pinned_version() -> str:
    """apps/api/pyproject.toml 에 고정된 현재 버전."""
    match = re.search(r'"rspdl==([^"]+)"', PYPROJECT.read_text(encoding="utf-8"))
    if not match:
        raise SystemExit("pyproject.toml 에서 rspdl 핀을 찾을 수 없다")
    return match.group(1)


def run_version(version: str, corpus: Path) -> dict[str, Any]:
    """격리된 환경에서 한 버전으로 코퍼스를 컴파일한다."""
    print(f"  rspdl=={version} 컴파일 중…", file=sys.stderr)
    completed = subprocess.run(
        [
            "uv", "run", "--no-project", "--quiet",
            "--with", f"rspdl=={version}",
            "python", str(WORKER), str(corpus),
        ],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if completed.returncode != 0:
        raise SystemExit(
            f"rspdl=={version} 실행 실패 (exit {completed.returncode}):\n{completed.stderr}"
        )
    return json.loads(completed.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description="rspdl 버전 간 재컴파일 차이 리포트")
    parser.add_argument("--from", dest="from_version", default=None,
                        help="기준 버전 (기본: pyproject.toml 의 현재 핀)")
    parser.add_argument("--to", dest="to_version", required=True, help="올리려는 버전")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS,
                        help="비교할 .rspdl 문서 디렉터리")
    args = parser.parse_args()

    from_version = args.from_version or pinned_version()
    corpus: Path = args.corpus

    if not corpus.exists():
        raise SystemExit(
            f"코퍼스가 없다: {corpus}\n"
            "  실사용 문서로 검사하려면 DB 에서 .rspdl 파일로 내보내 이 디렉터리에 둘 것."
        )

    documents = sorted(corpus.rglob("*.rspdl"))
    if not documents:
        raise SystemExit(f"코퍼스에 .rspdl 문서가 없다: {corpus}")

    print(f"코퍼스: {corpus} ({len(documents)}개 문서)", file=sys.stderr)
    before = run_version(from_version, corpus)
    after = run_version(args.to_version, corpus)

    print()
    print(f"# RSPDL 재컴파일 리포트: {from_version} → {args.to_version}")
    print()

    if before["wire_schema_version"] != after["wire_schema_version"]:
        print(
            f"**wire schema 가 바뀌었다: {before['wire_schema_version']} → "
            f"{after['wire_schema_version']}.** "
            "`infrastructure/rspdl/local_adapter.py` 의 검증을 함께 고쳐야 한다."
        )
        print()

    regressions: list[str] = []
    improvements: list[str] = []
    errors: list[str] = []

    for key in sorted(before["documents"]):
        old = before["documents"][key]
        new = after["documents"].get(key, {})

        if "error" in new:
            errors.append(f"- `{key}` — {new['error']}")
            continue
        if "error" in old:
            continue

        if old.get("compiled") and not new.get("compiled"):
            regressions.append(f"- `{key}` — 이전에는 컴파일되던 문서가 더 이상 컴파일되지 않는다")

        old_diags = set(old.get("diagnostics", []))
        new_diags = set(new.get("diagnostics", []))

        for added in sorted(new_diags - old_diags):
            regressions.append(f"- `{key}` — 새 진단 `{added}`")
        for removed in sorted(old_diags - new_diags):
            improvements.append(f"- `{key}` — 사라진 진단 `{removed}`")

    if errors:
        print("## 실행 오류\n")
        print("\n".join(errors))
        print()

    if regressions:
        print(f"## 회귀 {len(regressions)}건\n")
        print("\n".join(regressions))
        print()
        print("승격 전에 마이그레이션 경로나 멀티버전 지원 계획이 필요하다.")
    else:
        print("## 회귀 없음\n")
        print(f"{len(documents)}개 문서가 {args.to_version} 에서도 같은 진단을 낸다.")
    print()

    if improvements:
        print(f"## 사라진 진단 {len(improvements)}건\n")
        print("\n".join(improvements))
        print()
        print("의도된 개선인지 확인할 것. 검증이 조용히 약해진 것일 수도 있다.")
        print()

    return 1 if (regressions or errors) else 0


if __name__ == "__main__":
    raise SystemExit(main())
