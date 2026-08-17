---
id: frontend-architecture
title: Frontend Architecture
type: adr
status: accepted
version: "1"
summary: Splits the frontend into a themed design system, a domain-free UI package, an RSPDL editor package, and a thin Next.js app, and pins the byte-offset conversion that diagnostics require.
topics:
  - frontend
  - nextjs
  - tailwind
  - shadcn
  - state
related:
  - monorepo-structure-and-stack
  - rspdl-compiler-integration
  - document-storage-model
last_updated: "2026-08-18"
owners:
  - rspdl-maintainers
---

# Frontend Architecture

## 상태

Accepted.

## 진단 span 은 UTF-8 바이트 오프셋이다

이것부터 적는다. 틀리면 제품의 핵심 기능이 조용히 잘못 동작하기 때문이다.

RSPDL 진단의 `span: {start, end}` 는 **UTF-8 바이트 오프셋**이고 `end` 는 배타적이다.
확인한 결과는 다음과 같다.

```
소스: "@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다\n"
      문자 48개 / UTF-8 90바이트
진단: RSPDL-KO-SYN-004, span 27..89

문자 오프셋으로 자르면:   'em)은 다음 필드들로 구성되어 있다\n'          ← 어긋난다
바이트 오프셋으로 자르면: '재고 항목(item)은 다음 필드들로 구성되어 있다'  ← 맞는다
```

CodeMirror 6 을 포함한 JavaScript 문자열 위치는 **UTF-16 코드 유닛** 기준이다. 한글은 UTF-8 로
3바이트, UTF-16 으로 1유닛이므로 변환하지 않으면 밑줄과 커서가 전부 엉뚱한 곳을 가리킨다.
그리고 RSPDL 은 한국어 우선 언어다 — 이 버그는 예외 상황이 아니라 기본 상황에서 터진다.

### 결정

`packages/rspdl-editor` 가 변환을 소유하고, 다른 어디서도 `span` 을 직접 문자열 인덱스로 쓰지
않는다.

- `byteOffsetToIndex(text, byteOffset)` — UTF-8 바이트 오프셋 → JS 문자열 인덱스
- `spanToRange(text, span)` — 진단 span → `{from, to}` (CodeMirror 범위)

경계 사례를 테스트로 고정한다: ASCII 전용, 한글, 이모지(서로게이트 페어), 문자 중간을 가리키는
오프셋, 범위를 벗어난 오프셋. 마지막 둘은 컴파일러가 정상이라면 오지 않지만, 오면 **던지지 않고
가장 가까운 경계로 잘라낸다** — 편집기가 진단 하나 때문에 죽는 것이 진단을 못 보여주는 것보다 나쁘다.

## 패키지 경계

| 패키지 | 소유하는 것 | 금지 |
|---|---|---|
| `packages/design-system` | Tailwind v4 테마 토큰, 라이트·다크 | React 컴포넌트 |
| `packages/ui` | 도메인을 모르는 컴포넌트 (shadcn 포함) | `@dahaze/api-client`, 제품 용어 |
| `packages/rspdl-editor` | CodeMirror RSPDL 모드, 진단 표시, 오프셋 변환 | 문서 저장·불러오기, API 호출 |
| `apps/web` | 화면·라우팅·데이터 연결 | — |

`packages/ui` 와 `packages/rspdl-editor` 는 **데이터를 props 로 받는다.** 스스로 가져오지 않는다.
그래야 스토리북·테스트에서 쓸 수 있고, 서버 계약이 바뀌어도 컴포넌트가 따라 깨지지 않는다.

이 규칙은 `scripts/check_web_boundaries.mjs` 가 기계적으로 검사한다.

## Tailwind v4 는 CSS 가 설정이다

Tailwind v4 는 `tailwind.config.js` 대신 CSS 의 `@theme` 을 쓴다. `@import "tailwindcss"`,
토큰, 스캔 범위를 **`packages/design-system/src/theme.css` 하나가 소유하고** 앱은 그 파일 한 줄만
import 한다. 두 번째 앱이 생겨도 설정을 복제하지 않기 위해서다.

