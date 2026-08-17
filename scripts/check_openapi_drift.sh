#!/usr/bin/env bash
#
# 커밋된 openapi.json 이 실제 FastAPI 라우터와 일치하는지 검사한다.
#
# FastAPI 라우터가 API 계약의 유일한 원본이고 (ADR-0001), 프론트 훅은 openapi.json 에서
# 생성된다. 이 둘이 어긋나면 프론트는 존재하지 않는 엔드포인트를 타입 안전하게 호출하게
# 된다 — 그게 이 게이트가 막는 실패다.

set -euo pipefail

cd "$(dirname "$0")/../apps/api"

BEFORE=$(mktemp)
trap 'rm -f "$BEFORE"' EXIT

if [ ! -f openapi.json ]; then
  echo "openapi.json 이 없다. 'pnpm --filter api openapi' 를 돌리고 커밋할 것." >&2
  exit 1
fi

cp openapi.json "$BEFORE"
uv run python scripts/export_openapi.py >/dev/null

if ! diff -q "$BEFORE" openapi.json >/dev/null; then
  echo "openapi.json 이 라우터와 어긋난다." >&2
  echo >&2
  diff -u "$BEFORE" openapi.json | head -60 >&2
  echo >&2
  echo "고치는 법: pnpm --filter api openapi 를 돌리고 openapi.json 을 커밋할 것." >&2
  # 작업 트리를 건드린 채로 끝내지 않는다.
  cp "$BEFORE" openapi.json
  exit 1
fi

echo "openapi.json 이 라우터와 일치한다"
