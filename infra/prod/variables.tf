variable "aws_region" {
  description = "모든 리소스를 만들 리전. 사용자가 한국에 있고 Lightsail 요금이 리전별로 같으므로 서울을 쓴다."
  type        = string
  default     = "ap-northeast-2"
}

variable "availability_zone" {
  description = "Lightsail 인스턴스의 AZ. 인스턴스가 하나뿐이라 분산할 대상이 없다."
  type        = string
  default     = "ap-northeast-2a"
}

variable "project" {
  description = "리소스 이름·태그·SSM 파라미터 경로의 접두사."
  type        = string
  default     = "dahaze"
}

variable "environment" {
  description = "환경 이름. SSM 파라미터 경로의 두 번째 마디가 된다."
  type        = string
  default     = "prod"
}

variable "api_domain" {
  description = "백엔드가 응답할 도메인. nginx server_name·인증서·OAuth 콜백이 모두 이 값을 따른다."
  type        = string
  default     = "api.dahaze.xyz"
}

variable "acme_email" {
  description = <<-EOT
    Let's Encrypt 계정 이메일. 인증서 만료 임박 알림이 여기로 온다.
    기본값을 두지 않는 이유는, 잘못된 주소로 발급되면 만료 경고를 아무도 못 받기 때문이다.
  EOT
  type        = string
}

# --- 아키텍처 고정 (ADR-0002 / ADR-0004) ---

variable "lightsail_bundle_id" {
  description = <<-EOT
    Lightsail 번들 ID. 반드시 x86_64 계열이어야 한다.

    RSPDL 은 linux aarch64 wheel 도 sdist 도 배포하지 않는다. ARM 번들을 고르면
    `pip install rspdl` 이 소스 빌드로 fallback 하지도 못하고 실패하고, API 이미지는
    빌드조차 되지 않는다. 이건 성능 취향이 아니라 하드 제약이다 (ADR-0002).

    RAM 기본값이 4GB(medium_3_0)인 이유:
    API 는 Z3 가 정적 링크된 27.5MB 네이티브 확장을 들고 bounded model finding 을 돌리며,
    같은 박스에서 Postgres 가 shared_buffers 를 잡고 있다. 2GB(small_3_0)에서는 솔버 힙이
    커지는 순간 OOM killer 가 도는데, OOM killer 는 보통 가장 큰 상주 프로세스 —
    즉 Postgres — 를 고른다. 컴파일 요청 하나가 DB 를 죽이는 구조를 만들지 않는다.
  EOT
  type        = string
  default     = "medium_3_0"

  # 실제 방어선은 아래 allowlist 다. 이 규칙은 ARM 을 고른 사람에게 "왜 안 되는지"를
  # 먼저 보여주기 위해 따로 둔다.
  validation {
    condition     = !can(regex("(^|_)arm(_|$)", var.lightsail_bundle_id))
    error_message = "ARM 번들(예: nano_arm_3_0)은 쓸 수 없다. RSPDL 이 linux aarch64 wheel 을 배포하지 않아 API 이미지를 빌드할 수 없다 — docs/adr/0002-rspdl-compiler-integration.md 참고."
  }

  validation {
    condition     = can(regex("^(nano|micro|small|medium|large|xlarge|2xlarge)_[0-9]+_[0-9]+$", var.lightsail_bundle_id))
    error_message = "x86_64 Linux 번들 ID 형태가 아니다. `aws lightsail get-bundles --query 'bundles[?supportedPlatforms[0]==`LINUX_UNIX`].[bundleId,ramSizeInGb,cpuCount]' --output table` 로 확인한다."
  }

  validation {
    condition     = !can(regex("^(nano|micro|small)_", var.lightsail_bundle_id))
    error_message = "RAM 2GB 이하 번들로는 API(Z3 솔버)와 Postgres 를 같은 박스에 올릴 수 없다. medium_3_0 이상을 쓴다."
  }
}

variable "lightsail_blueprint_id" {
  description = <<-EOT
    OS 블루프린트. Ubuntu LTS 를 쓴다.

    Docker 공식 apt 저장소가 Ubuntu 를 1급으로 지원해서 docker-ce 와
    docker-compose-plugin 을 한 번의 apt install 로 받을 수 있고, certbot 과
    python3-certbot-nginx 도 배포판 패키지로 있다. Amazon Linux 2023 은 compose v2
    플러그인을 저장소로 주지 않아 GitHub 릴리스에서 바이너리를 직접 받아 놓아야 하고,
    그건 부팅 스크립트가 스스로 버전을 관리한다는 뜻이다.
  EOT
  type        = string
  default     = "ubuntu_24_04"

  validation {
    condition     = contains(["ubuntu_24_04", "ubuntu_22_04", "debian_12"], var.lightsail_blueprint_id)
    error_message = "Docker 공식 저장소와 certbot 패키지를 그대로 쓸 수 있는 블루프린트만 허용한다: ubuntu_24_04, ubuntu_22_04, debian_12."
  }
}

# --- 백업 ---

variable "auto_snapshot_time" {
  description = <<-EOT
    Lightsail 자동 스냅샷 시각. UTC 정시만 받는다.
    Postgres 가 관리형 DB 가 아니라 이 인스턴스의 컨테이너이므로(ADR-0004),
    디스크 스냅샷이 유일한 백업이다. 기본값 18:00 UTC = 03:00 KST — 트래픽이 가장 적다.
  EOT
  type        = string
  default     = "18:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):00$", var.auto_snapshot_time))
    error_message = "HH:00 형식의 UTC 정시여야 한다."
  }
}

