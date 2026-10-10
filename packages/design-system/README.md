# @dahaze/design-system

dahaze 의 Tailwind v4 테마. 값은 [jwdesign](https://github.com/jwsong98/jwplugin/tree/main/skills/jwdesign)
디자인 시스템을 따른다 — Pretendard, 브랜드 그린, 라이트·다크, 4px 간격, 반경 4·6·10·14·20·28.

| 파일 | 역할 |
|---|---|
| `src/theme.css` | 앱이 import 하는 유일한 진입점. Tailwind·웹폰트·jwdesign 토큰을 불러오고, dahaze 의미 이름을 jwdesign 토큰에 연결한다 |
| `src/jwdesign/tokens.jw.css` | jwdesign 원본 토큰(`--jw-*`). jwplugin 에서 생성된 파일 — 직접 고치지 않는다 |

## 테마

라이트가 기본이다. 다크는 조상 요소에 `class="dark"` 또는 `data-theme="dark"` 를 붙인다.
컴포넌트는 `dark:` 분기를 쓰지 않는다 — 토큰 값이 바뀌므로 알아서 따라온다.

## jwdesign 토큰 갱신

```console
# jwplugin 에서
python3 skills/jwdesign/scripts/build_tokens.py
# 생성된 tokens.jw.css 에서 @font-face 줄을 빼고 src/jwdesign/tokens.jw.css 로 교체
```

웹폰트는 npm 패키지로 받는다: `pretendard`(dynamic subset — 화면에 나온 글자만 내려받는다),
`@fontsource-variable/jetbrains-mono`. RSPDL 소스는 한글이 섞이므로 코드 글꼴은 D2Coding 을 앞에 두고
JetBrains Mono 를 그 뒤에 둔다.
