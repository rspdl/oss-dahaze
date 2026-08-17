---
id: monorepo-structure-and-stack
title: Monorepo Structure and Technology Stack
type: adr
status: accepted
version: "1"
summary: Selects a pnpm/turbo + uv multi-language monorepo with a hexagonal FastAPI backend and a Next.js frontend generated from OpenAPI.
topics:
  - monorepo
  - architecture
  - frontend
  - backend
related:
  - rspdl-compiler-integration
  - document-storage-model
  - deployment-infrastructure
last_updated: "2026-08-17"
owners:
  - rspdl-maintainers
---

# Monorepo Structure and Technology Stack

## 상태

Accepted.

## 배경

dahaze는 RSPDL 문법 파일을 저작하고 검증하는 웹 서비스다. 한 저장소 안에 TypeScript 프론트엔드와
Python 백엔드가 공존하고, 두 언어가 **하나의 API 계약**을 공유해야 한다. 또 RSPDL 자체가 `0.x`라
문법과 IR이 변할 수 있으므로, 그 변화가 저장소 어디까지 번지는지 경계가 미리 정해져 있어야 한다.

## 결정

### 저장소 구조

```
apps/
  web/         Next.js — Vercel 배포
  api/         FastAPI — Lightsail 컨테이너 배포
packages/
  api-client/  orval 생성 tanstack-query 훅 + zod 스키마
  ui/          shadcn 기반 공용 컴포넌트
  design-system/ 토큰과 테마
  rspdl-editor/  CodeMirror 6 RSPDL 언어 모드
  config/      eslint · tsconfig · tailwind 공유 설정
infra/         Terraform (AWS Lightsail)
deploy/        docker-compose · nginx · 롤아웃 스크립트
docs/          adr · rfcs · guides
```

TypeScript 쪽은 **pnpm workspace + Turborepo**가, Python 쪽은 **uv**가 의존성을 소유한다.
`apps/api`에는 얇은 `package.json`만 두어 turbo 태스크 그래프에 참여시키고, 실제 의존성은
`pyproject.toml`과 `uv.lock`이 소유한다. 두 패키지 매니저를 하나로 합치려 시도하지 않는다.

### 백엔드 계층

`apps/api`는 헥사고날 구조를 따른다.

- `domain/` — 엔티티와 **port** 인터페이스. 외부 라이브러리를 import 하지 않는다.
- `application/` — 유스케이스. port 를 통해서만 바깥과 대화한다.
- `infrastructure/` — port 의 구현체. `rspdl/`, `db/`, `auth/`, `llm/`
- `interface/` — `rest/` (FastAPI 라우터) 와 `mcp/` (MCP 서버)

**`import rspdl` 은 `infrastructure/rspdl/` 안에서만 허용한다.** 이 규칙이 RSPDL 버전 변경의
폭발 반경을 한 디렉터리로 묶는다. 같은 이유로 `import openai` 는 `infrastructure/llm/` 안에서만
허용한다. CI가 이 경계를 검사한다.

### API 계약

FastAPI 라우터가 **유일한 계약 원본**이다. 흐름은 단방향이다.

```
apps/api/src/dahaze_api/interface/rest/**  (Pydantic 모델 + 라우터)
      ↓  scripts/export_openapi.py
apps/api/openapi.json                      (커밋됨)
      ↓  orval
packages/api-client/src/generated/**       (tanstack-query 훅 + zod)
      ↓
apps/web
```

`openapi.json`을 저장소에 커밋하고, **CI가 재생성 후 diff 가 비어 있는지 검사한다.** 손으로 쓴
fetch 래퍼를 두지 않는다 — 프론트가 백엔드 계약에서 조용히 어긋나는 경로를 없애기 위해서다.

### 프론트엔드

Next.js App Router, React 19, Tailwind CSS v4, shadcn/ui.

서버 상태는 **TanStack Query**가 전부 소유한다. **zustand 는 서버에 없는 상태에만 쓴다** —
에디터 초안, 패널 레이아웃, 진단 필터 같은 것. 서버에서 받아온 데이터를 zustand 에 복사하지 않는다.
두 저장소에 같은 데이터가 있으면 어느 쪽이 진실인지 알 수 없게 된다.

## 대안

- **단일 언어(전부 TypeScript)**: `rspdl-core` npm 패키지가 있으니 가능은 하다. 그러나 설치 크기가
  ~100MB 로 Python wheel(27.5MB)보다 훨씬 크고, 서버리스 배포에 부적합하다. 백엔드를 Python 으로
  두면 wheel 하나만 얹으면 된다.
- **polyrepo**: API 계약 드리프트를 CI 하나로 막을 수 없게 되어 버렸다.
- **openapi-typescript(타입만)**: 훅을 손으로 써야 하고, 그 손으로 쓴 코드가 드리프트의 원천이 된다.

## 결과

- 프론트는 백엔드 계약을 어길 수 없다. 어기면 codegen 단계에서 타입 에러가 난다.
- RSPDL 버전 변경의 영향은 `infrastructure/rspdl/` 한 곳에서 흡수된다.
- 기여자는 언어를 하나만 알아도 한쪽 앱에 기여할 수 있다.
