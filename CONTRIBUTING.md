# dahaze에 기여하기

dahaze는 RSPDL 문법 파일을 저작하고 검증하는 웹 서비스입니다. 이 문서는 저장소를 처음 접한
기여자가 환경을 준비하고, 변경에 맞는 테스트를 추가하고, 검토 가능한 Pull Request를 만드는 데
필요한 기준을 설명합니다.

## 시작하기

다음 도구가 필요합니다.

- Git
- **Node.js 22 이상**과 `pnpm`
- **Python 3.12 이상**과 [`uv`](https://docs.astral.sh/uv/)
- Docker (로컬 Postgres용)

```console
pnpm install
cd apps/api && uv sync --extra dev && cp .env.example .env && cd -
docker compose -f deploy/docker-compose.dev.yml up -d
cd apps/api && uv run alembic upgrade head && cd -
```

여기까지 하고 `pnpm dev` 를 띄우면 바로 로그인할 수 있습니다. `.env.example` 이
`ENVIRONMENT=development` 로 오기 때문에 첫 화면에 아이디·비밀번호 폼이 뜹니다 — 아이디는
아무거나, 비밀번호는 `DEV_LOGIN_PASSWORD`(기본값 `dahaze`)입니다. **OAuth App 을 만들지
않아도 됩니다.**

아이디가 곧 계정입니다. 다른 아이디로 들어오면 다른 사용자가 되므로 접근 격리를 손으로
확인할 때 그렇게 씁니다. 이 문은 `development` 에서만 열리며, 그 근거는
`Settings.dev_login_enabled` 와 `tests/test_auth_api.py` 에 있습니다.

테스트는 **실제 Postgres 에 붙습니다.** SQLite 로 대체하지 않는 이유는 JSONB, 부분 유니크
인덱스, `ON CONFLICT DO NOTHING` 이 전부 방언에 의존하기 때문입니다 — 그것들이 프로덕션에서만
다르게 동작하면 테스트가 통과해도 아무것도 보장하지 못합니다.

### 플랫폼 요구사항

RSPDL 컴파일러는 네이티브 확장이며 **x86_64 + glibc** 에서만 설치됩니다.

| 지원 | 미지원 |
|---|---|
| Linux x86_64 (glibc) | **Linux arm64** — wheel도 sdist도 없음 |
| macOS 14+ (arm64·x86_64) | **Alpine/musl** |
| Windows x86_64 | Bun, Deno, 브라우저 |

Apple Silicon 맥에서 로컬 개발은 됩니다. 그러나 **Linux arm64(AWS Graviton, t4g)에서는
`uv sync` 자체가 실패**합니다. 자세한 근거는 [ADR-0002](docs/adr/0002-rspdl-compiler-integration.md).

```console
./scripts/check_platform.sh   # 지금 환경이 되는지 확인
```

## 저장소 구조

| 경로 | 책임 |
|---|---|
| `apps/web` | Next.js 프론트엔드 (Vercel 배포) |
| `apps/api` | FastAPI 백엔드 + MCP 서버 (Lightsail 배포) |
| `packages/api-client` | **생성물.** openapi.json → TanStack Query 훅 + zod |
| `packages/ui` | shadcn 기반 공용 컴포넌트 |
| `packages/design-system` | 토큰과 테마 |
| `packages/rspdl-editor` | CodeMirror 6 RSPDL 언어 모드 |
| `packages/config` | 공유 tsconfig. eslint·tailwind 설정은 `apps/web` 과 함께 들어옵니다 |
| `infra/` | Terraform (AWS Lightsail) |
| `docs/adr` | 이미 내려진 기술 결정과 그 근거 |
| `scripts/` | 검사 하네스 |

의존성 방향과 계층 책임은 [ADR-0001](docs/adr/0001-monorepo-structure-and-stack.md)을 따릅니다.

## 반드시 지켜야 하는 경계

CI가 기계적으로 검사합니다 (`scripts/check_boundaries.py`).

1. **`import rspdl` 은 `apps/api/src/dahaze_api/infrastructure/rspdl/` 안에서만** 합니다.
   RSPDL은 `0.x`라 문법·IR·진단이 minor 릴리스에서 바뀝니다. 그 변화의 폭발 반경을 한
   디렉터리로 묶기 위한 규칙입니다.
2. **`import openai` 는 `infrastructure/llm/` 안에서만** 합니다.
3. **`domain/` 은 순수합니다.** 다른 계층도, FastAPI·SQLAlchemy 같은 프레임워크도
   import하지 않습니다.
4. **`application/` 은 `infrastructure/` 와 `interface/` 를 import하지 않습니다.**
   의존은 `domain/ports.py` 의 port를 통해서만 흐릅니다.

## API를 바꿀 때

FastAPI 라우터가 **API 계약의 유일한 원본**입니다.

```
apps/api/.../interface/rest/**  →  apps/api/openapi.json  →  packages/api-client/src/generated/**
```

- `openapi.json` 을 손으로 고치지 마세요. `pnpm --filter api openapi` 로 생성하고 커밋합니다.
- `packages/api-client` 에 요청 함수를 손으로 쓰지 마세요. 전부 생성물입니다.
- CI가 `openapi.json` 을 재생성해 diff가 비어 있는지 검사합니다. 어긋나면 빨개집니다.

절차는 `.agents/skills/generate-api/SKILL.md` 에 있습니다.

## RSPDL 버전을 올릴 때

`rspdl` 핀을 올리는 것은 의존성 갱신이 아니라 **제품 변경**입니다. 문법이 바뀌면 기존 사용자
문서가 컴파일되지 않을 수 있습니다. `.agents/skills/upgrade-rspdl/SKILL.md` 절차를 따르고,
재컴파일 리포트를 PR에 첨부하세요.

## 테스트 위치

API 테스트는 `apps/api/tests/` 에 평평하게 둡니다. 파일 이름이 대상을 가리킵니다.

- HTTP 계약과 상태 코드: `test_<영역>_api.py` (예: `test_workspace_api.py`)
- 어댑터 계약: `test_<어댑터>_adapter.py` (예: `test_rspdl_adapter.py`)
- 공용 픽스처(실제 Postgres 세션, 로그인한 클라이언트): `conftest.py`

계층별 하위 디렉터리는 지금 규모에서 얻는 것이 없어 두지 않았습니다. 파일이 늘어 찾기
어려워지면 그때 나눕니다.

RSPDL 의미에 의존하는 변경에는 가능하면 네 가지를 함께 넣어 주세요.

- 정상 사례
- 실패 사례
- 경계 사례
- **오류처럼 보이지만 허용되어야 하는 사례**

## 제출 전 검사

```console
./scripts/check.sh
```

플랫폼, 아키텍처 경계, 린트, 타입, 테스트, OpenAPI 드리프트, codegen을 한 번에 검사합니다.
CI와 같은 게이트입니다.

## Git 워크플로우

### 브랜치

| 브랜치 | 역할 |
|---|---|
| `develop` | **기본 브랜치.** 모든 PR이 여기로 머지됩니다. |
| `main` | 프로덕션. `develop` 에서만 승격됩니다. |
| `feat/<이슈번호>-<슬러그>` | 작업 브랜치 |

작업 브랜치 접두사는 변경 성격에 맞춰 씁니다: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.

### 흐름

```
1. 이슈 등록          — 무엇을·왜 바꾸는지 먼저 적습니다
2. 브랜치 생성        — git switch -c feat/42-document-editor
3. 작업 + ./scripts/check.sh
4. PR 생성 → develop  — 설명에 이슈 번호를 연결합니다 (Closes #42)
5. 리뷰 + CI 통과 후 머지
6. develop → main PR  — 릴리스 시점에 승격, 머지 시 프로덕션 배포
```

이슈 없이 PR을 열어도 되는 경우는 오타 수정과 명백한 문서 개선뿐입니다.

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/)를 씁니다. `rspdl-core`와 같은 규칙입니다.

