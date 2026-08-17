# 런타임 설정의 원본. 인스턴스의 dahaze-env-sync 가 이 경로를 통째로 읽어
# /opt/dahaze/.env 를 다시 쓴다.
#
# **Terraform 은 값을 소유하지 않는다.** 여기서 만드는 것은 이름과 타입뿐이고 값은
# 전부 "placeholder" 로 시작한다. 실제 값은 운영자가 CLI 로 넣는다 (DEPLOY.md).
# 값을 Terraform 이 들고 있으면 state 파일과 plan 출력에 시크릿이 남고, state 는
# 저장소보다 지우기 어려운 곳에 오래 남는다.
#
# 시크릿이 아닌 값(CORS_ALLOW_ORIGINS 등)까지 placeholder 로 두는 이유는 소유권을
# 한 곳에 모으기 위해서다. 일부는 Terraform 이, 일부는 운영자가 정하면 ".env 의 이 줄은
# 누가 정했나" 를 매번 되짚어야 한다.

locals {
  # SecureString. 새면 곧바로 피해가 되는 값들.
  ssm_secret_parameters = toset([
    "DATABASE_URL",
    "SESSION_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OPENAI_API_KEY",
    # compose 가 db 컨테이너를 띄울 때 요구한다. DATABASE_URL 안의 비밀번호와 같아야 한다.
    "POSTGRES_PASSWORD",
  ])

  # String. 새도 피해는 없지만 환경마다 달라서 이미지에 넣을 수 없는 값들.
  ssm_config_parameters = toset([
    "CORS_ALLOW_ORIGINS",
    "COOKIE_DOMAIN",
    "COOKIE_SECURE",
    "COOKIE_SAMESITE",
    "OAUTH_REDIRECT_URI",
    "WEB_POST_LOGIN_URL",
    "OPENAI_MODEL",
    "POSTGRES_DB",
    "POSTGRES_USER",
  ])

  # ENVIRONMENT 와 PORT 는 여기 없다. deploy/docker-compose.prod.yml 이 이미 고정하고
  # 있어서, 파라미터로도 두면 두 곳이 다른 값을 말할 때 어느 쪽이 이겼는지 추적해야 한다.
}

resource "aws_ssm_parameter" "secret" {
  for_each = local.ssm_secret_parameters

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "SecureString"
  value = "placeholder"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.ssm_config_parameters

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "String"
  value = "placeholder"

  lifecycle {
    ignore_changes = [value]
  }
}
