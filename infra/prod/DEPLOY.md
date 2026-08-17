# dahaze 백엔드 배포 절차

처음 하는 사람을 기준으로 썼다. 위에서부터 순서대로 하면 된다.

## 무엇을 만드는가

| 구성 | 위치 |
|---|---|
| 프론트 (Next.js) | Vercel — 이 문서의 범위 밖 |
| 백엔드 (FastAPI + MCP) | Lightsail 인스턴스 하나, docker-compose |
| Postgres | 같은 인스턴스의 컨테이너. 관리형 DB 가 아니다 |
| TLS 종단 | 호스트 nginx + Let's Encrypt |
| 런타임 설정 | SSM Parameter Store `/dahaze/prod/*` |

근거는 `docs/adr/0004-deployment-infrastructure.md` 에 있다.

## 먼저 알아야 할 두 가지

### 1. 아키텍처는 x86_64 로 고정이다

RSPDL 은 linux aarch64 wheel 도 sdist 도 배포하지 않는다. ARM 번들을 고르면
`pip install rspdl` 이 소스 빌드로 fallback 하지도 못하고 실패해서, API 이미지는
빌드조차 되지 않는다 (`docs/adr/0002-rspdl-compiler-integration.md`).

Terraform 이 세 겹으로 막는다.

- `var.lightsail_bundle_id` 의 validation 이 `_arm_` 이 들어간 ID 를 거절한다
- 같은 변수의 두 번째 validation 이 알려진 x86 번들 ID 형태만 통과시킨다 (allowlist 라서
  새 ARM 번들 이름이 생겨도 막힌다)
- 부팅 스크립트가 `uname -m` 을 확인하고 x86_64 가 아니면 거기서 멈춘다

번들 목록은 직접 확인할 수 있다. ARM 계열이 있다면 ID 에 `arm` 이 들어간다.

```console
$ aws lightsail get-bundles --region ap-northeast-2 \
    --query 'bundles[?supportedPlatforms[0]==`LINUX_UNIX`].[bundleId,ramSizeInGb,cpuCount,price]' \
    --output table
```

기본값 `medium_3_0` (4GB / 2 vCPU) 을 쓰는 이유는 `variables.tf` 주석에 있다.
요약하면, Z3 솔버 힙과 Postgres `shared_buffers` 가 2GB 박스에서 동시에 커지면
OOM killer 가 돌고 그 희생자는 대개 Postgres 다.

### 2. Lightsail 에는 IAM 인스턴스 프로파일을 붙일 수 없다

EC2 라면 인스턴스에 역할을 붙이고 끝날 일이다. Lightsail 은 그게 안 된다.
그래서 이 스택은 **SSM 하이브리드 활성화**로 인스턴스를 관리형 노드(`mi-*`)로 등록한다.
등록된 노드는 `dahaze-prod-instance-role` 의 임시 자격증명을 받아 오고, 그 역할에는
`/dahaze/prod/*` 파라미터 읽기 권한만 있다.

결과적으로 이렇게 나뉜다.

- **인스턴스**가 자기 시크릿을 읽는다 (`dahaze-env-sync`)
- **GitHub Actions** 는 시크릿을 읽지 않는다. "그 박스에서 롤아웃을 돌려라" 라고
  시키고 결과를 기다리는 권한만 가진다
- **SSH 는 쓰지 않는다.** 22번 포트는 닫혀 있고 접속은 Session Manager 로 한다

---

## 사람이 해야만 하는 일

코드로 옮길 수 없는 단계다. 나머지는 전부 Terraform 이거나 한 줄짜리 명령이다.

| 단계 | 왜 자동화할 수 없나 |
|---|---|
| 도메인 A 레코드 등록 | 등록기관 계정이 AWS 밖에 있다 |
| GitHub OAuth App 생성 | GitHub 웹 UI 에서만 만들 수 있고, 시크릿은 생성 직후 한 번만 보인다 |
| SSM 파라미터에 실제 값 넣기 | Terraform 이 값을 알면 state 에 남는다. 그래서 골격만 만든다 |
| 인증서 최초 발급 | DNS 가 이 인스턴스를 가리킨 **뒤에야** 검증이 통과한다 |
| 저장소를 인스턴스에 배치 | 첫 배포 전에는 인스턴스에 롤아웃 스크립트가 없다 |

---

