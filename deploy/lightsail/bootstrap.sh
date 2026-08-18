#!/usr/bin/env bash
#
# 2단계 부트스트랩. SSM Run Command 로 실행한다 (user_data 가 아니다).
#
#   sudo APP_DIR=/opt/dahaze API_DOMAIN=api.dahaze.xyz ACME_EMAIL=... \
#        PREFIX_IN=/dahaze/prod REGION_IN=ap-northeast-2 ./bootstrap.sh
#
# user_data 에 넣지 않는 이유: Lightsail 의 16KB 한도가 자기 초기화 스크립트를 합친
# 크기에 걸려서 들어가지 않는다. 결과적으로 더 낫다 — 여기를 고치고 다시 돌리는 데
# 인스턴스를 다시 만들 필요가 없다.
#
# 몇 번을 실행해도 같은 상태가 되도록 쓴다.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dahaze}"
API_DOMAIN="${API_DOMAIN:?API_DOMAIN 이 필요하다}"
ACME_EMAIL="${ACME_EMAIL:?ACME_EMAIL 이 필요하다}"
PREFIX_IN="${PREFIX_IN:-/dahaze/prod}"
REGION_IN="${REGION_IN:-ap-northeast-2}"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# 1단계(user_data)가 정의하던 것들이다. 두 스크립트를 나누면서 여기서 다시 정의한다 —
# 안 하면 `set -u` 가 APT unbound 로 죽는다. 실제로 그렇게 한 번 실패했다.
export DEBIAN_FRONTEND=noninteractive
# apt 락은 cloud-init 의 unattended-upgrades 와 겹칠 수 있다. 실패시키지 말고 기다린다.
APT="apt-get -o DPkg::Lock::Timeout=600 -y"

# 이 스크립트만 따로 돌릴 수도 있으므로 아키텍처를 여기서도 확인한다.
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "✗ $ARCH — RSPDL 은 linux aarch64 를 지원하지 않는다 (ADR-0002)." >&2
  exit 1
fi

# 5. Docker
# ---------------------------------------------------------------------------
# 로그 회전 설정을 데몬 설치 전에 놓는다. 단일 인스턴스라 디스크가 차면 Postgres 가
# 먼저 죽고, 컨테이너 로그는 기본 설정에서 무한히 자란다.
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON

log "Docker"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list
$APT update
$APT install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# ---------------------------------------------------------------------------
# 6. 애플리케이션 디렉터리
# ---------------------------------------------------------------------------
# 배포는 SSM Run Command 로 들어오고 그건 root 로 돈다. 로그인 사용자가 읽을 이유가 없다.
log "${APP_DIR}"
mkdir -p "${APP_DIR}"
chown root:root "${APP_DIR}"
chmod 0750 "${APP_DIR}"

# ACME 챌린지 파일이 놓이는 곳. deploy/nginx/api.conf 가 이 경로를 참조한다.
mkdir -p /var/www/certbot

# ---------------------------------------------------------------------------
# 7. nginx 임시 사이트
# ---------------------------------------------------------------------------
# 순서 문제가 하나 있다. 저장소의 api.conf 는 인증서 파일을 include 하는데, 그 파일은
# certbot 이 발급해야 생기고, certbot 은 80번에서 챌린지를 받아 줄 nginx 가 이미 떠
# 있어야 돈다. 인증서 없이 api.conf 를 걸면 nginx 가 기동에 실패하고, 그러면 발급을
# 영원히 못 한다.
#
# 그래서 부팅 시점에는 평문 전용 임시 사이트만 건다. 전환은 dahaze-tls-bootstrap 이 한다.
log "nginx 임시 사이트"
rm -f /etc/nginx/sites-enabled/default
cat >/etc/nginx/sites-available/dahaze-bootstrap.conf <<'NGINX'
# 인증서가 발급되기 전까지만 쓰는 임시 사이트. dahaze-tls-bootstrap 이 걷어낸다.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        default_type text/plain;
        return 503 "dahaze: TLS bootstrap pending\n";
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/dahaze-bootstrap.conf /etc/nginx/sites-enabled/dahaze-bootstrap.conf
nginx -t
systemctl enable --now nginx

