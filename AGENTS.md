# dahaze Agent Context

## Mission

- 기획자가 RSPDL로 제품 의도를 쓰고, 구현 전에 데이터 lifecycle과 정책 정합성 문제를 발견하게 한다.
- 문법 파일을 사람이 직접 쓸 수도 있지만, 주로 **MCP와 LLM API를 통해** 쓰이도록 만든다.
- 컴파일러가 유일한 해석자다. dahaze는 그 결과를 저장·전달·표시할 뿐 재해석하지 않는다.

## 제품 경계

- RSPDL 문법과 의미는 [`rspdl-core`](https://github.com/rspdl/rspdl-core)가 소유한다.
  dahaze에서 문법을 해석하거나 진단을 만들어내지 않는다.
- 컴파일러가 산출한 것은 전부 **재생성 가능한 파생물**이다. 사용자가 친 텍스트만 진실이다.
- LLM 출력도 사람 출력과 같은 컴파일러 게이트를 통과한다. 검증 없이 저장하지 않는다.
- 표현되지 않은 의도를 추측하지 않는다. 진단은 컴파일러가 준 그대로 보여준다.

## 반드시 지키는 경계

`scripts/check_boundaries.py` 가 기계적으로 검사한다. 위반은 CI에서 빨개진다.

- `import rspdl` → `apps/api/src/dahaze_api/infrastructure/rspdl/` 안에서만
- `import openai` → `infrastructure/llm/` 안에서만
- `domain/` 은 다른 계층도 프레임워크(fastapi·sqlalchemy·pydantic 등)도 import하지 않는다
- `application/` 은 `infrastructure/`·`interface/` 를 import하지 않는다. port를 통해서만 흐른다

## RSPDL 다루기

- **한 프로세스는 rspdl 버전을 하나만 가진다.** 멀티버전은 곧 멀티프로세스다 (ADR-0002).
- RSPDL SDK 함수는 **동기**다. async 컨텍스트에서 부를 때는 반드시 스레드로 넘긴다.
  직접 부르면 컴파일 시간 내내 이벤트 루프가 멈춘다.
- SDK 응답의 `result` 는 **재작성하지 않는다.** 결정론이 RSPDL의 계약이고, 중간에서 손대면
  깨진다. 필드를 정렬하거나 이름을 바꾸거나 평탄화하지 않는다.
- 문법·의미 오류는 예외가 아니라 `200` 응답 안의 진단이다. HTTP 오류로 바꾸지 않는다.
- 컴파일 결과를 DB 테이블로 정규화하지 않는다. IR 모양은 `0.x` 동안 바뀐다 (ADR-0003).
- 배포 타깃은 **x86_64 + glibc** 고정. RSPDL은 linux arm64 wheel도 sdist도 배포하지 않는다.

## 필수 워크플로우

| 하려는 일 | 먼저 읽을 것 |
|---|---|
| 아무 변경이나 시작 | `.agents/skills/develop-from-issue/SKILL.md` |
| REST 엔드포인트 추가·변경 | `.agents/skills/generate-api/SKILL.md` |
| 공용 컴포넌트·디자인 토큰 | `.agents/skills/manage-ui-package/SKILL.md` |
| rspdl 버전 승격 | `.agents/skills/upgrade-rspdl/SKILL.md` |

결정의 근거는 `docs/adr/` 에 있다. 아키텍처를 바꾸기 전에 해당 ADR을 먼저 읽고, 바꾼다면
ADR도 함께 갱신한다.

## API 계약

FastAPI 라우터가 유일한 원본이다.

```
interface/rest/**  →  apps/api/openapi.json  →  packages/api-client/src/generated/**
```

- `openapi.json` 을 손으로 고치지 않는다
- `packages/api-client` 에 요청 함수를 손으로 쓰지 않는다 — 전부 생성물이다
- 라우트에는 반드시 `name=` 을 명시한다. 그게 프론트 훅 이름이 된다

## 프론트 상태

- 서버 상태는 TanStack Query가 전부 소유한다
- zustand는 서버에 없는 상태에만 쓴다 (에디터 초안, 패널 레이아웃, 필터)
- 서버 응답을 zustand로 복사하지 않는다. 같은 데이터가 두 곳에 있으면 진실이 갈린다

## 검증

제출 전 하네스를 돌린다. CI와 같은 게이트다.

```console
./scripts/check.sh
```

플랫폼 · 아키텍처 경계 · 린트 · 타입 · 테스트 · OpenAPI 드리프트 · codegen을 한 번에 검사한다.