```
feat(api): 문서 리비전 조회 엔드포인트 추가
fix(web): 진단 gutter 가 빈 span 에서 깨지는 문제
docs(adr): 저장 모델 결정 근거 보완
chore(deps): rspdl 0.2.0 으로 승격
```

허용 타입: `feat` `fix` `docs` `refactor` `perf` `test` `build` `ci` `chore`
스코프는 보통 `api` `web` `ui` `api-client` `infra` `adr` 중 하나입니다.

### 릴리스

`develop` → `main` PR이 릴리스 단위입니다. 머지되면 태그가 붙고 프로덕션 배포가 돕니다.
`main` 에 직접 푸시하지 않습니다.

## Pull Request 작성

설명에 다음을 포함해 주세요.

- 변경이 필요한 이유와 해결하려는 사용 사례
- 연결한 이슈 번호
- 선택한 접근 방식과 중요한 대안
- 추가하거나 실행한 테스트
- API 계약, RSPDL 버전 또는 DB 스키마에 미치는 영향
- 명시적으로 구현하지 않은 범위

하나의 PR에는 가능한 한 하나의 목적만 담아 주세요. 리팩터링과 동작 변경은 분리하는 편이
검토하기 좋습니다.

검토 의견 중 이해하지 못한 부분이 있다면 추측하기보다 질문해 주세요.
