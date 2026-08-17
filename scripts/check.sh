#!/usr/bin/env bash
#
# 제출 전 하네스. CI 가 도는 게이트를 로컬에서 먼저 돌린다.
#
#   ./scripts/check.sh
#
# 게이트를 추가할 때는 여기와 .github/workflows/ci.yml 양쪽에 함께 추가한다. 어긋나면
# "로컬에서는 됐는데" 가 생긴다.
#
# CI 에만 있는 것 (로컬에서 재현할 이유가 없는 것):
#   - `uv sync --locked` — 락파일이 실제로 고정된 상태로 설치되는지
#   - `import rspdl` 스모크 — 러너 플랫폼에서 네이티브 확장이 열리는지
#   - `git diff --exit-code` — 생성물이 실수로 커밋됐는지

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

step "마이그레이션 ↔ 모델 일치"
./scripts/check_migrations.sh

step "API 테스트"
(cd apps/api && uv run pytest -q)

step "OpenAPI 계약 드리프트"
./scripts/check_openapi_drift.sh

step "프론트 codegen + 타입"
pnpm codegen
pnpm typecheck

# api 는 위에서 이미 검사했다. turbo 가 apps/api 의 lint(uv 필요)를 다시 끌고 오지 않도록
# 걸러낸다 — CI 의 web 잡도 같은 필터를 쓴다.
step "프론트 린트 + 빌드"
pnpm exec turbo lint build --filter='!api'

printf '\n\033[32m모든 게이트 통과\033[0m\n'
