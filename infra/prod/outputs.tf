# 활성화 코드와 ID 는 일부러 출력하지 않는다. 출력은 state 와 CI 로그 양쪽에 남고,
# 이 둘은 등록만 되면 다시 필요 없는 값이다.

output "static_ip" {
  description = "등록기관에 넣을 A 레코드 값. 인스턴스를 교체해도 바뀌지 않는다."
  value       = aws_lightsail_static_ip.api.ip_address
}

output "instance_name" {
  description = "Lightsail 인스턴스 이름."
  value       = aws_lightsail_instance.api.name
}

output "github_actions_role_arn" {
  description = "배포 워크플로가 OIDC 로 맡을 역할. 저장소 변수 AWS_DEPLOY_ROLE_ARN 에 넣는다."
  value       = aws_iam_role.github_actions.arn
}

output "ssm_parameter_prefix" {
  description = "런타임 설정이 사는 경로. 인스턴스의 dahaze-env-sync 가 이 아래를 통째로 읽는다."
  value       = local.ssm_prefix
}

output "ssm_target_filter" {
  description = <<-EOT
    배포 대상 노드를 찾는 필터. 하이브리드 등록 노드의 mi-* ID 는 부팅 시점에 정해지므로
    워크플로가 ID 를 미리 알 수 없다. 대신 이 필터로 찾는다.

      aws ssm describe-instance-information --filters <이 값>
  EOT
  value       = "Key=tag:Project,Values=${var.project} Key=tag:Environment,Values=${var.environment}"
}

output "aws_region" {
  description = "워크플로의 aws-actions/configure-aws-credentials 에 넣을 리전."
  value       = var.aws_region
}

output "api_url" {
  description = "DNS 와 인증서 설정이 끝난 뒤의 백엔드 주소."
  value       = "https://${var.api_domain}"
}