## 1단계 — state 백엔드 (계정당 한 번)

```console
$ export AWS_PROFILE=<관리자 프로파일>
$ cd infra/bootstrap
$ terraform init
$ terraform apply
```

S3 버킷 `dahaze-tfstate` 와 DynamoDB 락 테이블 `dahaze-tfstate-lock` 이 생긴다.
버킷 이름은 전 계정 공통 네임스페이스라 이미 쓰이고 있으면 apply 가 실패한다.
그때는 `var.state_bucket_name` 을 바꾸고, **`infra/prod/versions.tf` 의 backend 블록도
같은 값으로 고친다** (backend 블록에는 변수를 쓸 수 없다).

이 스택의 state 는 로컬 파일이다. 자기 자신을 저장할 원격 백엔드가 아직 없기 때문이다.

## 2단계 — 비상용 SSH 키 만들기

평소에는 쓰지 않는다. 그래도 지금 만들어야 하는 이유는, Lightsail 이 키쌍을 인스턴스
**생성 시점에만** 받기 때문이다. SSM 등록이 깨져 들어갈 길이 없어진 날 키를 추가하려면
인스턴스를 다시 만들어야 하고, 그건 Postgres 데이터를 버린다는 뜻이다.

```console
$ ssh-keygen -t ed25519 -f ~/.ssh/dahaze-break-glass -C dahaze-break-glass
```

개인키는 로컬에만 둔다. Terraform 에는 **공개키만** 넣는다.

## 3단계 — 인프라 apply

`terraform.tfvars` 를 만든다. 이 파일은 커밋하지 않는다.

```hcl
acme_email     = "<인증서 만료 알림을 받을 주소>"
ssh_public_key = "ssh-ed25519 AAAA... dahaze-break-glass"

# 같은 계정의 다른 프로젝트가 GitHub OIDC 프로바이더를 이미 만들었다면 false
# create_github_oidc_provider = true
```

```console
$ cd infra/prod
$ terraform init
$ terraform plan
$ terraform apply
```

`init` 에서 `dynamodb_table` deprecation 경고가 뜬다. 정상이다 — 이유는
`versions.tf` 주석에 있다.

apply 가 끝나면 출력이 나온다. `static_ip` 와 `github_actions_role_arn` 을 적어 둔다.

```console
$ terraform output
```

> **plan 출력을 로그로 남길 때 주의.** `user_data` 는 `(sensitive value)` 로 가려진다.
> 그 안에 SSM 등록 코드가 들어 있어서 일부러 가린 것이다. 가림을 풀지 않는다.

인스턴스는 부팅하면서 5~10분 동안 패키지를 설치한다. 등록이 끝났는지 확인한다.

```console
$ aws ssm describe-instance-information \
    --filters "Key=tag:Project,Values=dahaze" "Key=tag:Environment,Values=prod" \
    --query 'InstanceInformationList[].[InstanceId,PingStatus,PlatformName]' --output table
```

`mi-` 로 시작하는 ID 가 `Online` 으로 보이면 성공이다. 안 보이면 부팅 로그를 봐야 하는데,
그러려면 아래 "들어갈 길이 없을 때" 를 본다.

## 4단계 — DNS (등록기관에서 손으로)

`api.dahaze.xyz` 의 A 레코드를 `terraform output static_ip` 값으로 만든다.

고정 IP 는 인스턴스와 분리된 리소스라, 나중에 인스턴스를 교체해도 이 레코드는
그대로 둔다.

```console
$ dig +short api.dahaze.xyz
```

출력이 `static_ip` 와 같아질 때까지 기다린다. 전파에 몇 분에서 몇십 분 걸린다.

## 5단계 — GitHub OAuth App (GitHub 웹에서 손으로)

<https://github.com/settings/developers> 에서 새 OAuth App 을 만든다.

| 항목 | 값 |
|---|---|
| Homepage URL | `https://app.dahaze.xyz` |
| Authorization callback URL | `https://api.dahaze.xyz/api/auth/github/callback` |

콜백 URL 은 아래 `OAUTH_REDIRECT_URI` 파라미터와 **글자 하나까지 같아야 한다.**
Client secret 은 생성 직후 한 번만 보인다. 그 자리에서 6단계로 넘어가는 편이 낫다.

로컬 개발용 OAuth App 은 따로 만든다. 콜백 URL 이 다르기 때문이다.

