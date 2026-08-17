# dahaze

dahaze는 [RSPDL](https://github.com/rspdl/rspdl-core)로 제품 기획을 쓰고, 구현 전에 검증하는
웹 워크스페이스입니다.

RSPDL은 제품 기획의 데이터와 정책을 사람이 읽고 기계가 검증할 수 있게 만드는 한국어 우선
선언형 언어입니다. dahaze는 그 언어를 **쓰고, 컴파일하고, 결과를 읽는 자리**를 제공합니다.
문법 파일을 직접 쓸 수도 있지만, 주로 MCP와 LLM을 통해 쓰이도록 설계되었습니다.

> 컴파일러가 유일한 해석자다. dahaze는 그 결과를 저장·전달·표시할 뿐 재해석하지 않는다.

## 구성

| | |
|---|---|
| `apps/web` | Next.js 프론트엔드 — Vercel |
| `apps/api` | FastAPI 백엔드 + MCP 서버 — AWS Lightsail |
| `packages/api-client` | **생성물.** openapi.json → TanStack Query 훅 + zod |
| `packages/ui` · `design-system` | 공용 컴포넌트와 디자인 토큰 |
| `packages/config` | 공유 tsconfig. eslint·tailwind 설정은 `apps/web` 과 함께 들어온다 |
| `packages/rspdl-editor` | CodeMirror 6 RSPDL 언어 모드 |
| `infra/` | Terraform (AWS Lightsail) |

## 요구사항

- Node.js 22+ 와 `pnpm`
- Python 3.12+ 와 [`uv`](https://docs.astral.sh/uv/)
- Docker (로컬 Postgres)

### 플랫폼 제약

RSPDL 컴파일러는 네이티브 확장이고 **x86_64 + glibc** 에서만 설치됩니다.

| 지원 | 미지원 |
|---|---|
| Linux x86_64 (glibc) | **Linux arm64** — wheel도 sdist도 없음 |
| macOS 14+ (arm64·x86_64) | **Alpine/musl** |
| Windows x86_64 | Bun, Deno, 브라우저 |

Apple Silicon 맥에서 로컬 개발은 됩니다. 그러나 AWS Graviton(t4g) 같은 **Linux arm64 에서는
설치 자체가 실패**합니다. 근거는 [ADR-0002](docs/adr/0002-rspdl-compiler-integration.md).

```console
./scripts/check_platform.sh
```

## 시작하기

```console
pnpm install
cd apps/api && uv sync --extra dev && cp .env.example .env && cd -

docker compose -f deploy/docker-compose.dev.yml up -d   # Postgres
cd apps/api && uv run alembic upgrade head && cd -

pnpm codegen     # openapi.json 생성 → API 클라이언트 생성
pnpm dev
```

로그인을 쓰려면 GitHub OAuth App 을 만들어 `apps/api/.env` 에 자격증명을 넣습니다.
없으면 `github` 제공자가 등록되지 않고 `/api/auth/providers` 가 빈 목록을 돌려줍니다.

## 검사

```console
./scripts/check.sh
```

플랫폼, 아키텍처 경계, 린트, 타입, 테스트, OpenAPI 드리프트, codegen을 한 번에 검사합니다.
CI와 같은 게이트입니다.

## 문서

- [ADR-0001 모노레포 구조와 기술 스택](docs/adr/0001-monorepo-structure-and-stack.md)
- [ADR-0002 RSPDL 컴파일러 통합과 버전 관리](docs/adr/0002-rspdl-compiler-integration.md)
- [ADR-0003 문서 저장 모델](docs/adr/0003-document-storage-model.md)
- [ADR-0004 배포 인프라](docs/adr/0004-deployment-infrastructure.md)
- [ADR-0005 MCP 서버와 LLM 저작 루프](docs/adr/0005-mcp-and-llm-authoring.md)
- [설계 컨텍스트](docs/design-context.md) — 현재 상태·제약·미완 목록. 이어받을 때 먼저 읽는다
- [기여 가이드](CONTRIBUTING.md)
- [에이전트 컨텍스트](AGENTS.md)

## 프로젝트 상태

초기 단계입니다. RSPDL이 `0.x` 이므로 문법과 공개 API가 변할 수 있고, dahaze도 그에 맞춰
움직입니다. 지금 고정된 rspdl 버전은 `apps/api/pyproject.toml` 에 있습니다.
