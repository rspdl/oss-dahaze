terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # 이 스택에는 backend 블록이 없다. 원격 state 를 만드는 스택이 그 원격 state 에
  # 자기를 저장할 수는 없기 때문이다 (닭과 달걀). 여기 state 는 로컬 파일로 남고,
  # 저장소 루트 .gitignore 가 *.tfstate 를 이미 막고 있다.
  #
  # 로컬 state 를 잃어버려도 복구는 가능하다 — 아래 두 리소스를 import 하면 된다.
  # 애초에 이 스택은 계정당 한 번만 apply 한다.
}

provider "aws" {
  region = var.aws_region

  # 태그가 없는 리소스는 몇 달 뒤에 "이게 뭐였지" 가 되고, 그러면 아무도 지우지 못한다.
  # 부트스트랩 리소스는 특히 오래 살아남으므로 출처를 박아 둔다.
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
