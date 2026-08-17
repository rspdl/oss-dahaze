---
id: design-context
title: Design Context
type: guide
status: living
version: "1"
summary: Orientation document for new contributors and fresh AI sessions — what exists, how the layers fit, which constraints bite, and what is deliberately unfinished.
topics:
  - onboarding
  - architecture
  - constraints
related:
  - monorepo-structure-and-stack
  - rspdl-compiler-integration
  - document-storage-model
  - deployment-infrastructure
  - mcp-and-llm-authoring
last_updated: "2026-08-17"
owners:
  - rspdl-maintainers
---

# 설계 컨텍스트

이 문서는 저장소를 처음 여는 사람(과 이전 맥락이 없는 AI 세션)이 **지금 무엇이 있고, 조각들이
어떻게 맞물려 있으며, 어디를 건드리면 아픈지**를 다시 유도해내지 않고 알 수 있게 하는 것이
목적이다.

결정의 근거는 [`docs/adr/`](adr/)에 있고 여기서 반복하지 않는다. 이 문서는 그 결정들 사이의
연결 조직이다.

---

## 1. 이 프로젝트가 무엇인가

dahaze는 [RSPDL](https://github.com/rspdl/rspdl-core)로 제품 기획을 쓰고 구현 전에 검증하는 웹
워크스페이스다. RSPDL은 제품 기획의 데이터와 정책을 사람이 읽고 기계가 검증할 수 있게 만드는
한국어 우선 선언형 언어이며, 문법·의미·진단은 전부 `rspdl-core`가 소유한다. dahaze가 하는 일은
텍스트를 보관하고, 컴파일러에 통과시키고, 결과를 그대로 돌려주는 것뿐이다 — 재해석하지 않는다
([`AGENTS.md`](../AGENTS.md)의 "컴파일러가 유일한 해석자다").

문법 파일을 사람이 직접 쓸 수도 있지만, 제품 전제는 **주로 MCP와 LLM을 통해 쓰인다**는 것이다
([`docs/adr/0005-mcp-and-llm-authoring.md`](adr/0005-mcp-and-llm-authoring.md)). 그 생성 경로는
지금 구현 중이다(§2).

---

## 2. 현재 상태

커밋은 둘뿐이다. `feat: RSPDL 저작·검증 워크스페이스 기반 구축`(스캐폴딩·컴파일러 어댑터·분석
API)과 `feat(api): 저장 계층과 인증 추가`(DB·OAuth·워크스페이스 API). 기본 브랜치는 `develop`.

### 만들어졌고 테스트로 확인된 것

| 영역 | 위치 | 상태 |
|---|---|---|
| 도메인 엔티티·값 객체 | [`apps/api/src/dahaze_api/domain/`](../apps/api/src/dahaze_api/domain/) | 완성. 프레임워크 의존 없음 |
| RSPDL 컴파일러 어댑터 | [`apps/api/src/dahaze_api/infrastructure/rspdl/local_adapter.py`](../apps/api/src/dahaze_api/infrastructure/rspdl/local_adapter.py) | `compile` · `check` · `find_model` |
| 분석 유스케이스 + 캐시 | [`application/analysis.py`](../apps/api/src/dahaze_api/application/analysis.py), [`infrastructure/db/analysis_cache.py`](../apps/api/src/dahaze_api/infrastructure/db/analysis_cache.py) | Postgres 캐시. 인메모리 LRU도 있음([`infrastructure/cache.py`](../apps/api/src/dahaze_api/infrastructure/cache.py))이나 현재 배선되지 않음 |
| 프로젝트·문서·리비전 | [`application/workspace.py`](../apps/api/src/dahaze_api/application/workspace.py), [`infrastructure/db/repositories.py`](../apps/api/src/dahaze_api/infrastructure/db/repositories.py) | CRUD·소프트 삭제·멤버십·역할 |
| GitHub OAuth + 세션 | [`infrastructure/auth/`](../apps/api/src/dahaze_api/infrastructure/auth/) | JWT 쿠키 세션, 서명된 state, MCP Bearer 토큰 |
| LLM 저작 루프 | [`application/authoring.py`](../apps/api/src/dahaze_api/application/authoring.py), [`infrastructure/llm/`](../apps/api/src/dahaze_api/infrastructure/llm/) | 초안 → 컴파일 → 수리 재시도. 저장하지 않음 |
| MCP 서버 | [`interface/mcp/`](../apps/api/src/dahaze_api/interface/mcp/) | `/mcp` Streamable HTTP, 도구 7종 |
| REST 계약 | [`interface/rest/`](../apps/api/src/dahaze_api/interface/rest/) → [`apps/api/openapi.json`](../apps/api/openapi.json) | 25개 오퍼레이션 (`/mcp` 는 OpenAPI 밖) |
| 타입 API 클라이언트 | [`packages/api-client/`](../packages/api-client/) | orval 생성물. 커밋하지 않음 |
| DB 마이그레이션 | [`apps/api/alembic/versions/`](../apps/api/alembic/versions/) | 초기 스키마 1개 |
| 검사 하네스 | [`scripts/`](../scripts/) | §5 |

테스트는 2026-08-17 로컬(Linux x86_64, rspdl 0.1.0, Postgres 17)에서 `uv run pytest -q` 로 실제
실행해 **87개 전부 통과**했다.

| 파일 | 개수 | 무엇을 고정하는가 |
|---|---|---|
| [`tests/test_mcp.py`](../apps/api/tests/test_mcp.py) | 34 | MCP 인증(audience 교차 거부), 도구별 접근 격리, JSON-RPC 왕복 |
| [`tests/test_workspace_api.py`](../apps/api/tests/test_workspace_api.py) | 23 | 접근 격리, 역할, 리비전 규칙, 경로 검증 |
| [`tests/test_authoring_api.py`](../apps/api/tests/test_authoring_api.py) | 10 | 수리 루프, 저장하지 않음, 비멤버 시 LLM 미호출 |
| [`tests/test_rspdl_adapter.py`](../apps/api/tests/test_rspdl_adapter.py) | 8 | 어댑터 계약, 순서 무관성, locale 거부 |
| [`tests/test_config_guard.py`](../apps/api/tests/test_config_guard.py) | 6 | 약한 시크릿·꺼진 secure 쿠키로 뜨지 않음 |
| [`tests/test_analysis_api.py`](../apps/api/tests/test_analysis_api.py) | 6 | HTTP 계약, "진단은 200" |

### 스캐폴딩만 있고 비어 있는 것

디렉터리는 있으나 **파일이 하나도 없다.** git에 추적되는 파일이 없으므로 다른 사람이 clone 하면
디렉터리 자체가 나타나지 않는다.

| 경로 | 문서상 역할 | 실제 |
|---|---|---|
| `apps/web` | Next.js 프론트엔드 | 비어 있음 |
| `packages/ui` | shadcn 공용 컴포넌트 | 비어 있음 |
| `packages/design-system` | 토큰·테마 | 비어 있음 |
| `packages/rspdl-editor` | CodeMirror 6 RSPDL 모드 | 비어 있음 |
| `infra/bootstrap`, `infra/prod` | Terraform (ADR-0004) | 비어 있음 |
| `deploy/nginx`, `deploy/lightsail` | 리버스 프록시·롤아웃 | 비어 있음 |
| `docs/rfcs`, `docs/guides` | ADR-0001이 예고한 문서 갈래 | 비어 있음 |
| `packages/config` | 공유 tsconfig (eslint·tailwind 는 `apps/web` 과 함께) | `tsconfig/base.json` 하나뿐 |

즉 **프론트엔드는 한 줄도 없다.** [`packages/api-client`](../packages/api-client/)가 만드는 훅을
쓰는 소비자가 아직 없다는 뜻이고, [`.agents/skills/manage-ui-package/SKILL.md`](../.agents/skills/manage-ui-package/SKILL.md)의
규칙은 전부 사전 규정이다.

배포도 마찬가지다. [`docs/adr/0004-deployment-infrastructure.md`](adr/0004-deployment-infrastructure.md)가
Lightsail·Terraform·시크릿 흐름을 정했지만 구현물은 없고, GitHub Actions에는
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 하나만 있다 — 배포 워크플로우가 없다.
로컬 Postgres용 [`deploy/docker-compose.dev.yml`](../deploy/docker-compose.dev.yml)만 존재한다.

### MCP 와 LLM 저작에서 알아둘 것

[ADR-0005](adr/0005-mcp-and-llm-authoring.md) 가 결정을 담고 있다. 코드에서 놓치기 쉬운 지점만 짚는다.

- **`/mcp` 는 `openapi.json` 에 없다.** 평범한 Starlette 라우트라 FastAPI 스키마 밖이고 프론트 훅도
  생기지 않는다. MCP 계약은 도구 설명이 전부이며, 그 설명이 LLM 에게는 유일한 인터페이스다.
- **`app.mount()` 로 붙이면 안 된다.** Starlette 은 mount 된 앱에 lifespan 을 전달하지 않는데, MCP
  세션 매니저는 lifespan 이 띄우는 task group 없이는 모든 요청을 거부한다(`Task group is not
  initialized`). `mount_mcp` 가 lifespan 을 상위 앱에 이어 붙이고 `/mcp` 를 리다이렉트 없이 등록한다.
  두 번 부르면 앞 라우트를 **갈아 끼운다** — append 하면 같은 경로가 둘이 되고 먼저 등록된 쪽이
  모든 요청을 가져가서, 나중 호출이 무시된 것을 알아채기 어렵다.
- **MCP 토큰은 폐기할 수 없다.** 세션과 같은 비밀로 서명하되 audience(`dahaze:mcp`)와 TTL(90일)만
  다르다. 토큰 id 테이블이 없어 blocklist 를 만들 수 없다. ADR-0005 가 인정한 한계다.
- **저작 엔드포인트는 문서를 쓰지 않는다.** 초안과 진단만 돌려준다. 저장은 사람이
  `PUT /api/documents/{id}` 로 한다.
- **진단을 severity 로 거르지 않는다.** 경고를 무시해도 된다고 판단하는 순간 dahaze 가 컴파일러를
  재해석하는 것이 된다.
- **LLM 프롬프트는 rspdl 버전과 함께 늙는다.** [`infrastructure/llm/prompts/`](../apps/api/src/dahaze_api/infrastructure/llm/prompts/)
  에 모아 두었다. 재컴파일 리포트로는 이 회귀가 드러나지 않는다 — 코퍼스는 이미 있는 문서만 보고
  앞으로 생성될 텍스트는 보지 않는다. 승격 절차에 점검 단계가 있다.

---

## 3. 아키텍처 한눈에

```
브라우저 (apps/web — 아직 없음)
   │  TanStack Query 훅 (생성물)
   ▼
packages/api-client/src/fetcher.ts        credentials: 'include'
   │  HTTPS, 상위 도메인 세션 쿠키
   ▼
┌─ apps/api (FastAPI) ─────────────────────────────────────────────┐
│                                                                  │
│  interface/rest/*.py        라우터. 유스케이스 오류 → HTTP 상태   │
│  interface/rest/dependencies.py  구체 어댑터를 고르는 유일한 지점 │
│         │                                                        │
│         ▼                                                        │
│  application/*.py           유스케이스. 접근 검사가 여기 모인다   │
│         │  port 만 본다                                          │
│         ▼                                                        │
│  domain/ports.py            Protocol. 프레임워크를 모른다         │
│         ▲                                                        │
│         │ 구현                                                   │
│  infrastructure/                                                 │
│    rspdl/local_adapter.py ──► import rspdl ──► rspdl/_native.so  │
│    db/repositories.py     ──┐                  (Z3 정적 링크)     │
│    db/analysis_cache.py   ──┤                                    │
│    auth/github.py         ──┤                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              ▼
                        Postgres 17 (pgvector 이미지)
                        users · user_identities · projects ·
                        project_members · documents ·
                        document_revisions · compilations
```

요청 하나의 경로는 이렇다. 라우터가 쿠키에서 사용자를 복원하고
([`get_current_user`](../apps/api/src/dahaze_api/interface/rest/dependencies.py)), 유스케이스를
`Annotated[..., Depends(...)]` 로 주입받는다. 유스케이스는 port만 보므로 어떤 어댑터가 붙었는지
모른다. 분석 요청이면 `AnalyzeWorkspace` 가 먼저 `compilations` 캐시를 조회하고, 없으면
`LocalRspdlCompiler` 가 `asyncio.to_thread` 로 동기 SDK를 호출한 뒤 응답의 `result` 를 **손대지
않고** 감싸서 캐시에 넣는다. 워크스페이스 요청이면 `WorkspaceService` 가
`_require_membership` 으로 접근을 확인한 뒤 저장소를 부른다. 계약은 라우터에서만 나온다 —
`interface/rest/**` → `apps/api/openapi.json` → `packages/api-client/src/generated/**` 가 단방향
이고, CI가 각 화살표를 검사한다.

---

## 4. 바꾸기 전에 알아야 할 제약

한 번쯤 부딪히기 전에는 보이지 않는 것들이다. 각 항목의 "왜"는 링크된 문서에 있다.

| 제약 | 무엇이 걸리는가 | 근거 |
|---|---|---|
| **x86_64 + glibc 고정** | Linux arm64에서는 `uv sync` 자체가 실패한다 | [ADR-0002](adr/0002-rspdl-compiler-integration.md) |
| **프로세스당 rspdl 한 버전** | 멀티버전 = 멀티프로세스 | [ADR-0002](adr/0002-rspdl-compiler-integration.md) |
| **SDK는 동기** | async에서 직접 부르면 루프가 멈춘다 | [`local_adapter.py`](../apps/api/src/dahaze_api/infrastructure/rspdl/local_adapter.py) |
| **`result` 는 절대 재작성 금지** | 정렬·개명·평탄화 전부 | [ADR-0003](adr/0003-document-storage-model.md) |
| **컴파일 결과를 테이블로 정규화 금지** | JSONB 한 칸에만 | [ADR-0003](adr/0003-document-storage-model.md) |
| **접근 검사는 단일 진입점** | 소유자 전용 경로를 만들지 않는다 | [`workspace.py`](../apps/api/src/dahaze_api/application/workspace.py) |
| **로컬 DB 호스트 포트는 55432** | 5432가 아니다 | [`docker-compose.dev.yml`](../deploy/docker-compose.dev.yml) |

### 4.1 arm64는 "느리다"가 아니라 "불가능하다"

RSPDL은 네이티브 확장이고 PyPI에 wheel 넷만 올린다 — macOS arm64/x86_64, manylinux x86_64,
win_amd64. **linux aarch64 wheel이 없고 sdist도 없다.** sdist가 없다는 것이 결정적이다: 소스
빌드로 fallback 할 대상 자체가 없으므로 설치가 그냥 실패한다. musl(Alpine)도 manylinux wheel을
받지 못해 같은 결과다.

실무적 귀결:

- AWS Graviton/t4g 인스턴스, arm64 GitHub 러너, Alpine 베이스 이미지 — 셋 다 쓸 수 없다.
- Apple Silicon 맥에서 **로컬 개발은 된다.** macOS arm64 wheel이 있기 때문이다. 그래서 "내 맥에서는
  되는데 배포가 안 되는" 형태로 겪게 된다.
- 이 제약이 사라졌는지는 rspdl 버전을 올릴 때마다 확인한다
  ([`.agents/skills/upgrade-rspdl/SKILL.md`](../.agents/skills/upgrade-rspdl/SKILL.md) 2단계).

### 4.2 한 프로세스는 rspdl 버전을 하나만 가진다

배포 이름·import 이름·네이티브 모듈 이름이 모두 `rspdl` 하나이고, `__version__` 이 설치
메타데이터를 읽는다. `sys.path` 트릭으로 우회해도 버전 보고가 거짓이 된다. 따라서 **"여러 버전
동시 지원"은 예외 없이 "여러 프로세스"를 뜻한다.**

이것이 코드 곳곳에 남긴 흔적:

- [`get_compiler()`](../apps/api/src/dahaze_api/interface/rest/dependencies.py) 는 `@lru_cache` 로
  프로세스당 하나만 만든다.
- [`scripts/rspdl_recompile_report.py`](../scripts/rspdl_recompile_report.py) 가 버전 비교를
  `uv run --no-project --with rspdl==<버전>` 서브프로세스 두 개로 하는 이유도 이것이다.
  [`scripts/rspdl_compile_worker.py`](../scripts/rspdl_compile_worker.py) 가 그 워커다.
- 그래서 "버전 라우팅"을 어댑터 안에서 해결하려는 시도는 반드시 실패한다. 전환 신호와 바꿀
  파일 목록은 [ADR-0002](adr/0002-rspdl-compiler-integration.md)와 upgrade-rspdl 스킬에 있다.

### 4.3 SDK가 동기라서 스레드로 넘긴다

`rspdl.compile` · `check` · `find_model` 은 전부 동기 함수다. 코루틴에서 직접 부르면 컴파일이
끝날 때까지 이벤트 루프 전체가 멈춘다 — 한 사용자의 무거운 컴파일이 다른 모든 요청을 세운다.
네이티브 구간이 GIL을 놓으므로 `asyncio.to_thread` 로 넘기면 실제 병렬성이 나온다. **어댑터에
호출을 추가할 때 `to_thread` 를 빠뜨리면 테스트는 통과하고 운영에서만 드러난다.**

관련 기본값도 어댑터에 있다: `DEFAULT_TIMEOUT_MS = 5000`, `DEFAULT_SCOPE_PER_MODEL = 3`.
RSPDL은 timeout을 성공으로 근사하지 않고 `unknown` 으로 남기므로, 이 값을 넘겨도 실패가 아니라
"모른다"는 결과가 돌아온다.

### 4.4 `result` 는 통과시키기만 한다

컴파일러 응답의 `result` 는 SDK가 준 그대로 도메인 → 캐시 → JSONB → HTTP 응답까지 흐른다.
[`AnalysisOutcome`](../apps/api/src/dahaze_api/domain/rspdl.py) 이 그것을 `Mapping[str, Any]` 로만
들고 있고, [`AnalysisResponse.result`](../apps/api/src/dahaze_api/interface/rest/schemas.py) 도
`dict[str, Any]` 다.

이유는 두 겹이다. 결정론이 RSPDL의 계약인데 중간에서 필드를 정렬하거나 이름을 바꾸면 그 계약이
깨진다. 그리고 IR의 모양은 컴파일러가 소유하고 `wire_schema_version` 으로 버전이 매겨지므로,
우리가 다시 타이핑하면 rspdl을 올릴 때마다 그 타입을 따라가야 한다.

대신 [`_wrap`](../apps/api/src/dahaze_api/infrastructure/rspdl/local_adapter.py) 이 응답의
`schema_version` 을 확인하고 다르면 **예외를 던진다.** 모르는 스키마를 조용히 통과시켜 잘못
해석한 결과를 저장하는 것보다 멈추는 편이 낫다는 판단이다.

부작용으로 알아야 할 것: `result` 안의 변화는 **타입 시스템이 잡아주지 않는다.** 프론트까지
따라가며 눈으로 확인해야 한다.

### 4.5 컴파일 결과는 DB 테이블이 되지 않는다

`compilations` 테이블은 `(cache_key, kind, rspdl_version, wire_schema_version, locale, result)`
뿐이고 `result` 는 불투명한 JSONB다. 진단을 `rule_id` · `severity` · `span` 컬럼으로 쪼개고 싶은
유혹이 크지만 하지 않는다 — IR과 진단 스키마가 `0.x` 동안 바뀌고, 테이블로 굳히면 **rspdl을 올릴
때마다 DB 마이그레이션이 따라붙기** 때문이다.

원칙은 [ADR-0003](adr/0003-document-storage-model.md)의 한 줄로 요약된다: **재생성할 수 없는 것만
정규화한다.** 사용자가 친 텍스트·저자·소속 관계는 정규화하고, 컴파일러가 뱉은 것은 전부
캐시다. `compilations` 는 언제든 `TRUNCATE` 해도 데이터 손실이 아니다.

캐시 무효화 로직을 찾지 말 것. **없다.** 캐시 키가
[`workspace_hash`](../apps/api/src/dahaze_api/domain/rspdl.py) 로 계산되고 그 안에
`rspdl_version` · `wire_schema_version` · `locale` · `kind` 가 들어 있어, 버전을 올리면 키가
통째로 달라지며 자연히 무효가 된다. 키에는 `find_model` 의 `scope_per_model` · `timeout_ms`,
`check` 의 `data` 도 들어간다 — 같은 소스라도 scope가 다르면 SAT / UNSAT_WITHIN_BOUND 가 갈리기
때문이다.

### 4.6 접근 검사는 멤버십 조회 하나로 모인다

프로젝트 소유자도 `project_members` 에 `owner` 역할 행으로 들어간다. `projects.owner_id` 컬럼이
없는 것은 누락이 아니라 결정이다: 접근 검사가 "소유자거나 멤버"로 갈라지면 그 분기가 모든
질의에 퍼지고 그중 하나는 반드시 빠진다.

구체적으로 지켜지는 형태:

- 라우터는 저장소를 직접 부르지 않는다. 전부 `WorkspaceService` 를 지난다.
- 모든 검사가
  [`WorkspaceService._require_membership`](../apps/api/src/dahaze_api/application/workspace.py)
  하나로 수렴한다. `ProjectRepositoryPort.membership_of` 가 그 유일한 질의다.
- 멤버가 아니면 `AccessDenied`(403)가 아니라 **`NotFound`(404)** 를 낸다. 남의 프로젝트가 존재한다는
  사실 자체를 노출하지 않기 위해서다. 403은 "대상은 보이지만 이 동작은 안 된다"일 때만 쓴다
  (예: viewer의 쓰기, 비소유자의 멤버 추가).
- 같은 이유로 MCP 도구도 저장소가 아니라 `application/` 의 유스케이스를 부르도록 정해져 있다
  ([ADR-0005](adr/0005-mcp-and-llm-authoring.md)).

새 엔드포인트를 추가할 때 저장소를 직접 부르면 이 수렴이 깨진다. **CI는 이걸 잡지 못한다** —
계층 규칙 위반이 아니기 때문이다. 리뷰에서만 잡힌다.

### 4.7 로컬 Postgres 호스트 포트는 55432다

[`deploy/docker-compose.dev.yml`](../deploy/docker-compose.dev.yml) 은
`127.0.0.1:${DAHAZE_DB_PORT:-55432}:5432` 로 바인딩한다. Windows/WSL이 5432를 예약 포트 범위에
넣어 두는 경우가 있어 바인딩이 거부되기 때문이다. 그래서:

- 앱 기본값도 `postgresql://dahaze:dahaze@localhost:55432/dahaze` 다
  ([`config.py`](../apps/api/src/dahaze_api/config.py), [`.env.example`](../apps/api/.env.example)).
- **CI는 5432를 쓴다.** 러너에서는 예약 문제가 없어 [`ci.yml`](../.github/workflows/ci.yml) 이
  `DATABASE_URL` · `TEST_DATABASE_URL` 을 5432로 덮어쓴다. 이 두 값이 로컬과 CI에서 다르다는
  사실을 모르면 "CI에서만 되는" 혼란이 생긴다.
- 포트를 바꾸려면 `DAHAZE_DB_PORT` 환경변수를 쓴다. compose 파일을 고치지 않는다.

### 4.8 그 밖에 놀랄 만한 것들

- **테스트는 실제 Postgres에 붙는다.** SQLite로 대체하지 않는다 — JSONB, 부분 유니크 인덱스,
  `ON CONFLICT DO NOTHING` 이 전부 방언에 의존한다. 컨테이너가 떠 있지 않으면 테스트가 아니라
  **연결 에러**로 실패한다.
- **테스트 DB는 매 세션 DROP 후 CREATE 된다.** `TEST_DATABASE_URL`(기본
  `.../dahaze_test`)이 가리키는 DB가 통째로 지워진다
  ([`apps/api/tests/conftest.py`](../apps/api/tests/conftest.py)). 개발 DB를 여기에 지정하면 안 된다.
- **테스트 스키마는 마이그레이션이 아니라 `Base.metadata.create_all` 로 만든다.** 그래서
  마이그레이션을 빠뜨려도 테스트는 전부 통과한다. 그 틈은 별도 게이트가 막는다(§5).
- **`./scripts/check.sh` 는 로컬 개발 DB에 마이그레이션을 적용한다.** `check_migrations.sh` 가
  `TEST_DATABASE_URL` 이 아니라 `DATABASE_URL` 을 대상으로 `alembic upgrade head` 를 돌린다.
- **비동기 SQLAlchemy에서 벌크 UPDATE를 피하는 곳이 있다.**
  [`soft_delete`](../apps/api/src/dahaze_api/infrastructure/db/repositories.py) 의 주석이 이유를
  설명한다 — 세션에 이미 로드된 객체와 in-memory 상태가 어긋나면 뒤이은 속성 접근이 동기 lazy
  IO를 일으켜 `MissingGreenlet` 으로 터진다.
- **`statement_cache_size=0`.** 트랜잭션 풀러 뒤에서 prepared statement 캐시가 깨지는 것을 막는
  설정이다 ([`db/session.py`](../apps/api/src/dahaze_api/infrastructure/db/session.py)). 풀러를 쓰지
  않아도 안전하다.
- **자격증명 없는 OAuth 제공자는 아예 등록되지 않는다.**
  [`registry.py`](../apps/api/src/dahaze_api/infrastructure/auth/registry.py) 가 그렇게 만든다.
  `GITHUB_CLIENT_ID` 를 안 넣으면 `/api/auth/providers` 가 빈 목록을 주고 로그인 경로는 404다 —
  버그가 아니다.
- **본문이 같으면 리비전을 만들지 않는다.** 에디터 자동 저장이 이력을 무의미한 항목으로 채우지
  않게 하기 위한 것이고, 테스트가 이를 고정한다.
- **문서 경로 정규식은 의도적으로 빡빡하다.**
  `DOCUMENT_PATH_PATTERN` 이 `..` 과 선행 `/` 를 막는다. 지금은 경로를 파일시스템에 쓰지 않지만
  export나 git 연동이 생기면 그대로 traversal이 되기 때문이다.
- **세션 TTL이 두 곳에 있다.** `SESSION_TTL = timedelta(days=14)`
  ([`auth/session.py`](../apps/api/src/dahaze_api/infrastructure/auth/session.py))와
  `max_age=14 * 24 * 3600` ([`rest/auth.py`](../apps/api/src/dahaze_api/interface/rest/auth.py)).
  하나만 고치면 쿠키와 토큰의 수명이 어긋난다.
- **로컬 개발 이미지가 `pgvector/pgvector:pg17` 인 이유.** 지금 벡터 검색을 쓰지 않지만, 나중에
  LLM 임베딩이 필요해질 때 이미지를 바꾸면 로컬과 프로덕션이 갈라지므로 처음부터 맞춰 뒀다.

---

## 5. 기계적으로 강제되는 규칙

전부 [`./scripts/check.sh`](../scripts/check.sh) 하나로 돈다. 이것과
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 은 **같은 게이트여야 한다** — 게이트를
추가할 때는 반드시 양쪽에 함께 추가한다(두 파일 모두 이 규칙을 머리말에 적어 두었다).

| # | 규칙 | 강제하는 것 | 실패하면 |
|---|---|---|---|
| 1 | RSPDL 설치 가능한 플랫폼인가 | [`scripts/check_platform.sh`](../scripts/check_platform.sh) | `✗ RSPDL 을 설치할 수 없는 플랫폼: Linux/aarch64` + exit 1 |
| 2 | 헥사고날 계층·서드파티 격리 | [`scripts/check_boundaries.py`](../scripts/check_boundaries.py) | `경계 위반 N건:` 과 `파일:줄: 메시지` 목록 |
| 3 | 린트 | `uv run ruff check .` | ruff 규칙 코드 |
| 4 | 타입 | `uv run mypy` (`strict = true`, 대상 `src`·`tests`·`scripts`) | mypy 오류 |
| 5 | 마이그레이션 ↔ 모델 일치 | [`scripts/check_migrations.sh`](../scripts/check_migrations.sh) | `모델에 마이그레이션으로 반영되지 않은 변경이 있다.` |
| 6 | 테스트 | `uv run pytest -q` | 통상 pytest 출력 |
| 7 | OpenAPI 드리프트 | [`scripts/check_openapi_drift.sh`](../scripts/check_openapi_drift.sh) | `openapi.json 이 라우터와 어긋난다.` + diff 60줄 |
| 8 | 프론트 codegen + 타입 | `pnpm codegen && pnpm typecheck` | orval / tsc 오류 |

CI에만 있고 `check.sh` 에는 없는 것이 셋 있다.

| CI 단계 | 하는 일 |
|---|---|
| `uv sync --extra dev --locked` | `uv.lock` 이 `pyproject.toml` 과 어긋나면 실패 |
| 컴파일러 로드 확인 | `import rspdl` 이 실제로 열리는지. 플랫폼 불일치가 여기서 드러난다 |
| `git diff --exit-code` (web 잡) | `src/generated/**` 를 실수로 커밋했는지 검사 |

### 5.1 경계 검사가 실제로 막는 네 가지

[`scripts/check_boundaries.py`](../scripts/check_boundaries.py) 는 AST를 읽어 검사한다.

1. `import rspdl` → `infrastructure/rspdl/` 안에서만
2. `import openai` → `infrastructure/llm/` 안에서만
3. `domain/` 은 다른 계층도, `fastapi` · `sqlalchemy` · `alembic` · `httpx` · `pydantic` · `mcp` ·
   `starlette` 도 import 하지 않는다
4. `application/` 은 `infrastructure/` · `interface/` 를 import 하지 않는다

검사기는 세 가지 import 형태를 모두 본다.

| 형태 | 처리 |
|---|---|
| `from dahaze_api.infrastructure.db import models` | 절대 경로 그대로 |
| `import dahaze_api.infrastructure.db.models` | 최상위 이름과 **점 표기 전체**를 함께 낸다 |
| `from ..infrastructure.rspdl import X` | 파일의 패키지 기준으로 절대 경로로 **해석한 뒤** 검사 |

뒤의 두 형태는 한때 규칙을 우회하는 통로였다. 최상위 이름만 추출하면
`import dahaze_api.infrastructure.db.models` 가 `dahaze_api` 로만 보이고, 상대 import 는
"같은 패키지 안" 이라는 잘못된 가정으로 아예 건너뛰었다. 둘 다 막았고, 세 형태를 한 파일에
넣어 실제로 잡히는지 확인했다.

남은 사각지대: 검사기는 **import 만** 본다. `importlib.import_module()` 같은 동적 import 나,
경계를 우회하는 런타임 조회는 잡지 못한다.

### 5.2 OpenAPI 계약 흐름

```
interface/rest/**  →  apps/api/openapi.json  →  packages/api-client/src/generated/**
```

- `openapi.json` 은 **커밋한다.** `pnpm --filter api openapi` 로 생성한다.
- `packages/api-client/src/generated/**` 는 **커밋하지 않는다.** `.gitignore` 대상이고 빌드 때
  생성된다.
- 라우트에는 반드시 `name=` 을 명시한다. `main.py` 의 `generate_unique_id_function` 이 그것을
  `operationId` 로 쓰고, `operationId` 가 그대로 프론트 훅 이름이 된다
  (`compile_workspace` → `useCompileWorkspace`). 빠뜨리면
  `compile_workspace_api_analysis_compile_post` 같은 이름이 훅 이름이 되고, 나중에 고치면 프론트
  import가 전부 깨진다.
- 절차 전문은 [`.agents/skills/generate-api/SKILL.md`](../.agents/skills/generate-api/SKILL.md).

### 5.3 문서로만 있고 기계가 검사하지 않는 규칙

이것들은 **리뷰에서만 잡힌다.**

- 서버 상태는 TanStack Query가 소유하고 zustand에 복사하지 않는다 ([ADR-0001](adr/0001-monorepo-structure-and-stack.md))
- `packages/ui` 는 `@dahaze/api-client` 를 import 하지 않는다 ([manage-ui-package](../.agents/skills/manage-ui-package/SKILL.md))
- `packages/ui` 는 색·간격을 하드코딩하지 않는다
- RSPDL 진단을 색으로만 구분하지 않는다 (아이콘·텍스트도 함께)
- 라우터가 저장소를 직접 부르지 않는다 (§4.6)
- 진단을 HTTP 오류로 바꾸지 않는다 — 테스트가 일부만 고정한다
- Conventional Commits, `develop` 기준 브랜치 ([CONTRIBUTING.md](../CONTRIBUTING.md))

---

## 6. 의도적으로 하지 않은 것

| 하지 않은 것 | 이유 | 언제 다시 볼까 |
|---|---|---|
| 멀티버전 rspdl 지원 | 지원할 버전이 아직 하나뿐이다. 없는 두 번째 버전을 위해 지금 분산 시스템을 만들지 않는다 | 동시에 지원해야 할 버전이 둘이 되는 순간 ([ADR-0002](adr/0002-rspdl-compiler-integration.md)) |
| IR 기반 SQL 질의 (`조건이 빈 정책 찾기` 등) | IR을 테이블로 굳히면 rspdl 버전업마다 마이그레이션이 붙는다 | 필요해지면 **재생성 가능한** 프로젝션 테이블로 ([ADR-0003](adr/0003-document-storage-model.md)) |
| 진단 정규화 테이블 | 같은 이유. 목록·필터는 JSONB 인덱스로 | 위와 동일 |
| 캐시 무효화 로직 | 키에 `rspdl_version` 이 있어 자동 무효 | 필요 없음 |
| 계정 병합 | 같은 사람이 GitHub과 Google로 로그인하면 별도 사용자가 된다 — [`ports.py`](../apps/api/src/dahaze_api/domain/ports.py)에 명시 | 두 번째 제공자를 붙일 때 |
| 리비전 본문 조회 엔드포인트 | 목록은 본문을 싣지 않는다. 개별 조회는 "별도 조회 대상"으로 남겨 뒀다 | 되돌리기/diff UI를 만들 때 |
| MCP 토큰 폐기 | 토큰 저장소가 없어 개별 폐기가 불가능하다. TTL로만 제한한다 | 폐기 요구가 생기면 토큰 ID 테이블 + blocklist ([ADR-0005](adr/0005-mcp-and-llm-authoring.md)) |
| MCP OAuth 2.1 전체 흐름 | 1차는 Bearer 토큰. audience를 세션과 분리(`dahaze:mcp`)해 하나가 새도 다른 쪽에 못 쓰게 한다 | 위와 동일 |
| LLM 초안 자동 저장 | 저장은 되돌릴 수 없는 리비전을 만든다. LLM이 조용히 덮어쓰면 사용자가 이력을 추적할 수 없다 | 하지 않는다 (결정) |
| 인메모리 캐시 배선 | [`InMemoryAnalysisCache`](../apps/api/src/dahaze_api/infrastructure/cache.py) 는 존재하지만 dependencies가 `SqlAnalysisCache` 만 주입한다 | 필요가 확인되면 |
| 프론트엔드 전체 | §2 — 아직 파일이 없다 | 다음 큰 작업 |
| 배포 파이프라인·Terraform | [ADR-0004](adr/0004-deployment-infrastructure.md)가 설계만 해 뒀다 | 프론트 이후 |

명시적 `TODO(` 마커는 커밋된 코드에 하나도 없다. 미완은 전부 위 표처럼 문서에 적혀 있다.

### 6.1 스킬이 스스로 밝힌 한계

- **`fixtures/corpus/` 만으로 rspdl 승격을 검증하지 않는다.** 대표 예제 둘
  ([`inventory.rspdl`](../fixtures/corpus/inventory.rspdl),
  [`broken.rspdl`](../fixtures/corpus/broken.rspdl))일 뿐 실사용 문법의 일부만 덮는다. 승격 전에는
  DB에서 실제 문서를 내보내 `--corpus` 로 넘겨야 한다. **그 내보내기 스크립트는 아직 없다** —
  스킬이 "스크립트를 돌린 뒤"라고만 적어 두었다.
- **재컴파일 리포트는 LLM 프롬프트 회귀를 잡지 못한다.** 코퍼스는 이미 존재하는 문서만 검사하고
  앞으로 생성될 텍스트는 검사하지 않는다. 프롬프트 점검은 별도 단계다.
- **사라진 진단을 개선으로 단정하지 않는다.** 검증이 조용히 약해진 것일 수도 있다.

---

## 7. 다음 세션에서 이어가려면

### 7.1 환경

```console
./scripts/check_platform.sh                              # 여기서 막히면 그 환경으로는 아무것도 못 한다

pnpm install
cd apps/api && uv sync --extra dev && cp .env.example .env && cd -

docker compose -f deploy/docker-compose.dev.yml up -d    # Postgres 17, 호스트 포트 55432
cd apps/api && uv run alembic upgrade head && cd -

pnpm codegen                                             # openapi.json → API 클라이언트
```

필요한 것: Node.js 22+ / `pnpm`, Python 3.12+ / [`uv`](https://docs.astral.sh/uv/), Docker.

GitHub OAuth를 쓰려면 로컬 OAuth App을 만들어 `apps/api/.env` 에 `GITHUB_CLIENT_ID` ·
`GITHUB_CLIENT_SECRET` 을 넣는다. 콜백은 `OAUTH_REDIRECT_URI` 와 정확히 같아야 한다. 없으면
로그인 경로 전체가 404이며, 테스트는 `get_current_user` 를 override 하므로 영향받지 않는다.

`pnpm dev` 는 현재 API 하나만 띄운다(`uvicorn ... --port 8400`). 프론트가 없기 때문이다.

### 7.2 하네스

```console
./scripts/check.sh          # 전부. 제출 전 필수
```

부분만 돌리려면:

```console
python3 scripts/check_boundaries.py                 # 의존성 설치 없이 30초
cd apps/api && uv run pytest -q                     # Postgres 컨테이너가 떠 있어야 한다
./scripts/check_openapi_drift.sh                    # 라우터를 고쳤다면
```

### 7.3 무엇을 바꾸느냐에 따라 먼저 읽을 것

| 바꾸는 것 | 읽을 것 |
|---|---|
| 아무 변경이나 시작 | [`.agents/skills/develop-from-issue/SKILL.md`](../.agents/skills/develop-from-issue/SKILL.md) |
| REST 엔드포인트 | [`.agents/skills/generate-api/SKILL.md`](../.agents/skills/generate-api/SKILL.md) |
| 공용 컴포넌트·디자인 토큰 | [`.agents/skills/manage-ui-package/SKILL.md`](../.agents/skills/manage-ui-package/SKILL.md) |
| rspdl 버전 승격 | [`.agents/skills/upgrade-rspdl/SKILL.md`](../.agents/skills/upgrade-rspdl/SKILL.md) |
| 저장 모델·스키마 | [ADR-0003](adr/0003-document-storage-model.md) → [`db/models.py`](../apps/api/src/dahaze_api/infrastructure/db/models.py) |
| 컴파일러 통합 | [ADR-0002](adr/0002-rspdl-compiler-integration.md) → [`local_adapter.py`](../apps/api/src/dahaze_api/infrastructure/rspdl/local_adapter.py) |
| 배포·인프라 | [ADR-0004](adr/0004-deployment-infrastructure.md) |
| MCP·LLM 저작 | [ADR-0005](adr/0005-mcp-and-llm-authoring.md) |

아키텍처를 바꾸려면 해당 ADR을 먼저 읽고, 바꾼다면 ADR도 함께 갱신한다.

### 7.4 남아 있는 계획된 작업

크기 순이 아니라 의존 순이다.

1. **MCP + LLM 저작 루프** — [ADR-0005](adr/0005-mcp-and-llm-authoring.md)가 설계를 끝냈고 구현이
   진행 중이다(§2). 제품 전제가 "주로 MCP로 쓴다"이므로 이것 없이는 제품이 성립하지 않는다.
2. **프론트엔드** — `apps/web` · `packages/ui` · `packages/design-system` ·
   `packages/rspdl-editor` 넷 다 비어 있다. 백엔드 계약은 이미 준비되어 있으므로
   `pnpm codegen` 결과를 소비하는 것부터 시작한다.
3. **배포** — Terraform(`infra/`), 프로덕션 compose와 nginx(`deploy/`), 배포 워크플로우.
   [ADR-0004](adr/0004-deployment-infrastructure.md)에 아키텍처 가드·시크릿 흐름·컨테이너 하드닝
   요구가 이미 적혀 있다.
4. **rspdl 0.2.0 승격 준비** — DB의 `documents.text` 를 `.rspdl` 파일로 내보내는 스크립트가 없다
   (§6.1). 승격이 필요해지기 전에 만들어 두는 편이 낫다.

---

## 부록: 감사에서 나온 것들 (2026-08-17)

이 문서를 쓰는 과정에서 문서와 코드가 어긋난 지점 여덟 곳이 나왔고, 일곱은 그 자리에서
고쳤다. 무엇이 어떻게 새는지 기록해 둔다 — 같은 종류가 다시 생기기 때문이다.

| 어긋났던 곳 | 무엇이 문제였나 | 어떻게 고쳤나 |
|---|---|---|
| `packages/api-client/src/index.ts` | 생성된 `auth` · `workspace` 엔드포인트가 re-export 되지 않아 프론트가 `useListProjects` 를 import 할 수 없었다. **생성되는 모듈을 손으로 열거하는 barrel** 이 원인 | `scripts/write-barrel.mjs` 가 codegen 단계에서 barrel 을 만든다. 사람이 열거하지 않는다 |
| `ci.yml` web 잡 | `pnpm lint` 가 `apps/api` 의 `uv run ruff check .` 를 끌어오는데 그 잡에는 uv 가 없다 | `turbo lint --filter='!api'`. `check.sh` 도 같은 필터를 쓴다 |
| `check.sh` ↔ CI | 둘 다 "같은 게이트" 라고 적어 두었으나 실제로는 달랐다 | 프론트 린트·빌드를 `check.sh` 에 추가하고, **CI 에만 있는 것**(`--locked` 설치, 컴파일러 로드 스모크, 생성물 커밋 검사)을 헤더에 명시 |
| `check_boundaries.py` | 점 표기 plain import 와 상대 import 로 계층 규칙을 우회할 수 있었다 | 둘 다 막고 실험으로 확인 (§5.1) |
| `README.md` | ADR-0005 링크 누락 | 추가 |
| `CONTRIBUTING.md` | 없는 테스트 디렉터리 세 개를 안내 | 실제 평평한 배치와 그 이유로 교체 |
| `packages/config` | "eslint · tsconfig · tailwind" 라고 했으나 tsconfig 뿐 | 설명을 실제에 맞추고, 나머지는 `apps/web` 과 함께 온다고 명시 |
| `ci.yml` 의 `pnpm build` | `build` 스크립트를 정의한 패키지가 없어 사실상 무작동 | **고치지 않았다.** `apps/web` 이 들어오면 자연히 실체가 생긴다 |

여기서 되풀이되는 원인은 하나다: **생성되는 것과 손으로 쓰는 것의 경계에서 샌다.** barrel,
CI 잡과 로컬 하네스, 문서와 디렉터리 구조가 전부 그 경계였다. 새 게이트를 만들 때는
"이 목록을 사람이 유지해야 하는가" 를 먼저 물을 것.
