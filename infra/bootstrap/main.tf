# Terraform state 백엔드. 계정당 한 번만 apply 하고, 그 뒤로는 거의 건드리지 않는다.
#
#   cd infra/bootstrap && terraform init && terraform apply
#
# 여기서 만든 버킷/테이블 이름을 infra/prod/versions.tf 의 backend 블록이 그대로 참조한다.
# backend 블록에는 변수를 쓸 수 없으므로 이름을 바꾸면 양쪽을 함께 고쳐야 한다.

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name

  # state 를 잃는 것은 인프라의 소유권을 잃는 것과 같다. 리소스는 그대로 살아 있는데
  # Terraform 이 그 존재를 모르게 되고, 그때부터 apply 는 이미 있는 이름을 다시
  # 만들려다 실패한다. 실수 한 번으로 그 상태에 빠지지 않게 막는다.
  lifecycle {
    prevent_destroy = true
  }
}

# state 에는 시크릿이 들어가지 않도록 설계했지만(placeholder + ignore_changes),
# 그건 사람의 규율에 기대는 방어다. 버킷 암호화는 그 규율이 깨져도 남는 방어다.
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 잘못된 apply 로 state 가 깨졌을 때 되돌릴 수 있는 유일한 수단이다.
# 락은 동시 쓰기만 막아 줄 뿐, 한 사람이 혼자 망가뜨리는 것은 막지 못한다.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 버전이 무한히 쌓이면 요금이 늘기만 한다. 90일이면 "어제 apply 가 이상했다" 를
# 되짚기에 충분하고, 그보다 오래된 state 는 실제로 되돌릴 일이 없다.
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Terraform 1.10 부터는 S3 오브젝트 락(use_lockfile)이 정식 경로이고 이 테이블은
# 선택 사항이 되었다. 그래도 만들어 두는 이유는 prod backend 가 두 잠금을 함께 켜기
# 때문이다 — 로컬 운영자와 CI 가 서로 다른 Terraform 버전으로 apply 하는 상황에서
# 한쪽만 잠금을 이해하면 잠금이 없는 것과 같다.
resource "aws_dynamodb_table" "tfstate_lock" {
  name         = var.state_lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}