**모노레포에서 걸리는 함정이 하나 있다.** Tailwind 는 클래스 이름을 소스 파일에서 훑어 찾는데,
자동 탐지 범위에 워크스페이스 패키지는 들어오지 않는다. `packages/ui` 안에서만 쓰인 클래스는
명시하지 않으면 **조용히 빠진다** — 스타일 없이 렌더링되므로 빌드는 성공하고 화면만 깨진다.
그래서 테마 CSS 가 `@source` 로 패키지들을 명시한다. 경로는 그 CSS 파일 기준이다.

확인 방법: 패키지 안에만 있는 임의값 클래스(`tracking-[0.1234em]` 같은)를 하나 두고 빌드한 뒤
산출 CSS 에서 찾는다. 이때 **Tailwind 가 값을 정규화한다는 점**에 주의한다 — `0.1234em` 은
`.1234em` 으로 나오므로 원문 그대로 grep 하면 있는데도 없다고 나온다.

## shadcn 은 `packages/ui` 에 산다

`components.json` 은 `packages/ui` 에 둔다. `apps/web` 에서 `shadcn add` 를 돌리면 컴포넌트가 앱에
갇히고, 두 번째 앱이 생기는 순간 복제된다.

shadcn 컴포넌트는 우리가 소유하는 소스다 — 생성된 뒤에는 우리 코드이고, 하드코딩된 색은
`design-system` 토큰으로 바꾼다.

## 서버 상태와 클라이언트 상태

- **서버 상태는 TanStack Query 가 전부 소유한다.**
- **zustand 는 서버에 없는 것에만 쓴다** — 에디터 초안, 패널 레이아웃, 진단 필터.
- 서버 응답을 zustand 로 복사하지 않는다. 같은 데이터가 두 곳에 있으면 어느 쪽이 진실인지
  알 수 없게 된다.

경계가 흐려지기 쉬운 지점이 하나 있다. **에디터의 현재 텍스트는 클라이언트 상태다.** 저장하기
전까지 서버는 그 텍스트를 모른다. 저장이 성공하면 서버 상태가 되고, 그때 초안을 버린다.

`scripts/check_web_boundaries.mjs` 가 zustand 스토어에서 `@dahaze/api-client` import 를 막는다.

### QueryClient 기본값

`packages/api-client` 가 기본값을 소유한다. 앱마다 다시 정하면 갈라진다.

- **4xx 는 재시도하지 않는다.** 401 을 세 번 더 던지는 것은 느리기만 하고 결과가 같다.
- 컴파일 결과는 결정적이고 서버가 캐시하므로 `staleTime` 을 넉넉히 준다.
- mutation 은 재시도하지 않는다. 문서 저장이 조용히 두 번 일어나면 리비전이 두 개 남는다.

## `apps/web` 구조

```
src/
  app/        라우팅과 레이아웃만. 얇게 유지한다.
  features/   화면 단위. 각 feature 가 자기 훅·컴포넌트·스토어를 소유한다.
  shared/     feature 를 가로지르는 것만.
```

`app/` 에 로직을 두지 않는다. 라우트 파일은 feature 컴포넌트를 조립하는 자리다.

## 대안

- **shadcn 을 `apps/web` 에** — CLI 기본값이라 쉽지만 컴포넌트가 앱에 갇힌다.
- **`tailwind.config.js` 유지** — v4 에서도 되지만 v3 방식을 끌고 가는 것이고 토큰이 두 곳으로 갈린다.
- **진단 span 을 그대로 사용** — 영어 예제에서는 동작하는 것처럼 보인다. 한국어에서 깨진다.

## 결과

- 진단 위치는 한 곳에서 변환되고 테스트로 고정된다.
- 공용 컴포넌트는 서버 계약을 모른다.
- 두 번째 앱이 생겨도 컴포넌트를 복제하지 않는다.
- Tailwind 가 워크스페이스 패키지의 클래스를 놓치지 않는다.
