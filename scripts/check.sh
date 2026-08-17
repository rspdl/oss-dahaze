#!/usr/bin/env bash
#
# 제출 전 하네스. CI 가 도는 것과 같은 게이트를 로컬에서 먼저 돌린다.
#
#   ./scripts/check.sh
#
# CI 와 이 스크립트가 어긋나면 "로컬에서는 됐는데" 가 생기므로, 게이트를 추가할 때는
# 반드시 양쪽에 함께 추가한다.

set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "플랫폼 확인"
./scripts/check_platform.sh

step "아키텍처 경계 (ADR-0001)"
python3 scripts/check_boundaries.py

step "API 린트"
(cd apps/api && uv run ruff check .)

step "API 타입"
(cd apps/api && uv run mypy)

step "API 테스트"
(cd apps/api && uv run pytest -q)

step "OpenAPI 계약 드리프트"
./scripts/check_openapi_drift.sh

step "프론트 codegen + 타입"
pnpm codegen
pnpm typecheck

printf '\n\033[32m모든 게이트 통과\033[0m\n'
