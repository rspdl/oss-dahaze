# dahaze.xyz DNS.
#
# 도메인 등록기관은 가비아이고, 네임서버만 Route53 으로 옮긴다. 등록 자체는 Terraform 이
# 다루지 않는다 — 이 계정은 Route53 Domains 를 쓸 수 없고(Free Tier 제한), 무엇보다
# 도메인 소유권은 인프라 코드가 만들었다 지웠다 할 대상이 아니다.
#
# **이전 순서가 중요하다.** 호스팅 영역과 레코드를 먼저 다 만든 뒤, 마지막에 가비아에서
# 네임서버를 바꾼다. 순서를 뒤집으면 레코드가 비어 있는 영역으로 위임되어 전파되는 동안
# 도메인 전체가 죽는다.

resource "aws_route53_zone" "root" {
  count = var.manage_dns ? 1 : 0

  name    = var.domain_name
  comment = "dahaze — 가비아에서 위임. 네임서버 변경은 등록기관 콘솔에서 수동."

  tags = { Project = var.project, Environment = var.environment }
}

# --- 이전 시점에 이미 존재하던 레코드 -----------------------------------------
#
# 가비아에서 확인한 것은 아래 둘뿐이다 (MX·TXT·CAA·루트 A 없음). 위임 전에 여기 옮겨
# 두지 않으면 전파되는 순간 조용히 끊긴다.

# 프론트엔드. Vercel 이 자기 도메인 설정에서 값을 알려준다.
resource "aws_route53_record" "app" {
  count = var.manage_dns && var.vercel_cname != "" ? 1 : 0

  zone_id = aws_route53_zone.root[0].zone_id
  name    = "app.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.vercel_cname]
}

# --- API ----------------------------------------------------------------------
#
# 이전에는 Railway 를 가리키는 CNAME 이었다. 이제 Lightsail 고정 IP 를 가리키는 A 레코드다.
# CNAME 에서 A 로 바뀌므로 같은 이름에 두 타입이 공존할 수 없다 — 위임과 함께 갈아탄다.
resource "aws_route53_record" "api" {
  count = var.manage_dns ? 1 : 0

  zone_id = aws_route53_zone.root[0].zone_id
  name    = var.api_domain
  type    = "A"
  # 전환 직후에는 짧게 둔다. 잘못 가리켰을 때 되돌리는 시간이 TTL 만큼 걸린다.
  ttl     = 60
  records = [aws_lightsail_static_ip.api.ip_address]
}

# 인증서를 Let's Encrypt 로만 받는다는 것을 명시한다. 다른 CA 가 이 도메인으로 발급하는
# 것을 막아, 발급 경로가 하나로 좁혀진다.
resource "aws_route53_record" "caa" {
  count = var.manage_dns ? 1 : 0

  zone_id = aws_route53_zone.root[0].zone_id
  name    = var.domain_name
  type    = "CAA"
  ttl     = 3600
  records = ["0 issue \"letsencrypt.org\""]
}
