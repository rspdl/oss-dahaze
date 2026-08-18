#!/usr/bin/env bash
#
# 인스턴스 위에서 도는 롤아웃 스크립트. GitHub Actions 가 `ssm send-command` 로 실행한다.
# user_data 가 /opt/dahaze 에 배치한다.
#
#   rollout.sh <이미지 태그>
#
# **시크릿이 밖에서 들어오지 않는다.** 이 인스턴스는 SSM 관리형으로 등록돼 있어 IAM 역할을
# 가지므로, Parameter Store 에서 직접 읽는다 (ADR-0004). 배포 파이프라인 로그·아티팩트에
# 값이 남지 않는다.
#
# 순서가 중요하다.
#   1. 아키텍처 확인 — 여기서 틀리면 뒤가 전부 무의미하다
#   2. dahaze-env-sync 로 Parameter Store → .env
#   3. 새 이미지 pull
#   4. 마이그레이션 (트래픽 받기 전)
#   5. api 교체
#   6. 헬스체크. 실패하면 이전 이미지로 되돌린다

set -euo pipefail

# 기본값은 인스턴스의 실제 경로다. 테스트에서만 다른 곳을 가리킨다.
APP_DIR="${DAHAZE_APP_DIR:-/opt/dahaze}"
SSM_PREFIX="${DAHAZE_SSM_PREFIX:-/dahaze/prod}"
IMAGE_TAG="${1:?이미지 태그가 필요하다}"

cd "$APP_DIR"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

compose() { docker compose -f docker-compose.prod.yml --env-file .env "$@"; }

log "아키텍처 확인"
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "✗ $ARCH 에서는 배포할 수 없다." >&2
  echo "  RSPDL 은 linux aarch64 wheel 도 sdist 도 배포하지 않아 API 이미지가 뜨지 못한다." >&2
  echo "  근거: docs/adr/0002-rspdl-compiler-integration.md" >&2
  exit 1
fi
echo "✓ $ARCH"

# 롤백 대상. 첫 배포면 비어 있다.
PREVIOUS_IMAGE=$(grep -E '^API_IMAGE=' .env 2>/dev/null | cut -d= -f2- || true)

if [ "${DAHAZE_SKIP_SSM:-0}" != "1" ]; then
  log "Parameter Store 에서 설정 동기화"
  # 동기화는 `dahaze-env-sync` 가 소유한다 (user_data 가 설치한다). 여기서 같은 일을
  # 다시 구현하면 두 곳이 갈라지고, 갈라진 쪽은 배포가 깨질 때까지 아무도 모른다.
  # 그 스크립트는 API_IMAGE 를 보존하고, placeholder 가 남아 있으면 여기서 멈춘다.
  /usr/local/bin/dahaze-env-sync
fi

# API_IMAGE 는 Parameter Store 가 아니라 배포가 정한다.
if grep -qE '^API_IMAGE=' .env; then
  sed -i "s|^API_IMAGE=.*|API_IMAGE=${IMAGE_TAG}|" .env
else
  echo "API_IMAGE=${IMAGE_TAG}" >> .env
fi

# 이미지가 비공개면 레지스트리 로그인이 필요하다. 토큰이 Parameter Store 에 있을 때만 한다.
GHCR_TOKEN=$(grep -E '^GHCR_TOKEN=' .env | cut -d= -f2- || true)
GHCR_USER=$(grep -E '^GHCR_USER=' .env | cut -d= -f2- || true)
if [ -n "$GHCR_TOKEN" ] && [ -n "$GHCR_USER" ]; then
  log "레지스트리 로그인"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

log "새 이미지 받기: $IMAGE_TAG"
# 레지스트리에서 받지 못해도, 그 이미지가 이미 로컬에 있으면 계속한다.
# (수동 배포에서 `docker save | docker load` 로 넣어 둔 경우가 그렇다.)
# 둘 다 아니면 여기서 멈춘다 — 없는 이미지로 compose 를 올리면 원인이 더 흐려진다.
if ! docker pull "$IMAGE_TAG" 2>&1; then
  if docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    echo "레지스트리에서 받지 못했다. 로컬에 있는 같은 태그를 쓴다."
  else
    echo "✗ 이미지를 받을 수 없고 로컬에도 없다: $IMAGE_TAG" >&2
    exit 1
  fi
fi

log "DB 기동 확인"
compose up -d db
for _ in $(seq 1 30); do
  if compose exec -T db pg_isready -q 2>/dev/null; then break; fi
  sleep 2
done

log "마이그레이션 (트래픽 받기 전)"
# 실패하면 여기서 멈춘다. 이전 버전이 계속 뜬 채로 남는다 — 반쯤 마이그레이션된 스키마에
# 옛 코드가 붙는 것보다 낫다.
compose run --rm api alembic upgrade head

log "api 교체"
compose up -d --no-deps api

log "헬스체크"
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -sf --max-time 5 http://127.0.0.1:8400/health >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "✗ 헬스체크 실패" >&2
  compose logs --tail 50 api >&2

  if [ -n "$PREVIOUS_IMAGE" ]; then
    echo "이전 이미지로 되돌린다: $PREVIOUS_IMAGE" >&2
    sed -i "s|^API_IMAGE=.*|API_IMAGE=${PREVIOUS_IMAGE}|" .env
    compose up -d --no-deps api
    echo >&2
    echo "되돌렸지만 **마이그레이션은 되돌리지 않았다.** 스키마가 새 버전인 채로 옛 코드가" >&2
    echo "도는 상태이므로 사람이 확인해야 한다." >&2
  else
    echo "첫 배포라 되돌릴 이미지가 없다." >&2
  fi
  exit 1
fi

log "정리"
docker image prune -f --filter "until=168h" >/dev/null || true

curl -s http://127.0.0.1:8400/health
printf '\n\033[32m배포 완료: %s\033[0m\n' "$IMAGE_TAG"