## 6단계 — SSM 파라미터에 실제 값 넣기

Terraform 은 파라미터의 **이름과 타입만** 만들었다. 값은 전부 `placeholder` 다.
값까지 Terraform 이 들고 있으면 state 파일과 plan 출력에 시크릿이 남고, state 는
저장소보다 지우기 어려운 곳에 오래 남는다.

값은 아래처럼 넣는다. `--overwrite` 를 빼면 안 된다 (파라미터는 이미 존재한다).

```console
$ P=/dahaze/prod
$ put() { aws ssm put-parameter --name "$1" --value "$2" --type "$3" --overwrite >/dev/null && echo "  set $1"; }
```

시크릿 (`SecureString`):

```console
$ put $P/SESSION_SECRET      "$(openssl rand -hex 32)"                      SecureString
$ put $P/POSTGRES_PASSWORD   "$(openssl rand -hex 24)"                      SecureString
$ put $P/DATABASE_URL        "postgresql://dahaze:<위 비밀번호>@db:5432/dahaze" SecureString
$ put $P/GITHUB_CLIENT_ID    "<OAuth App 의 Client ID>"                      SecureString
$ put $P/GITHUB_CLIENT_SECRET "<OAuth App 의 Client secret>"                 SecureString
$ put $P/OPENAI_API_KEY      "<OpenAI 키>"                                   SecureString
```

`DATABASE_URL` 의 호스트는 `localhost` 가 아니라 **`db`** 다. compose 네트워크 안에서
api 컨테이너가 db 컨테이너를 그 이름으로 부른다. 비밀번호는 `POSTGRES_PASSWORD` 와
같은 값이어야 한다 — 다르면 마이그레이션 단계에서 인증 오류로 멈춘다.

`SESSION_SECRET` 은 32바이트 미만이면 앱이 아예 뜨지 않는다. 세션 쿠키와 MCP 토큰이
모두 이 값 하나로 서명되기 때문이다 (`apps/api/src/dahaze_api/config.py`).

설정 (`String`) — 값이 정해져 있으므로 그대로 붙여 넣으면 된다:

```console
$ put $P/CORS_ALLOW_ORIGINS  "https://app.dahaze.xyz"                                  String
$ put $P/COOKIE_DOMAIN       ".dahaze.xyz"                                             String
$ put $P/COOKIE_SECURE       "true"                                                    String
$ put $P/COOKIE_SAMESITE     "lax"                                                     String
$ put $P/OAUTH_REDIRECT_URI  "https://api.dahaze.xyz/api/auth/github/callback"         String
$ put $P/WEB_POST_LOGIN_URL  "https://app.dahaze.xyz"                                  String
$ put $P/OPENAI_MODEL        "gpt-4.1"                                                 String
$ put $P/POSTGRES_DB         "dahaze"                                                  String
$ put $P/POSTGRES_USER       "dahaze"                                                  String
```

`COOKIE_DOMAIN` 앞의 점이 중요하다. `app.dahaze.xyz` 와 `api.dahaze.xyz` 가 세션 쿠키를
공유하려면 상위 도메인 쿠키여야 한다 (ADR-0004).

`COOKIE_SECURE=true` 가 아니면 앱이 뜨지 않는다. 이것도 앱의 기동 검사다.

넣지 않은 값이 있는지 확인한다.

```console
$ aws ssm get-parameters-by-path --path /dahaze/prod --recursive \
    --query 'Parameters[?Value==`placeholder`].Name' --output text
```

아무것도 안 나와야 한다. 여기서 남은 게 있으면 `dahaze-env-sync` 가 배포를 거부한다.

## 7단계 — 저장소를 인스턴스에 배치 (한 번)

롤아웃 스크립트와 compose 파일과 nginx 설정이 인스턴스에 있어야 한다. 배포가 SSH 로
파일을 밀어 넣지 않으므로, 인스턴스가 저장소에서 직접 가져온다.

Session Manager 로 들어간다.

```console
$ INSTANCE_ID=$(aws ssm describe-instance-information \
    --filters "Key=tag:Project,Values=dahaze" "Key=tag:Environment,Values=prod" \
    --query 'InstanceInformationList[0].InstanceId' --output text)
$ aws ssm start-session --target "$INSTANCE_ID"
```

들어가서 (`/opt/dahaze` 는 부팅 때 빈 디렉터리로 만들어져 있다):

