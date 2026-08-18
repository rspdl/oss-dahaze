data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  # SSM 파라미터 경로의 접두사. 배포 워크플로와 인스턴스의 dahaze-env-sync 가 같은 값을 본다.
  ssm_prefix = "/${var.project}/${var.environment}"

  ssm_parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter"

  # 파라미터 하나하나를 가리키는 ARN.
  ssm_parameter_arn_pattern = "${local.ssm_parameter_arn_prefix}${local.ssm_prefix}/*"

  # `GetParametersByPath` 는 자식이 아니라 **경로 노드 자체**를 리소스로 평가한다.
  # `/*` 만 허용하면 AccessDenied 가 나는데, 메시지가 자식 ARN 을 가리켜서 왜 막혔는지
  # 알아채기 어렵다. 실제로 그렇게 한 번 막혔다.
  ssm_parameter_path_arn = "${local.ssm_parameter_arn_prefix}${local.ssm_prefix}"
}

# --- 인스턴스가 맡는 역할 (SSM 하이브리드 활성화) ---

# Lightsail 인스턴스에는 EC2 처럼 IAM 인스턴스 프로파일을 붙일 수 없다. 대신 SSM
# 하이브리드 활성화로 이 박스를 관리형 노드(mi-*)로 등록하면, 에이전트가 이 역할의
# 임시 자격증명을 받아 온다. 그래서 인스턴스가 자기 시크릿을 스스로 읽을 수 있고,
# 배포 파이프라인은 시크릿 값을 한 번도 손에 쥐지 않는다.
#
# 신뢰 주체가 ec2.amazonaws.com 이 아니라 ssm.amazonaws.com 인 것이 하이브리드 등록의
# 조건이다. 다르면 CreateActivation 이 "Not existing role" 로 거절한다.
resource "aws_iam_role" "instance" {
  name = "${local.name_prefix}-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ssm.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

# 에이전트가 자기 존재를 알리고(UpdateInstanceInformation) 명령을 받아오는 데 필요한
# 최소 권한 묶음. Session Manager 도 여기에 들어 있다.
resource "aws_iam_role_policy_attachment" "instance_ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# 이 인스턴스가 읽을 수 있는 것은 자기 환경의 파라미터뿐이다. 다른 프로젝트나 다른
# 환경(prod 아닌 것)의 경로는 ARN 패턴에서 이미 빠져 있다.
resource "aws_iam_role_policy" "instance_read_params" {
  name = "${local.name_prefix}-read-params"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadOwnParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = [
          local.ssm_parameter_arn_pattern,
          local.ssm_parameter_path_arn,
        ]
      },
      {
        # SecureString 은 aws/ssm 기본 키로 암호화된다. 그 키는 계정 공용이라 ARN 으로
        # 좁힐 수 없어서, "SSM 을 거친 복호화만" 이라는 조건으로 대신 묶는다.
        Sid      = "DecryptSecureStringViaSSM"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

# 등록 코드는 Terraform 출력에 넣지 않는다. user_data 로만 흘러가고, 거기서
# sensitive() 로 감싸 plan 로그에 찍히지 않게 한다 (lightsail.tf 참고).
# state 에는 남는다 — CreateActivation 이 코드를 한 번만 돌려주므로 이건 피할 수 없다.
# 그래서 state 버킷 암호화와 아래 두 장치(1회 등록 제한, 짧은 만료)가 실제 방어선이다.
#
# registration_limit 이 1 인 이유: 이 활성화로 등록할 박스는 하나뿐이다. 코드가 어딘가로
# 새더라도 이미 소진된 뒤라면 남의 서버가 우리 역할을 맡을 수 없다.
resource "aws_ssm_activation" "instance" {
  name               = local.name_prefix
  description        = "dahaze 백엔드 Lightsail 인스턴스 (ADR-0004)"
  iam_role           = aws_iam_role.instance.name
  registration_limit = 1
  expiration_date    = var.ssm_activation_expiration_date

  # 활성화에 붙인 태그는 등록되는 관리형 노드에 그대로 상속된다. mi-* ID 는 부팅 시점에
  # 정해져 Terraform 이 미리 알 수 없으므로, 배포 역할의 SendCommand 를 좁히는 근거가
  # 이 태그다. default_tags 로도 같은 값이 들어가지만 여기서는 명시한다 —
  # IAM 조건이 이 두 키에 걸려 있어서, 기본 태그 설정을 누가 바꾸면 조용히 뚫린다.
  tags = {
    Name        = local.name_prefix
    Project     = var.project
    Environment = var.environment
  }

  # 역할에 SSM 권한이 붙기 전에 활성화가 만들어지면 에이전트가 등록 직후 아무것도 못 한다.
  depends_on = [aws_iam_role_policy_attachment.instance_ssm_core]
}

# --- GitHub Actions OIDC ---

# 한 계정에 이 URL 의 프로바이더는 하나만 존재할 수 있다. 이미 있으면 참조만 한다.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # thumbprint 를 지정하지 않는다. AWS 가 이 엔드포인트의 인증서 체인을 직접 검증하도록
  # 바뀐 뒤로, 손으로 박아 둔 지문은 GitHub 이 CA 를 교체하는 날 배포를 멈추게 할 뿐이다.
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = one(concat(
    aws_iam_openid_connect_provider.github[*].arn,
    data.aws_iam_openid_connect_provider.github[*].arn,
  ))

  # sub 를 두 형태로 받는다. 브랜치 조건만 두면 Environment 승인 게이트를 거친 잡이
  # 거절되고, Environment 조건만 두면 브랜치 보호가 의미를 잃는다.
  github_subjects = [
    "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_deploy_branch}",
    "repo:${var.github_org}/${var.github_repo}:environment:${var.github_deploy_environment}",
  ]
}

# aud 조건이 빠지면 다른 GitHub 저장소의 토큰도 이 역할을 맡을 수 있다.
# sub 조건은 저장소 이름까지 포함해야 한다 — 조직만 걸면 조직 내 어떤 저장소든 배포한다.
resource "aws_iam_role" "github_actions" {
  name = "${local.name_prefix}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = local.github_oidc_provider_arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = local.github_subjects
          }
        }
      }
    ]
  })
}

