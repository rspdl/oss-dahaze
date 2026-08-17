# 비상용 키. 등록만 해 두고 방화벽은 닫아 둔다 (variables.tf 의 ssh_public_key 참고).
# public_key 를 주지 않으면 Lightsail 이 키쌍을 만들어 주고 **개인키가 state 에 들어간다.**
# 그래서 이 인자는 선택이 아니다.
resource "aws_lightsail_key_pair" "break_glass" {
  name       = "${local.name_prefix}-break-glass"
  public_key = var.ssh_public_key
}

resource "aws_lightsail_instance" "api" {
  name              = local.name_prefix
  availability_zone = var.availability_zone
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id
  key_pair_name     = aws_lightsail_key_pair.break_glass.name

  # IPv6 를 켜면 방화벽 규칙을 cidrs 와 ipv6_cidrs 로 이중 관리해야 한다. 한쪽만 좁히고
  # 다른 쪽을 잊는 실수가 이 형태에서 가장 흔하다. 지금 IPv6 로 들어올 이유가 없다.
  ip_address_type = "ipv4"

  # sensitive() 로 감싸는 것이 핵심이다. AWS 프로바이더는 activation_code 를 민감한 값으로
  # 표시하지 않아서, 그냥 두면 최초 apply 의 plan 출력에 등록 코드가 그대로 찍힌다.
  # CI 가 plan 을 로그로 남기면 그 로그는 되돌릴 수 없다. 여기서 표시해 두면 민감도가
  # templatefile 결과 전체로 전파되어 user_data 가 "(sensitive value)" 로만 보인다.
  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    region          = var.aws_region
    activation_code = sensitive(aws_ssm_activation.instance.activation_code)
    activation_id   = sensitive(aws_ssm_activation.instance.id)
    app_dir         = "/opt/${var.project}"
    ssm_prefix      = local.ssm_prefix
    api_domain      = var.api_domain
    acme_email      = var.acme_email
  })

  # Postgres 가 이 인스턴스의 로컬 디스크에 산다(ADR-0004). 관리형 DB 가 아니므로
  # 스냅샷이 유일한 백업이다.
  add_on {
    type          = "AutoSnapshot"
    snapshot_time = var.auto_snapshot_time
    status        = "Enabled"
  }

  lifecycle {
    # user_data 는 최초 부팅에서 한 번만 실행된다. 그래서 이 파일을 고쳐도 살아 있는
    # 인스턴스에는 아무 효과가 없는데, Terraform 은 이걸 "교체 사유" 로 읽는다.
    # 교체는 곧 Postgres 데이터 삭제다. 활성화 코드가 만료돼 재생성될 때도 같은 일이
    # 벌어지므로, 이 무시 규칙은 편의가 아니라 데이터 보호 장치다.
    #
    # 부팅 스크립트를 실제로 바꿔야 할 때는 DEPLOY.md 의 "인스턴스를 다시 만들 때" 를 따른다.
    ignore_changes = [user_data]
  }
}

# 인스턴스와 분리해서 만든다. 인스턴스를 교체해도 DNS A 레코드와 GitHub OAuth 콜백
# 주소를 다시 손대지 않아도 되고, 그 둘은 손댈 때마다 사람이 개입해야 하는 것들이다.
resource "aws_lightsail_static_ip" "api" {
  name = "${local.name_prefix}-ip"
}

resource "aws_lightsail_static_ip_attachment" "api" {
  static_ip_name = aws_lightsail_static_ip.api.name
  instance_name  = aws_lightsail_instance.api.name
}

# 이 리소스는 방화벽의 전체 상태를 소유한다. 여기 없는 포트는 닫힌다 — Lightsail 이
# 인스턴스를 만들 때 기본으로 열어 두는 22번도 포함해서.
#
# 22번이 기본으로 닫혀 있는 이유: 배포는 SSM Run Command 로 하고 접속은 Session Manager
# 로 한다. SSH 로 들어올 사람이 없는데 열려 있으면 봇의 무차별 로그인 로그만 쌓인다.
resource "aws_lightsail_instance_public_ports" "api" {
  instance_name = aws_lightsail_instance.api.name

  # ACME HTTP-01 검증과 HTTPS 리다이렉트가 여기로 온다. 인증서 갱신이 이 포트에
  # 의존하므로 발급이 끝난 뒤에도 닫을 수 없다.
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }

  dynamic "port_info" {
    for_each = var.enable_break_glass_ssh ? [1] : []

    content {
      protocol  = "tcp"
      from_port = 22
      to_port   = 22
      cidrs     = var.break_glass_ssh_cidrs
    }
  }
}
