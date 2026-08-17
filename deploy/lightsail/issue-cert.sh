#!/usr/bin/env bash
#
# 인증서 최초 발급. **DNS 가 이 인스턴스를 가리킨 뒤 한 번만** 실행한다.
#
#   sudo /opt/dahaze/issue-cert.sh api.dahaze.xyz you@example.com
#
# 부팅 시점에 자동화하지 않는 이유: ACME challenge 는 도메인이 이 인스턴스로 해석돼야
# 통과한다. Terraform 이 인스턴스를 만든 직후에는 DNS 레코드가 아직 없거나 전파되지
# 않았을 수 있고, 그 상태로 시도하면 Let's Encrypt 의 실패 한도만 소모한다.
#
# 발급이 끝나면 부트스트랩용 HTTP 설정을 TLS 설정(`api.conf`)으로 갈아 끼운다.

set -euo pipefail

DOMAIN="${1:?도메인이 필요하다 (예: api.dahaze.xyz)}"
EMAIL="${2:?만료 알림을 받을 이메일이 필요하다}"
REPO_RAW="${DAHAZE_REPO_RAW:-https://raw.githubusercontent.com/rspdl/dahaze/main}"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "root 로 실행해야 한다." >&2
  exit 1
fi

log "DNS 확인"
# 여기서 먼저 막으면 Let's Encrypt 의 실패 한도를 아끼고, 원인도 훨씬 분명해진다.
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
PUBLIC_IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]' || true)

if [ -z "$RESOLVED" ]; then
  echo "✗ $DOMAIN 이 해석되지 않는다. DNS A 레코드를 먼저 등록할 것." >&2
  exit 1
fi
echo "$DOMAIN → $RESOLVED (이 인스턴스: ${PUBLIC_IP:-확인 실패})"
if [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "✗ DNS 가 이 인스턴스를 가리키지 않는다. 전파를 더 기다리거나 레코드를 확인할 것." >&2
  exit 1
fi

log "인증서 발급"
# nginx 플러그인 대신 webroot 를 쓴다. --nginx 는 우리 설정 파일을 자기 방식으로
# 고쳐 쓰는데, 그러면 저장소의 api.conf 와 인스턴스의 실제 설정이 갈라진다.
certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos --no-eff-email \
  --non-interactive \
  --keep-until-expiring

log "TLS 설정으로 교체"
curl -fsSL "${REPO_RAW}/deploy/nginx/api.conf" -o /etc/nginx/conf.d/dahaze.conf

# certbot 이 처음 실행될 때만 만드는 파일들이다. 없으면 nginx 가 include 에서 죽는다.
[ -f /etc/letsencrypt/options-ssl-nginx.conf ] || \
  curl -fsSL "https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf" \
    -o /etc/letsencrypt/options-ssl-nginx.conf
[ -f /etc/letsencrypt/ssl-dhparams.pem ] || \
  curl -fsSL "https://raw.githubusercontent.com/certbot/certbot/main/certbot/certbot/ssl-dhparams.pem" \
    -o /etc/letsencrypt/ssl-dhparams.pem

nginx -t
systemctl reload nginx

log "갱신 리허설"
# 실제로 갱신될 때가 아니라 지금 확인한다. 3개월 뒤 조용히 실패하는 것이 가장 흔한 사고다.
certbot renew --dry-run

printf '\n\033[32m발급 완료: %s\033[0m\n' "$DOMAIN"
curl -sfI "https://${DOMAIN}/health" | head -1 || \
  echo "⚠ HTTPS 응답을 받지 못했다. API 컨테이너가 아직 안 떴을 수 있다."
