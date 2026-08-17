output "state_bucket_name" {
  description = "infra/prod/versions.tf 의 backend.bucket 에 들어가야 하는 값."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_lock_table_name" {
  description = "infra/prod/versions.tf 의 backend.dynamodb_table 에 들어가야 하는 값."
  value       = aws_dynamodb_table.tfstate_lock.name
}