# --- 접근 경로 ---

variable "ssh_public_key" {
  description = <<-EOT
    비상용(break-glass) SSH 공개키. 평소 접근은 전부 SSM Session Manager 로 하고
    22번 포트는 닫혀 있다 (enable_break_glass_ssh 참고).

    그래도 키를 등록해 두는 이유는, Lightsail 의 key_pair_name 이 인스턴스 생성 시에만
    지정되기 때문이다. SSM 에이전트 등록이 깨져 들어갈 길이 없어진 날 키를 추가하려면
    인스턴스를 다시 만들어야 하고, 그건 Postgres 데이터를 버린다는 뜻이다.

    개인키는 절대 Terraform 이 만들거나 보관하지 않는다. 운영자 로컬에서 만든 키의
    공개키만 넣는다: ssh-keygen -t ed25519 -f ~/.ssh/dahaze-break-glass
  EOT
  type        = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) ", var.ssh_public_key))
    error_message = "OpenSSH 공개키 형식이어야 한다. 개인키(-----BEGIN ...)를 붙여 넣지 않았는지 확인한다."
  }
}

variable "enable_break_glass_ssh" {
  description = "22번 포트를 연다. 평소에는 false 다 — 배포도 운영도 SSH 를 쓰지 않으므로, 열려 있으면 순수하게 공격면만 늘어난다."
  type        = bool
  default     = false
}

variable "break_glass_ssh_cidrs" {
  description = "enable_break_glass_ssh 가 true 일 때 22번 포트를 열어 줄 대역. 운영자의 현재 IP/32 를 넣는다."
  type        = list(string)
  default     = []

  validation {
    condition     = !var.enable_break_glass_ssh || length(var.break_glass_ssh_cidrs) > 0
    error_message = "break-glass SSH 를 켜려면 접근할 대역을 명시해야 한다."
  }

  validation {
    condition     = !contains(var.break_glass_ssh_cidrs, "0.0.0.0/0")
    error_message = "비상 통로를 전 세계에 여는 것은 비상 통로가 아니다. 운영자 IP/32 를 쓴다."
  }
}

# --- GitHub Actions OIDC ---

variable "github_org" {
  description = "배포 워크플로가 사는 GitHub 조직/사용자."
  type        = string
  default     = "rspdl"
}

variable "github_repo" {
  description = "배포 워크플로가 사는 저장소. OIDC 신뢰 조건이 이 저장소로 한정된다."
  type        = string
  default     = "dahaze"
}

variable "github_deploy_branch" {
  description = "배포를 트리거할 수 있는 브랜치. 다른 브랜치의 워크플로는 역할을 맡지 못한다."
  type        = string
  default     = "main"
}

variable "github_deploy_environment" {
  description = "배포 워크플로가 쓰는 GitHub Environment 이름. 승인 게이트를 여기에 건다."
  type        = string
  default     = "production"
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    GitHub OIDC 프로바이더를 이 스택이 만들지 여부.
    한 AWS 계정에 token.actions.githubusercontent.com 프로바이더는 하나만 존재할 수 있다.
    같은 계정의 다른 프로젝트가 이미 만들어 두었다면 false 로 두고 기존 것을 참조한다.

    이 계정(874632206448)에는 2026-08-18 확인 시점에 이미 존재한다. 그래서 기본값이
    false 다 — true 로 두고 apply 하면 EntityAlreadyExists 로 실패한다.
  EOT
  type        = bool
  default     = false
}

# --- SSM 하이브리드 활성화 ---

variable "ssm_activation_expiration_date" {
  description = <<-EOT
    활성화 코드의 만료 시각 (RFC3339, 최대 30일 뒤). null 이면 AWS 기본값인 24시간이다.

    짧게 두는 편이 낫다. 등록 코드는 Terraform state 와 인스턴스의 user_data(부팅 후에도
    /var/lib/cloud 아래에 남는다) 두 곳에 실린다. 등록은 부팅 때 한 번 일어나고
    registration_limit 도 1이므로, 만료가 짧으면 그 사본들이 빠르게 무의미해진다.
  EOT
  type        = string
  default     = null
}

# --- DNS ------------------------------------------------------------------
#
# 도메인 등록기관은 가비아다. Terraform 은 네임서버를 위임받은 뒤의 레코드만 소유한다.

variable "manage_dns" {
  description = <<-EOT
    Route53 호스팅 영역과 레코드를 이 스택이 소유할지. 도메인 위임을 아직 안 옮겼다면
    false 로 두고 등록기관에서 직접 레코드를 관리한다. true 로 바꾼 뒤에는 반드시
    호스팅 영역이 만들어진 것을 확인하고 나서 가비아의 네임서버를 바꾼다 — 순서를
    뒤집으면 비어 있는 영역으로 위임되어 도메인 전체가 잠시 죽는다.
  EOT
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "루트 도메인. 호스팅 영역의 이름이 된다."
  type        = string
  default     = "dahaze.xyz"
}

variable "vercel_cname" {
  description = <<-EOT
    app 서브도메인이 가리킬 Vercel 값. Vercel 프로젝트의 도메인 설정이 알려준다.
    이전 시점에 가비아에 이미 있던 레코드이므로, 위임 전에 여기 옮겨 두지 않으면
    전파되는 순간 프론트엔드가 끊긴다. 비워 두면 레코드를 만들지 않는다.
  EOT
  type        = string
  default     = ""
}
