---
id: deployment-infrastructure
title: Deployment Infrastructure
type: adr
status: accepted
version: "1"
summary: Deploys the frontend to Vercel and the backend to a single x86_64 AWS Lightsail instance running docker-compose, with Terraform in a separate private repository owning the infrastructure.
topics:
  - deployment
  - infrastructure
  - aws
  - terraform
related:
  - rspdl-compiler-integration
  - monorepo-structure-and-stack
last_updated: "2026-08-23"
owners:
  - rspdl-maintainers
---

# Deployment Infrastructure

## 상태

Accepted.

## 결정

| 구성 | 위치 | 도메인 |
|---|---|---|
| 프론트 (Next.js) | Vercel | `app.dahaze.xyz` |
| 백엔드 (FastAPI + MCP) | AWS Lightsail 인스턴스, docker-compose | `api.dahaze.xyz` |
| DB (Postgres) | 같은 인스턴스의 컨테이너 | 외부 노출 없음 |
| 쿠키 | `.dahaze.xyz` 상위 도메인, `SameSite=Lax` | `app` ↔ `api` 세션 공유 |

인프라는 Terraform 이 소유하고, **그 Terraform 은 비공개 저장소 `dahaze-infra` 에 있다.**

### 인프라 코드는 이 저장소에 두지 않는다

이 저장소는 공개다. Terraform 과 배포 스크립트에는 시크릿이 없지만 — 시크릿은 Parameter
Store 가 소유한다 — 인스턴스 ID·계정 ID·IAM 정책·nginx 설정·롤아웃 절차가 그대로 드러난다.
그건 시크릿이 아니라 지도이고, 공개할 이유가 없다.

| 무엇 | 어디 |
|---|---|
| Terraform (`infra/bootstrap` · `infra/prod`) | `dahaze-infra` (비공개) |
| 프로덕션 compose · nginx · 롤아웃 스크립트 (`deploy/`) | `dahaze-infra` (비공개) |
| 이미지 빌드와 롤아웃 트리거 (`.github/workflows/deploy.yml`) | 이 저장소 |
| API 이미지 정의 (`apps/api/Dockerfile`) | 이 저장소 |
| 로컬 개발용 Postgres (`docker-compose.dev.yml`) | 이 저장소 |

배포 워크플로우가 여기 남은 것은 **이미지 빌드가 애플리케이션 코드의 일**이기 때문이다.
그 워크플로우는 값을 파일에 두지 않는다 — AWS 는 OIDC 로 붙고, 인스턴스 ID·ECR 저장소·
도메인은 전부 repository variables 에서 읽는다. 그래서 파일이 공개돼도 새로 드러나는 값이 없다.

로컬 개발용 compose 는 인프라가 아니라 개발 도구다. 그게 없으면 기여자가 테스트를 돌릴 수
없으므로 공개 저장소에 남긴다.

인스턴스는 비공개 저장소를 clone 하지 않는다. deploy key 를 인스턴스에 두면 위의 "시크릿을
인스턴스에 밀어 넣지 않는다"가 무너지기 때문이다. 대신 롤아웃 스크립트·프로덕션 compose·
nginx 설정 세 파일을 운영자가 부트스트랩 때 한 번 놓고, 배포는 이미 놓인 스크립트를 SSM 으로
부를 뿐이다. 인스턴스가 늘어나기 시작하면 S3 + 인스턴스 IAM 역할로 옮긴다.

이 갈라짐의 대가는 **배포 방식을 바꿀 때 두 저장소를 함께 고치고 인스턴스에도 다시 놓아야
한다**는 것이다. `rollout.sh` 의 인자가 바뀌면 `deploy.yml` 의 `send-command` 도 함께
바뀌어야 하고, 그 불일치를 CI 가 잡아 주지 않는다. 그래서 배포 경로를 건드리는 PR 은 짝이
되는 PR 을 함께 연다.

### 아키텍처는 x86_64 로 고정한다

Lightsail 번들을 **반드시 x86 계열로 지정한다.** ARM 번들을 고르면 `pip install rspdl` 이
실패한다 — RSPDL은 linux aarch64 wheel 도 sdist 도 배포하지 않는다(ADR-0002 참조).
같은 이유로 API 이미지의 베이스는 **debian/glibc 계열**이어야 하고 Alpine 을 쓸 수 없다.

