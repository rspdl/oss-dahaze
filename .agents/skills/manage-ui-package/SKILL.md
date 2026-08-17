---
name: manage-ui-package
description: Add or change shared UI components, shadcn primitives, and design tokens in the dahaze monorepo. Use when adding a shadcn component, creating a reusable component, editing theme tokens or Tailwind config, or deciding whether code belongs in packages/ui, packages/design-system, or apps/web.
---

# UI 패키지 관리

공용 UI는 세 패키지로 나뉜다. 어디에 두는지를 매번 정확히 고르는 것이 이 스킬의 목적이다.

| 패키지 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `packages/design-system` | 색·간격·타이포 토큰, 테마, Tailwind preset | React 컴포넌트 |
| `packages/ui` | 도메인을 모르는 재사용 컴포넌트 (Button, Dialog, DataTable) | API 호출, 라우팅, 제품 용어 |
| `packages/rspdl-editor` | CodeMirror RSPDL 언어 모드, 진단 표시 | 문서 저장·불러오기 |
| `apps/web` | 화면, 라우팅, 데이터 연결, 제품 고유 컴포넌트 | — |

## 어디에 둘지 정하는 기준

**"이 컴포넌트가 dahaze가 아닌 제품에서도 말이 되는가?"**

- 된다 → `packages/ui`
- 안 된다 (예: `DiagnosticPanel`, `DocumentSidebar`) → `apps/web`

애매하면 `apps/web` 에 둔다. 나중에 올리는 건 쉽고, 내리는 건 어렵다.

## 규칙

1. **`packages/ui` 는 `@dahaze/api-client` 를 import하지 않는다.** 공용 컴포넌트가 서버 계약을
   알면 재사용이 불가능해진다. 데이터는 props로 받는다.
2. **`packages/ui` 는 색·간격을 하드코딩하지 않는다.** `design-system` 의 토큰만 쓴다.
   `#3b82f6` 같은 값이 보이면 토큰이 없다는 뜻이다 — 토큰을 먼저 만든다.
3. **shadcn 컴포넌트는 `packages/ui` 에 추가한다.** `apps/web` 에 직접 추가하면 두 번째 앱이
   생기는 순간 복제된다.
4. 내부 패키지는 빌드 산출물 없이 소스를 그대로 내보낸다. `apps/web/next.config.ts` 의
   `transpilePackages` 가 이를 처리한다.

## shadcn 컴포넌트 추가

```console
cd packages/ui
pnpm dlx shadcn@latest add dialog
```

`components.json` 이 `packages/ui` 에 있어 컴포넌트가 여기로 떨어진다.

추가한 뒤 반드시 확인한다.

- 생성된 파일에 하드코딩된 색이 있으면 `design-system` 토큰으로 바꾼다
- `packages/ui/src/index.ts` 에 export를 추가한다
- 컴포넌트가 `@dahaze/api-client` 를 끌어오지 않는지 확인한다

## 디자인 토큰 변경

토큰은 `packages/design-system` 이 소유한다. CSS 변수로 노출하고 Tailwind preset이 그걸 참조한다.

토큰을 바꾸면 **두 테마 모두** 확인한다. 한쪽만 고치면 다른 쪽에서 대비가 무너진다.

새 토큰을 추가할 때는 이름에 **쓰임**을 담는다.

```
✓ --color-diagnostic-error      쓰임이 드러난다
✗ --color-red-500               값이 이름이 되면 바꿀 수 없다
```

## 컴포넌트 추가 체크리스트

- [ ] 위치가 맞는가 (`ui` vs `apps/web`)
- [ ] 하드코딩된 색·간격이 없는가
- [ ] `@dahaze/api-client` 를 import하지 않는가 (`packages/ui` 인 경우)
- [ ] 라이트·다크 두 테마에서 확인했는가
- [ ] 키보드로 조작 가능한가, 포커스가 보이는가
- [ ] `index.ts` 에 export했는가

## 접근성

RSPDL 진단은 **색으로만** 구분하지 않는다. error/warning/info를 아이콘과 텍스트로도 구분한다.
색각 이상 사용자가 진단 심각도를 구분할 수 없으면 제품의 핵심 기능이 동작하지 않는 것이다.

## 흔한 실수

- **`apps/web` 에서 shadcn add** → 컴포넌트가 앱에 갇힌다
- **`packages/ui` 컴포넌트가 데이터를 직접 가져옴** → 스토리북·테스트에서 못 쓰게 된다
- **토큰 없이 색 추가** → 테마 전환에서 깨진다
- **`packages/ui` 에 제품 용어** (`RspdlDocumentCard`) → 이름에 도메인이 들어가면 `apps/web` 감이다
