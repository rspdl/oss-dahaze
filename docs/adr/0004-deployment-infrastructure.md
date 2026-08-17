---
id: deployment-infrastructure
title: Deployment Infrastructure
type: adr
status: accepted
version: "1"
summary: Deploys the frontend to Vercel and the backend to a single x86_64 AWS Lightsail instance running docker-compose, with Terraform owning the infrastructure.
topics:
  - deployment
  - infrastructure
  - aws
  - terraform
related:
  - rspdl-compiler-integration
  - monorepo-structure-and-stack
last_updated: "2026-08-17"
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

인프라는 `infra/` 의 Terraform 이 소유한다.

### 아키텍처는 x86_64 로 고정한다

Lightsail 번들을 **반드시 x86 계열로 지정한다.** ARM 번들을 고르면 `pip install rspdl` 이
실패한다 — RSPDL은 linux aarch64 wheel 도 sdist 도 배포하지 않는다(ADR-0002 참조).
같은 이유로 API 이미지의 베이스는 **debian/glibc 계열**이어야 하고 Alpine 을 쓸 수 없다.

이건 취향이 아니라 하드 제약이므로, 배포 파이프라인이 시작할 때 `uname -m` 과 wheel 태그를
확인하는 가드를 둔다.

### 시크릿 관리

**Lightsail 인스턴스에는 IAM 인스턴스 프로파일을 붙일 수 없다.** EC2 에서 흔한 "인스턴스가 SSM
Parameter Store 에서 시크릿을 당겨온다" 패턴을 그대로 쓸 수 없다.

대신 배포 시점에 GitHub Actions 가 OIDC 로 AWS 자격증명을 얻어 Parameter Store 에서 값을 읽고,
SSH 로 인스턴스의 `/opt/dahaze/.env` 를 다시 쓴다. 시크릿은 Terraform state 에도, 저장소에도,
이미지 레이어에도 들어가지 않는다.

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
