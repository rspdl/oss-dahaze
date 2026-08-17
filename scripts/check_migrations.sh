#!/usr/bin/env bash
#
# 마이그레이션이 ORM 모델과 일치하는지 검사한다.
#
# 테스트는 `Base.metadata.create_all` 로 스키마를 세우므로, 마이그레이션을 빠뜨려도
# 전부 통과한다. 그 상태로 배포하면 `alembic upgrade head` 가 만든 실제 스키마에는
# 새 컬럼이 없어서 런타임에 터진다. 이 게이트가 그 틈을 막는다.
#
# `alembic check` 은 현재 DB 상태와 모델을 비교해 미반영 변경이 있으면 실패한다.

set -euo pipefail

cd "$(dirname "$0")/../apps/api"

echo "마이그레이션 적용 중…"
uv run alembic upgrade head >/dev/null

if ! uv run alembic check; then
  echo >&2
  echo "모델에 마이그레이션으로 반영되지 않은 변경이 있다." >&2
  echo "고치는 법:" >&2
  echo "  cd apps/api && uv run alembic revision --autogenerate -m '<변경 설명>'" >&2
  exit 1
fi
