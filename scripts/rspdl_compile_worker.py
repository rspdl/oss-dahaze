#!/usr/bin/env python3
"""한 rspdl 버전으로 코퍼스를 컴파일하고 진단 요약을 JSON 으로 낸다.

**격리된 프로세스에서 돈다.** 한 프로세스는 rspdl 버전을 하나만 가질 수 있으므로
(ADR-0002), 두 버전을 비교하려면 각각 별도 프로세스로 띄우는 수밖에 없다.
호출자는 `scripts/rspdl_recompile_report.py` 다.

    uv run --no-project --with 'rspdl==0.2.0' python scripts/rspdl_compile_worker.py <코퍼스디렉터리>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import rspdl


def main() -> int:
    if len(sys.argv) != 2:
        print("사용: rspdl_compile_worker.py <코퍼스디렉터리>", file=sys.stderr)
        return 2

    corpus = Path(sys.argv[1])
    documents = sorted(corpus.rglob("*.rspdl"))

    report: dict[str, Any] = {
        "rspdl_version": rspdl.__version__,
        "wire_schema_version": rspdl.WIRE_SCHEMA_VERSION,
        "locale": rspdl.SUPPORTED_LOCALE,
        "documents": {},
    }

    for path in documents:
        key = path.relative_to(corpus).as_posix()
        source = {"path": key, "text": path.read_text(encoding="utf-8")}
        try:
            response = rspdl.compile([source])
        except Exception as exc:  # noqa: BLE001 - 버전 간 어떤 실패든 리포트에 남긴다
            report["documents"][key] = {"error": f"{type(exc).__name__}: {exc}"}
            continue

        files = response["result"]["files"]
        diagnostics = files[0]["diagnostics"] if files else []
        report["documents"][key] = {
            # rule_id 와 severity 만 비교한다. span 은 무의미한 diff 를 많이 만든다.
            "diagnostics": sorted(
                f"{d['severity']}:{d['rule_id']}" for d in diagnostics
            ),
            "compiled": bool(files and files[0].get("module") is not None),
        }

    json.dump(report, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
