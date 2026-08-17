#!/usr/bin/env bash
#
# 인스턴스 최초 부팅 준비. Terraform 의 user_data 가 실행한다.
#
# 여기서 하는 것은 **배포와 무관하게 한 번만 해도 되는 것**뿐이다. 이미지 pull·마이그레이션
# 같이 배포마다 달라지는 것은 rollout.sh 가 한다.
#
# 인증서 발급은 여기서 하지 않는다. DNS 가 이 인스턴스를 가리켜야 하는데 그 시점을 부팅이
# 알 수 없기 때문이다. 대신 인증서 없이도 nginx 가 뜨도록 만들어 두고, 운영자가 DNS 를
# 붙인 뒤 `issue-cert.sh` 를 한 번 실행한다.

set -euo pipefail

APP_DIR=/opt/dahaze
REPO_RAW="${DAHAZE_REPO_RAW:-https://raw.githubusercontent.com/rspdl/dahaze/main}"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "root 로 실행해야 한다." >&2
  exit 1
fi

log "아키텍처 확인"
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "✗ $ARCH 인스턴스다. RSPDL 이 linux aarch64 를 지원하지 않아 API 를 띄울 수 없다." >&2
  echo "  x86 번들로 다시 만들어야 한다 (docs/adr/0002)." >&2
  exit 1
fi
echo "✓ $ARCH"

# 배포판을 가리지 않게 한다. Terraform 이 고른 blueprint 가 Ubuntu 든 AL2023 이든
# 이 스크립트가 그대로 돌아야 조율 실수가 생기지 않는다.
if command -v apt-get >/dev/null; then
  PKG=apt
elif command -v dnf >/dev/null; then
  PKG=dnf
else
  echo "지원하지 않는 배포판이다 (apt·dnf 없음)." >&2
  exit 1
fi

log "패키지 설치 ($PKG)"
case "$PKG" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx unzip

    # Docker 공식 저장소. 배포판 기본 패키지는 compose plugin 이 없거나 낡았다.
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.asc ]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
    fi
    . /etc/os-release
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    ;;
  dnf)
    dnf install -y nginx certbot python3-certbot-nginx docker unzip
    # AL2023 의 docker 패키지에는 compose plugin 이 없다. 따로 넣는다.
    install -m 0755 -d /usr/libexec/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
      -o /usr/libexec/docker/cli-plugins/docker-compose
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose
    ;;
esac

systemctl enable --now docker

log "AWS CLI 확인"
# rollout.sh 가 Parameter Store 를 직접 읽으므로 CLI 가 반드시 있어야 한다.
if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/awscli.zip /tmp/aws
fi
aws --version

log "애플리케이션 디렉터리"
install -d -m 0755 "$APP_DIR"
install -d -m 0755 /var/www/certbot

log "배포 스크립트 내려받기"
for f in rollout.sh issue-cert.sh; do
  curl -fsSL "${REPO_RAW}/deploy/lightsail/${f}" -o "${APP_DIR}/${f}"
  chmod +x "${APP_DIR}/${f}"
done
curl -fsSL "${REPO_RAW}/deploy/docker-compose.prod.yml" -o "${APP_DIR}/docker-compose.prod.yml"

log "nginx (인증서 없이 뜨는 설정)"
# 기본 사이트를 치운다. 남겨 두면 default_server 가 둘이 되어 nginx 가 뜨지 않는다.
rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf 2>/dev/null || true
install -d -m 0755 /etc/nginx/conf.d
curl -fsSL "${REPO_RAW}/deploy/nginx/api-bootstrap.conf" -o /etc/nginx/conf.d/dahaze.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "인증서 자동 갱신"
# 갱신 자체는 certbot 패키지의 타이머가 돌린다. 그러나 갱신만 하고 nginx 를 reload 하지
# 않으면 **디스크의 인증서는 새것인데 서비스는 옛것을 계속 내보낸다.** 조용히 만료되는
# 사고가 여기서 난다. deploy hook 을 걸어 갱신 직후 reload 한다.
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
# certbot 이 인증서를 실제로 갱신했을 때만 실행된다.
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# 배포판에 따라 타이머 이름이 다르다. 있는 것을 켠다.
systemctl enable --now certbot.timer 2>/dev/null \
  || systemctl enable --now certbot-renew.timer 2>/dev/null \
  || echo "⚠ certbot 타이머를 찾지 못했다. 갱신 스케줄을 직접 확인할 것." >&2

printf '\n\033[32m부트스트랩 완료\033[0m\n'
echo "다음 단계: DNS 가 이 인스턴스를 가리키게 한 뒤 ${APP_DIR}/issue-cert.sh 를 한 번 실행한다."
