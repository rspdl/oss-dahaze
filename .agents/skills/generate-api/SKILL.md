---
name: generate-api
description: Add or change a dahaze REST endpoint and regenerate the typed frontend client. Use when adding, renaming, or modifying FastAPI routes, request/response schemas, or when the frontend needs a new API call, or when OpenAPI drift CI fails.
---

# API 엔드포인트 추가·변경

FastAPI 라우터가 API 계약의 **유일한 원본**이다. 프론트가 쓰는 훅은 전부 거기서 파생된다.

```
interface/rest/**  →  apps/api/openapi.json  →  packages/api-client/src/generated/**  →  apps/web
```

이 방향을 거꾸로 가지 않는다. `openapi.json` 을 손으로 고치거나 `api-client` 에 요청 함수를
직접 쓰면 CI가 막는다.

## 절차

### 1. 스키마를 먼저 정의한다

`apps/api/src/dahaze_api/interface/rest/schemas.py` 에 Pydantic 모델을 추가한다.

- 모든 필드에 `Field(description=...)` 을 단다. 이 설명이 그대로 생성된 TS 타입의 주석이 되고,
  프론트 개발자가 읽는 유일한 문서가 된다.
- 컴파일러 결과를 담는 필드는 `dict[str, Any]` 로 둔다. RSPDL IR의 모양은 컴파일러가 소유하고
  `wire_schema_version` 으로 버전이 매겨진다 — 우리가 다시 타이핑하지 않는다 (ADR-0003).

### 2. 라우터에 `name` 을 명시한다

```python
@router.post("/compile", name="compile_workspace")
async def compile_workspace(...) -> AnalysisResponse:
```

`name` 이 곧 `operationId` 이고, `operationId` 가 곧 **프론트 훅 이름**이다
(`compile_workspace` → `useCompileWorkspace`). `main.py` 의 `generate_unique_id_function` 이
이 연결을 만든다.

`name` 을 빠뜨리면 FastAPI 기본값이 `compile_workspace_api_analysis_compile_post` 같은 이름을
만들고, 그게 훅 이름이 된다. 반드시 명시한다.

### 3. 의존성은 port 타입으로 받는다

```python
Analyzer = Annotated[AnalyzeWorkspace, Depends(get_analyzer)]
```

구체 어댑터를 고르는 곳은 `interface/rest/dependencies.py` 하나뿐이다. 라우터 안에서
`LocalRspdlCompiler` 같은 구현체 이름을 부르지 않는다.

### 4. 테스트를 먼저 통과시킨다

`apps/api/tests/test_*_api.py` 에 HTTP 계약 테스트를 추가한다. 최소한 이 셋:

- 정상 응답의 상태 코드와 본문 모양
- 잘못된 입력의 `422`
- **도메인 오류를 HTTP 오류로 바꾸지 않았는지** — RSPDL 진단은 `200` 응답 안에 담겨야 한다.
  이걸 `500` 으로 만들면 에디터가 오류 위치를 표시할 수 없게 된다.

### 5. 계약과 클라이언트를 재생성한다

```console
pnpm --filter api openapi          # openapi.json 갱신
pnpm --filter @dahaze/api-client codegen   # 훅 + zod 생성
```

또는 한 번에:

```console
pnpm codegen
```

### 6. 커밋 대상 확인

| 파일 | 커밋 |
|---|---|
| `apps/api/openapi.json` | **커밋한다** — CI가 이걸 기준으로 드리프트를 검사한다 |
| `packages/api-client/src/generated/**` | **커밋하지 않는다** — `.gitignore` 대상, 빌드 때 생성 |

### 7. 하네스를 돌린다

```console
./scripts/check.sh
```

## 프론트에서 쓰기

```tsx
import { useCompileWorkspace, useGetRspdlRuntime } from '@dahaze/api-client'

const { data: runtime } = useGetRspdlRuntime()
const compile = useCompileWorkspace()

compile.mutate({ data: { sources: [{ path: 'a.rspdl', text }] } })
```

서버 상태는 TanStack Query가 소유한다. **응답을 zustand로 복사하지 않는다** — 같은 데이터가
두 곳에 있으면 어느 쪽이 진실인지 알 수 없게 된다 (ADR-0001).

## CI가 "openapi.json 이 라우터와 어긋난다" 로 실패할 때

라우터는 고쳤는데 `openapi.json` 을 재생성하지 않고 커밋한 것이다.

```console
pnpm --filter api openapi
git add apps/api/openapi.json
```

## 흔한 실수

- **`name` 없이 라우트 추가** → 훅 이름이 지저분해진다. 나중에 고치면 프론트 import가 전부 깨진다.
- **`api-client` 에 헬퍼 함수 추가** → 다음 codegen의 `clean: true` 가 지운다. 필요하면
  `src/fetcher.ts` 나 생성 폴더 밖의 새 파일에 둔다.
- **응답 필드를 프론트 편의에 맞춰 재작성** → RSPDL 결과는 그대로 통과시킨다. 변환이 필요하면
  프론트에서 한다.
