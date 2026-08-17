# 운영 값. 시크릿은 여기 두지 않는다 — Parameter Store 가 소유한다.
acme_email     = "jw.song@digitalpresso.ai"
ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHXimbF1RWoEu2OkBridc683iNLypbtWfchHj6730Wm dahaze break-glass 2026-08-18"

# 가비아에서 Route53 으로 위임한다. 영역과 레코드를 먼저 만들고, 그 다음 등록기관에서
# 네임서버를 바꾼다. 순서를 뒤집으면 빈 영역으로 위임되어 도메인 전체가 잠시 죽는다.
manage_dns = true

# 위임 전 가비아에 실제로 있던 값. 권한 네임서버에 직접 질의해 확인했다.
# 이걸 옮기지 않으면 전파되는 순간 프론트엔드가 끊긴다.
vercel_cname = "610b4e2c18400274.vercel-dns-017.com"