이건 취향이 아니라 하드 제약이므로, 배포 파이프라인이 시작할 때 `uname -m` 과 wheel 태그를
확인하는 가드를 둔다.

### SSM 관리형 인스턴스로 등록한다

Lightsail 인스턴스에는 EC2 처럼 IAM 인스턴스 프로파일을 붙일 수 없다. 그러나 **Systems Manager
하이브리드 활성화(activation)로 관리형 인스턴스로 등록하면 IAM 역할을 가질 수 있다.** 인스턴스가
SSM Agent 를 설치하고 활성화 코드로 등록하면, 그때부터 활성화에 묶인 역할을 assume 한다.

이 선택이 세 가지를 한꺼번에 해결한다.

- **인스턴스가 스스로 Parameter Store 를 읽는다.** 배포가 시크릿을 밀어 넣지 않으므로, 값이
  CI 로그·아티팩트·SSH 세션을 지나가지 않는다.
- **SSH 를 없앤다.** 22번 포트를 닫고 80·443 만 연다. 접근은 Session Manager 로 한다.
  배포 키를 GitHub 시크릿에 두지 않으므로 그 키가 유출될 경로 자체가 사라진다.
- **배포는 `ssm send-command` 로 한다.** 명령 실행 이력이 SSM 에 남는다.

시크릿 값 자체는 여전히 Terraform 이 소유하지 않는다. 파라미터는 placeholder 로만 만들고
`ignore_changes` 를 걸어, 실제 값은 운영자가 넣는다. state 에도 저장소에도 이미지 레이어에도
들어가지 않는다.

### TLS 는 첫 발급만 수동이다

nginx 와 certbot 은 `user_data` 가 설치하고, 갱신은 타이머가 돌린다. 갱신 훅이 nginx 를
reload 하지 않으면 인증서는 갱신됐는데 옛것을 계속 내보내므로, 훅까지 함께 건다.

**첫 발급은 자동화하지 않는다.** DNS 가 인스턴스를 가리켜야 challenge 가 통과하는데, 그 시점은
Terraform 이 알 수 없다. 대신 인증서가 없어도 nginx 가 80 포트에서 뜨고 죽지 않게 만든다 —
여기서 죽으면 certbot 이 영영 돌 수 없다.

### 컨테이너 하드닝

모든 서비스에 `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, `noexec` tmpfs 를 적용한다.
쓰기가 필요한 경로는 명시적 tmpfs 로만 연다.

이건 이론적 대비가 아니다. 같은 운영자의 인접 프로젝트에서 2026년 8월 Next.js RSC RCE
(CVE-2025-55182)로 컨테이너 `/tmp` 에 XMRig 가 심어져 2주간 root 로 돌았던 사고가 있었다.
코드 실행 취약점이 또 나와도 페이로드를 놓을 자리가 없게 만든다.

### 왜 Lightsail 인가

고정 요금이라 비용 예측이 쉽고, 단일 인스턴스 + docker-compose 는 이 규모에 맞는 가장 단순한
형태다. 나중에 버전별 컴파일러 컨테이너를 늘릴 때도 compose 파일에 서비스를 더하면 된다.

받아들인 비용은 위의 IAM 프로파일 부재와, 인스턴스 패치·백업·TLS 갱신이 직접 책임이라는 점이다.
Postgres 는 컨테이너이므로 스냅샷 백업을 별도로 챙겨야 한다.

## 결과

- 인프라가 코드로 관리되고 재현 가능하다.
- 배포 타깃 아키텍처가 잘못되면 파이프라인이 배포 전에 멈춘다.
- 프론트는 Vercel 프리뷰 배포를 그대로 누린다.
- **인바운드는 80·443 뿐이다.** SSH 키가 없으므로 유출될 키도 없다.
- 인스턴스가 SSM 에서 떨어져 나가면 배포가 막힌다. SSH 라는 우회로를 없앤 대가이며,
  복구는 Lightsail 콘솔의 브라우저 SSH 로 한다.
- 첫 인증서 발급과 DNS 등록은 여전히 사람이 한 번 한다.
- 공개 저장소만 보고는 인프라를 재현할 수 없다. 의도한 결과이며, 대신 이 ADR 이
  무엇이 어디 있는지를 밝힌다.