```console
$ sudo git clone https://github.com/rspdl/dahaze /opt/dahaze
$ sudo dahaze-env-sync
```

`dahaze-env-sync` 가 SSM 값을 읽어 `/opt/dahaze/.env` (0600, root 소유) 를 만든다.
`placeholder` 가 하나라도 남아 있으면 어떤 키인지 알려주고 멈춘다.

> 저장소가 private 이거나 컨테이너 이미지 레지스트리가 인증을 요구하면 이 단계에
> 자격증명이 하나 더 필요하다 (deploy key 또는 `docker login`). 그건 이 스택의
> 범위 밖이다.

## 8단계 — TLS 발급 (DNS 가 전파된 뒤, 명령 하나)

부팅 시점에는 인증서가 없다. 그래서 nginx 는 평문 전용 임시 사이트로 떠 있다.
저장소의 `deploy/nginx/api.conf` 는 인증서 파일을 include 하므로, 인증서 없이 걸면
nginx 가 기동에 실패하고 그러면 발급을 영원히 못 한다. 그 순환을 끊는 것이 이 단계다.

```console
$ sudo dahaze-tls-bootstrap
```

이 한 줄이 하는 일:

1. `api.dahaze.xyz` 가 정말 이 인스턴스를 가리키는지 확인한다 (아니면 여기서 멈추고
   이유를 말한다 — certbot 이 뱉는 `Invalid response` 보다 훨씬 읽기 쉽다)
2. webroot 방식으로 인증서를 발급한다
3. `/opt/dahaze/deploy/nginx/api.conf` 를 `sites-enabled` 에 **링크로** 건다
   (복사하지 않는 이유: 복사하면 배포로 갱신된 설정과 서비스 중인 설정이 조용히 갈라진다)
4. 임시 사이트를 걷어내고 nginx 를 reload 한다

갱신은 자동이다. `certbot.timer` 가 돌고, `/etc/letsencrypt/renewal-hooks/deploy/` 의
훅이 갱신 직후 nginx 를 reload 한다. 이 훅이 없으면 "갱신은 됐는데 nginx 가 옛 인증서를
계속 물고 있는" 상태가 되고, 그건 로그에 아무 오류도 남기지 않는다.

```console
$ sudo certbot renew --dry-run
```

## 9단계 — GitHub Actions 연결

저장소 **Settings → Environments → production** 을 만들고 Variables 를 등록한다.

| Variable | 값 |
|---|---|
| `AWS_REGION` | `terraform output -raw aws_region` |
| `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_actions_role_arn` |

역할은 이 저장소의 `main` 브랜치 또는 `production` Environment 에서 온 토큰만 맡을 수
있다. 워크플로에는 `permissions: id-token: write` 가 필요하다.

배포는 SSH 가 아니라 Run Command 로 한다. `mi-*` ID 는 부팅 시점에 정해지므로 태그로 찾는다.

```console
$ INSTANCE_ID=$(aws ssm describe-instance-information \
    --filters "Key=tag:Project,Values=dahaze" "Key=tag:Environment,Values=prod" \
    --query 'InstanceInformationList[0].InstanceId' --output text)

$ CMD=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "dahaze rollout $IMAGE_TAG" \
    --parameters commands="[\"set -euo pipefail\",\"cd /opt/dahaze\",\"git fetch --depth 1 origin main\",\"git checkout -f FETCH_HEAD\",\"dahaze-env-sync\",\"deploy/lightsail/rollout.sh $IMAGE_TAG\"]" \
    --query 'Command.CommandId' --output text)

$ aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE_ID"
```

배포 역할이 할 수 있는 일은 이게 전부다. 파라미터를 읽을 권한도, 다른 SSM 문서를 돌릴
권한도, 다른 노드에 명령을 보낼 권한도 없다.

## 10단계 — 확인

```console
$ curl -sf https://api.dahaze.xyz/health
$ curl -sI https://api.dahaze.xyz/ | head -n 1
```

인스턴스 안에서:

```console
$ cd /opt/dahaze && sudo docker compose -f docker-compose.prod.yml ps
$ sudo docker compose -f docker-compose.prod.yml logs --tail 50 api
```

`/health` 는 컴파일러가 실제로 로드되는지까지 확인한다. 네이티브 확장이 플랫폼 불일치로
열리지 않으면 여기서 드러난다.

