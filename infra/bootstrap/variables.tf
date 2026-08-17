variable "aws_region" {
  description = "부트스트랩 리소스를 만들 리전. prod 스택의 backend region 과 같아야 한다."
  type        = string
  default     = "ap-northeast-2"
}

variable "project" {
  description = "리소스 이름과 태그의 접두사."
  type        = string
  default     = "dahaze"
}

variable "state_bucket_name" {
  description = <<-EOT
    tfstate 를 담을 S3 버킷 이름. S3 버킷 이름은 전 계정 공통 네임스페이스라
    이미 쓰이고 있으면 apply 가 실패한다. 그때만 값을 바꾸고, 바꿨다면
    infra/prod/versions.tf 의 backend 블록도 같은 값으로 고쳐야 한다.
  EOT
  type        = string
  default     = "dahaze-tfstate"
}

variable "state_lock_table_name" {
  description = "동시 apply 를 막는 DynamoDB 락 테이블 이름."
  type        = string
  default     = "dahaze-tfstate-lock"
}
