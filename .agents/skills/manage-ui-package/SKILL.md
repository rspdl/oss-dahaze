---
name: manage-ui-package
description: Add or change shared UI components, shadcn primitives, and design tokens in the dahaze monorepo. Use when adding a shadcn component, creating a reusable component, editing theme tokens or Tailwind config, or deciding whether code belongs in packages/ui, packages/design-system, or apps/web.
---

# UI 패키지 관리

공용 UI는 세 패키지로 나뉜다. 어디에 두는지를 매번 정확히 고르는 것이 이 스킬의 목적이다.

| 패키지 | 담는 것 | 담지 않는 것 |
|---|---|---|
| `packages/design-system` | 색·간격·타이포 토큰(jwdesign), 테마, 웹폰트 | React 컴포넌트 |
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

토큰은 `packages/design-system` 이 소유한다. 값의 원본은 **jwdesign** 디자인 시스템이다
(`jwsong98/jwplugin` 의 `skills/jwdesign`). 구조는 두 층이다.

1. `src/jwdesign/tokens.jw.css` — jwdesign 원본 토큰(`--jw-*`). jwplugin 에서 생성된 파일을
   그대로 가져온 것이다. **손으로 고치지 않는다.** 값을 바꾸려면 jwplugin 의 `tokens.json` 을 고치고
   `build_tokens.py` 로 다시 만든 뒤 이 파일을 통째로 교체한다.
2. `src/theme.css` — dahaze 의미 이름(`canvas`, `surface-raised`, `text-muted`, `diagnostic-error` …)을
   jwdesign 토큰에 연결하는 `@theme inline` 매핑. 매핑표는 파일 주석에 있다. 새 이름이 필요하면 먼저
   jwdesign 에 맞는 토큰이 있는지 찾고, 있으면 여기서 연결만 한다.

UI 규칙(한 화면에 채움 강조 하나, 시맨틱 토큰만, 4px 간격, 반경 스케일, 해요체 문구 등)은
jwdesign 스킬을 따른다. 스킬이 없으면 `npx skills add https://github.com/jwsong98/jwplugin --skill jwdesign`.

자주 쓰는 jwdesign 대응:

| 하려는 것 | 클래스 |
|---|---|
| 채움 강조 버튼 | `Button` 기본(`bg-accent text-accent-fg`) — 한 화면에 하나 |
| 약한 강조 | `Button variant="weak"`, `Badge`(기본이 연한 배경) |
| 링크·강조 글자 | `text-accent-text` (`text-accent` 는 다크에서 대비가 모자란다) |
| 파괴적 확정 | `Button variant="destructive"` (`bg-danger text-on-danger`) |
| 입력 테두리 | `border-border-control` (면 위 3:1) |
| hover 오버레이 | `hover:bg-state-hover` |
| 떠 있는 면 | `bg-surface-overlay shadow-md`(메뉴) · `shadow-lg`(모달) |
| 키보드 포커스 | `focus-visible:focus-ring` |
| 타입 | `text-title-1/2/3`, `text-headline`, `text-body`, `text-body-sm`, `text-caption` |

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