# api.conf 가 include 하는 두 파일을 미리 놓는다. certbot 이 nginx 인스톨러를 거쳐
# 발급할 때만 자동으로 깔리는데, 우리는 webroot 로 발급하므로 그 경로를 타지 않는다.
# 없으면 전환하는 순간 nginx 가 기동에 실패한다.
mkdir -p /etc/letsencrypt
SSL_OPTIONS_SRC=$(find /usr/lib/python3 -name options-ssl-nginx.conf 2>/dev/null | head -n1 || true)
if [ -n "$SSL_OPTIONS_SRC" ] && [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
  cp "$SSL_OPTIONS_SRC" /etc/letsencrypt/options-ssl-nginx.conf
fi
DHPARAM_SRC=$(find /usr/lib/python3 -name ssl-dhparams.pem 2>/dev/null | head -n1 || true)
if [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  if [ -n "$DHPARAM_SRC" ]; then
    cp "$DHPARAM_SRC" /etc/letsencrypt/ssl-dhparams.pem
  else
    openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
  fi
fi

# ---------------------------------------------------------------------------
# 8. 인증서 자동 갱신
# ---------------------------------------------------------------------------
# 갱신 자체보다 자주 실패하는 것은 "갱신은 됐는데 nginx 가 옛 인증서를 계속 물고 있는"
# 상태다. 브라우저는 만료된 인증서를 보고, 로그에는 아무 오류도 없다.
log "certbot 갱신 훅"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh <<'SH'
#!/bin/sh
set -eu
systemctl reload nginx
SH
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx.sh

if systemctl list-unit-files | grep -q '^certbot\.timer'; then
  systemctl enable --now certbot.timer
else
  # 하루 두 번은 Let's Encrypt 의 권고다. 만료 30일 전부터만 실제로 갱신하므로
  # 자주 돈다고 요청이 늘지 않는다.
  printf '0 3,15 * * * root certbot renew --quiet\n' >/etc/cron.d/dahaze-certbot-renew
fi

# ---------------------------------------------------------------------------
# 9. dahaze-env-sync
# ---------------------------------------------------------------------------
# SSM Parameter Store -> /opt/dahaze/.env
#
# 인스턴스가 자기 시크릿을 직접 읽는다. Lightsail 은 IAM 인스턴스 프로파일을 못 붙이지만
# SSM 하이브리드 등록으로 역할을 갖게 되므로 가능하다. 배포 파이프라인은 값을 한 번도
# 만지지 않는다 — CI 로그는 지우기 어렵고, 지나간 로그는 되돌릴 수 없다.
log "dahaze-env-sync"
# tls-bootstrap 과 같은 이유로 값을 여기서 박아 넣는다. 따옴표 heredoc 안은 확장되지
# 않으므로, 생성된 스크립트가 환경변수를 기대하게 두면 단독 실행에서 unbound variable
# 로 죽는다 — 배포와 시크릿 반영이 둘 다 이 스크립트를 부른다.
cat >/usr/local/bin/dahaze-env-sync <<SH
#!/usr/bin/env bash
set -euo pipefail

PREFIX="${PREFIX_IN}"
REGION="${REGION_IN}"
APP_DIR="${APP_DIR}"
SH
cat >>/usr/local/bin/dahaze-env-sync <<'SH'
ENV_FILE="$APP_DIR/.env"

TMP=$(mktemp)
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT

# rollout.sh 가 배포마다 .env 의 API_IMAGE 를 갱신한다. 이 값은 SSM 에 없으므로,
# 보존하지 않으면 동기화 한 번이 배포를 되돌린다.
if [ -f "$ENV_FILE" ]; then
  grep -E '^API_IMAGE=' "$ENV_FILE" >>"$TMP" || true
fi

# 탭 구분으로 읽는다. 값 안에 탭이나 줄바꿈이 들어가면 이 파싱이 깨지므로,
# 그런 값은 파라미터에 넣지 않는다 (.env 형식 자체가 여러 줄 값을 못 담는다).
aws ssm get-parameters-by-path \
  --path "$PREFIX" \
  --recursive \
  --with-decryption \
  --region "$REGION" \
  --query 'Parameters[].[Name,Value]' \
  --output text |
  while IFS=$'\t' read -r name value; do
    printf '%s=%s\n' "${name##*/}" "$value"
  done >>"$TMP"

# placeholder 가 남아 있으면 여기서 멈춘다. 그대로 두면 앱은 기동 직후
# assert_production_ready() 에서 죽는데, 그 실패는 컨테이너 로그 안쪽이라 훨씬 읽기 어렵다.
if grep -q '=placeholder$' "$TMP"; then
  echo "실제 값이 아직 들어가지 않은 파라미터가 있다:" >&2
  grep '=placeholder$' "$TMP" | cut -d= -f1 | sed "s|^|  $PREFIX/|" >&2
  exit 1
fi

install -o root -g root -m 0600 "$TMP" "$ENV_FILE"
echo "동기화 완료: $ENV_FILE ($(grep -c . "$ENV_FILE") 개 키)"
SH
chmod 0755 /usr/local/bin/dahaze-env-sync

# ---------------------------------------------------------------------------
# 10. dahaze-tls-bootstrap
# ---------------------------------------------------------------------------
# DNS 가 이 인스턴스를 가리킨 뒤에 운영자가 한 번 실행한다. 부팅에 넣을 수 없는 이유는
# 하나뿐이다 — 도메인 등록기관의 A 레코드는 사람이 등록하고, 그 전에는 Let's Encrypt 의
# HTTP-01 검증이 반드시 실패한다.
log "dahaze-tls-bootstrap"
# 값은 여기서 박아 넣는다. 따옴표 heredoc 안은 확장되지 않으므로, 생성된 스크립트가
# 환경변수를 기대하게 두면 나중에 단독 실행할 때 unbound variable 로 죽는다.
# (실제로 그렇게 한 번 실패했다.)
cat >/usr/local/bin/dahaze-tls-bootstrap <<SH
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${API_DOMAIN}"
EMAIL="${ACME_EMAIL}"
APP_DIR="${APP_DIR}"
SH
cat >>/usr/local/bin/dahaze-tls-bootstrap <<'SH' 
SITE_SRC="$APP_DIR/deploy/nginx/api.conf"

if [ ! -f "$SITE_SRC" ]; then
  echo "$SITE_SRC 가 없다. 배포를 한 번 돌려 저장소 파일을 올린 뒤 다시 실행한다." >&2
  exit 1
fi

# 실패를 미리 설명한다. 여기서 걸리면 certbot 은 "Invalid response" 만 뱉고,
# 그 메시지로는 DNS 문제인지 방화벽 문제인지 구분되지 않는다.
EXPECTED=$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]')
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -n1 || true)
if [ "$RESOLVED" != "$EXPECTED" ]; then
  echo "$DOMAIN 이 $RESOLVED 로 해석된다. 이 인스턴스는 $EXPECTED 다." >&2
  echo "등록기관의 A 레코드를 고치고 전파를 기다린 뒤 다시 실행한다." >&2
  exit 1
fi

# --webroot 로 발급한다. nginx 인스톨러(--nginx)를 쓰면 certbot 이 설정 파일을 직접
# 편집하는데, 그 파일은 저장소가 소유한 api.conf 라 다음 배포에 덮여 사라진다.
certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$EMAIL" \
  --keep-until-expiring

# 복사하지 않고 링크한다. 복사하면 배포로 갱신된 저장소의 설정과 실제 서비스 중인
# 설정이 조용히 갈라지고, 그 차이는 사고가 나기 전까지 아무도 모른다.
ln -sfn "$SITE_SRC" /etc/nginx/sites-enabled/dahaze-api.conf
rm -f /etc/nginx/sites-enabled/dahaze-bootstrap.conf

nginx -t
systemctl reload nginx
echo "https://$DOMAIN 준비 완료"
SH
chmod 0755 /usr/local/bin/dahaze-tls-bootstrap

log "부팅 준비 완료 — 남은 것은 DNS A 레코드, SSM 파라미터 실제 값, 첫 배포다"