---

## 운영 중 자주 하는 일

### 시크릿 교체

```console
$ aws ssm put-parameter --name /dahaze/prod/SESSION_SECRET --value "$(openssl rand -hex 32)" \
    --type SecureString --overwrite
$ # 인스턴스에서
$ sudo dahaze-env-sync && cd /opt/dahaze && sudo docker compose -f docker-compose.prod.yml up -d api
```

Terraform 은 관여하지 않는다. `ignore_changes = [value]` 라서 다음 apply 가 값을
`placeholder` 로 되돌리지 않는다.

### 백업

Lightsail 자동 스냅샷이 매일 18:00 UTC (03:00 KST) 에 돈다. Postgres 가 관리형 DB 가
아니라 이 인스턴스의 컨테이너라, 디스크 스냅샷이 유일한 백업이다.

```console
$ aws lightsail get-instance-snapshots --query 'instanceSnapshots[].[name,createdAt,state]' --output table
```

스키마를 바꾸는 배포 전에는 수동 스냅샷을 하나 더 찍어 두는 편이 낫다.

```console
$ aws lightsail create-instance-snapshot \
    --instance-name dahaze-prod --instance-snapshot-name dahaze-prod-$(date +%Y%m%d-%H%M)
```

### 들어갈 길이 없을 때 (break-glass)

SSM 등록이 깨지면 Session Manager 도 못 쓴다. 그때만 22번을 잠깐 연다.

```hcl
# terraform.tfvars
enable_break_glass_ssh = true
break_glass_ssh_cidrs  = ["<내 IP>/32"]
```

```console
$ terraform apply
$ ssh -i ~/.ssh/dahaze-break-glass ubuntu@$(terraform output -raw static_ip)
$ sudo tail -n 200 /var/log/dahaze-bootstrap.log
```

**끝나면 반드시 되돌린다.** `enable_break_glass_ssh = false` 로 두고 apply 한다.

### 인스턴스를 다시 만들어야 할 때

`user_data` 는 최초 부팅에서 한 번만 실행되고, Terraform 은 그 변경을 무시한다
(`lifecycle.ignore_changes`). 이 무시가 없으면 부팅 스크립트를 고치거나 활성화가
만료돼 재생성될 때마다 인스턴스가 교체되고, 교체는 곧 **Postgres 데이터 삭제**다.

정말로 다시 만들어야 한다면:

1. 스냅샷을 찍는다 (위 참고)
2. 활성화를 새로 만든다. 등록 코드는 기본 24시간이면 만료되고, 만료된 코드로는
   새 인스턴스가 등록되지 않는다
   ```console
   $ terraform apply -replace=aws_ssm_activation.instance
   ```
3. 인스턴스를 교체한다
   ```console
   $ terraform apply -replace=aws_lightsail_instance.api
   ```
4. 옛 `mi-*` 노드는 남아 있으므로 정리한다
   ```console
   $ aws ssm deregister-managed-instance --instance-id mi-...
   ```
5. 4·6~8단계를 다시 한다. 고정 IP 는 그대로라 DNS 는 건드릴 필요가 없다

---

## 알아 둘 제약과 비용

- **SSM 하이브리드 노드 요금.** 2026년 6월 30일부로 advanced-instances 티어가 없어져서
  Session Manager 를 쓰려고 유료 티어를 켤 필요가 사라졌다. 다만 2026년 9월 30일부터
  하이브리드 노드의 Session Manager / Run Command 는 사용량 기반 과금이다. 노드가
  하나뿐이라 금액은 작지만 0 은 아니다.
- **인스턴스 패치는 직접 책임이다.** Lightsail 은 관리형 서비스가 아니다.
  `unattended-upgrades` 가 보안 패치를 받지만 커널 업데이트에는 재부팅이 필요하다.
- **Postgres 는 컨테이너다.** 관리형 백업도, 자동 페일오버도, PITR 도 없다.
  받아들인 비용이며 ADR-0004 에 적혀 있다.
- **활성화 코드는 state 에 남는다.** `CreateActivation` 이 코드를 한 번만 돌려주므로
  Terraform 이 보관하는 것을 피할 수 없다. 대신 등록 한도를 1회로 두고 만료를 짧게 둬서,
  첫 부팅 이후에는 코드가 있어도 쓸모없게 만들었다. state 버킷은 암호화돼 있다.
