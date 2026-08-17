"""FastAPI 앱에서 openapi.json 을 뽑는다.

이 산출물은 저장소에 커밋되고 orval 의 입력이 된다. CI 는 이 스크립트를 다시 돌려
diff 가 비어 있는지 검사한다 — 커밋된 계약이 실제 라우터와 어긋나면 거기서 멈춘다.
"""

from __future__ import annotations

import json
from pathlib import Path

from dahaze_api.main import create_app

OUTPUT = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    schema = create_app().openapi()
    # 정렬·들여쓰기를 고정해 무의미한 diff 를 없앤다.
    OUTPUT.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT.relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
