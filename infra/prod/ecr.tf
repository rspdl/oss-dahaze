# API 이미지 레지스트리.
#
# GHCR 대신 ECR 을 쓰는 이유는 하나다. **인스턴스가 이미 IAM 역할을 갖고 있다.**
# SSM 하이브리드 활성화로 등록된 노드라 `aws ecr get-login-password` 만으로 pull 할 수
# 있고, 레지스트리 자격증명을 어디에도 저장하지 않는다.
#
# GHCR 은 비공개 패키지를 pull 하려면 PAT 를 Parameter Store 에 넣거나 패키지를 공개해야
# 한다. 둘 다 이 설계가 없애려던 것이다 — 시크릿을 인스턴스에 밀어 넣지 않는다는 원칙
# (ADR-0004) 과, 비공개로 두고 싶다는 요구가 정면으로 부딪힌다.

resource "aws_ecr_repository" "api" {
  name = "${local.name_prefix}/api"

  # 같은 태그를 덮어쓰지 못하게 한다. 태그가 커밋 SHA 이므로 덮어쓸 이유가 없고,
  # 덮어쓸 수 있으면 "배포된 이미지"가 무엇인지 나중에 확정할 수 없다.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# 이미지가 무한히 쌓이면 스토리지 비용이 조용히 는다. 롤백 대상은 남기되 오래된 것은
# 정리한다 — 며칠 지난 이미지로 되돌릴 일은 사실상 없다.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "최근 10개만 남긴다. 롤백은 직전 이미지로 하므로 이보다 깊이 갈 일이 없다."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}