# 배포 역할은 **시크릿을 읽지 않는다.** 인스턴스가 스스로 읽으므로, 파이프라인에 필요한
# 것은 "그 박스에서 롤아웃 스크립트를 돌려라" 라고 시키고 결과를 기다리는 권한뿐이다.
# 로그를 남기는 CI 에서 시크릿이 새는 가장 흔한 경로를 아예 없앤다.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${local.name_prefix}-github-actions-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # 대상 노드를 태그로 묶는다. 같은 계정에 다른 관리형 노드가 생겨도 이 역할은
        # 거기에 명령을 보낼 수 없다.
        Sid      = "SendCommandToThisInstanceOnly"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:managed-instance/*"
        Condition = {
          StringEquals = {
            "ssm:resourceTag/Project"     = var.project
            "ssm:resourceTag/Environment" = var.environment
          }
        }
      },
      {
        # SendCommand 는 대상 노드와 문서 두 리소스를 함께 요구한다. 문서를
        # AWS-RunShellScript 하나로 못 박아, 이 역할로 임의의 SSM 문서를 돌릴 수 없게 한다.
        Sid      = "RunShellScriptDocumentOnly"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
      },
      {
        # 이 액션들은 리소스 수준 권한을 지원하지 않아 "*" 밖에 쓸 수 없다.
        # 전부 읽기 전용이고, 읽히는 것은 명령 실행 결과와 에이전트 상태뿐이다.
        Sid    = "PollCommandResult"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
          "ssm:ListCommands",
          "ssm:DescribeInstanceInformation",
        ]
        Resource = "*"
      },
    ]
  })
}
