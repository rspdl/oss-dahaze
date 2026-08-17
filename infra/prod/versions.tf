terraform {
  # 변수 validation 이 다른 변수를 참조한다 (variables.tf 의 break-glass 규칙).
  # 그게 가능해진 것이 1.9 다.
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # backend 블록에는 변수를 쓸 수 없다. infra/bootstrap 에서 만든 이름을 손으로 맞춘다.
  #
  # use_lockfile(S3 오브젝트 락)와 dynamodb_table 을 함께 켠다. 운영자의 로컬 Terraform 과
  # CI 의 Terraform 버전이 다를 수 있고, 한쪽만 이해하는 잠금은 잠금이 아니기 때문이다.
  # init 시 dynamodb_table deprecation 경고가 뜨는 건 정상이다 — 양쪽 모두 1.10 이상으로
  # 올라간 뒤에 이 줄을 지운다.
  backend "s3" {
    bucket         = "dahaze-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-2"
    use_lockfile   = true
    dynamodb_table = "dahaze-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  # 이 계정에는 다른 프로젝트도 산다. 태그가 없으면 몇 달 뒤 "이거 지워도 되나" 를
  # 아무도 판단하지 못하고, 그 상태의 리소스는 영원히 요금만 낸다.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
